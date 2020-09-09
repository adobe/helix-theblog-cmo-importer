
/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-disable max-len */
const { wrap } = require('@adobe/openwhisk-action-utils');
const { logger: oLogger } = require('@adobe/openwhisk-action-logger');
const { wrap: status } = require('@adobe/helix-status');
const { epsagon } = require('@adobe/helix-epsagon');
const { BlobHandler } = require('@adobe/helix-documents-support');

const cheerio = require('cheerio');
const moment = require('moment');
const escape = require('escape-html');
const path = require('path');
const rp = require('request-promise-native');
const sanitize = require('sanitize-filename');

const HelixImporter = require('@adobe/helix-importer/src/generic/HelixImporter');
const { asyncForEach } = require('@adobe/helix-importer/src/generic/utils');
const OneDriveHandler = require('@adobe/helix-importer/src/handlers/OneDriveHandler');
const FSHandler = require('@adobe/helix-importer/src/handlers/FSHandler');
const ExcelHandler = require('@adobe/helix-importer/src/handlers/ExcelHandler');
const FastlyHandler = require('@adobe/helix-importer/src/handlers/FastlyHandler');

const { load: loadMappings } = require('./mappings');

const TYPE_AUTHOR = 'authors';
const TYPE_POST = 'publish';
const TYPE_TOPIC = 'topics';

const URLS_XLSX = '/importer/cmo/urls.xlsx';
const URLS_XLSX_WORKSHEET = 'urls';
const URLS_XLSX_TABLE = 'listOfURLS';

const CMO_TOPIC = 'CMOByAdobe';

const EMBED_PATTERNS = [{
  // w.soundcloud.com/player
  match: (node) => {
    const f = node.find('iframe');
    const src = f.attr('src');
    return src && src.match(/w.soundcloud.com\/player/gm);
  },
  extract: async (node, logger) => {
    const f = node.find('iframe');
    const src = f.attr('src');
    try {
      const html = await rp({
        uri: src,
        timeout: 60000,
        simple: false,
        headers: {
          // does not give the canonical rel without the UA.
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36',
        },
      });
      if (html && html !== '') {
        const $ = cheerio.load(html);
        return $('link[rel="canonical"]').attr('href') || src;
      }
    } catch (error) {
      logger.warn(`Cannot resolve soundcloud embed ${src}`);
      return src;
    }
    return src;
  },
}, {
  // www.instagram.com
  match: (node) => node.find('.instagram-media').length > 0,
  extract: async (node) => node.find('.instagram-media').data('instgrm-permalink'),
}, {
  // www.instagram.com v2
  match: (node) => node.find('.instagram-media').length > 0,
  extract: async (node) => node.find('.instagram-media a').attr('href'),
}, {
  // twitter.com
  match: (node) => node.find('.twitter-tweet a').length > 0,
  extract: async (node) => {
    // latest <a> seems to be the link to the tweet
    const aTags = node.find('.twitter-tweet a');
    return aTags[aTags.length - 1].attribs.href;
  },
}, {
  // spark
  match: (node) => node.find('a.asp-embed-link').length > 0,
  extract: async (node) => node.find('a.asp-embed-link').attr('href'),
}, {
  // media.giphy.com
  match: (node) => {
    const img = node.find('img');
    const src = img ? img.attr('src') : null;
    return src && src.match(/media.giphy.com/gm);
  },
  extract: async (node) => {
    const img = node.find('img');
    return img.attr('src');
  },
}, {
  // fallback to iframe src
  match: (node) => {
    const f = node.find('iframe');
    return f.attr('src') || f.data('src');
  },
  extract: (node) => {
    const f = node.find('iframe');
    return f.attr('src') || f.data('src');
  },
}];

async function handleAuthor(importer, $, outputPath, postedOn, checkIfExists) {
  const gn = $('[itemprop="givenName"]').text() || '';
  const fn = $('[itemprop="familyName"]').text() || '';
  const postedBy = `${gn.trim()} ${fn.trim()}`;
  // const authorLink = $('.author-link').attr('href');

  const nodes = [];
  nodes.push($('<p>').append(`by ${postedBy}`));
  nodes.push($('<p>').append(postedOn));

  const authorFilename = importer.sanitizeFilename(postedBy);

  if (authorFilename && authorFilename !== '' && (!checkIfExists || !await importer.exists(`${outputPath}/${TYPE_AUTHOR}`, authorFilename))) {
    const $main = $('.articleAuthor');

    $main.append(`<h2>${postedBy}</h2>`);
    $main.append(`<p>${$('[itemprop="jobTitle"]').text() || ''}</p>`);

    $('.authorData').remove();

    const content = $main.html();
    await importer.createMarkdownFile(`${outputPath}/${TYPE_AUTHOR}`, authorFilename, content);
  }

  return nodes;
}

async function handleTopicsAndTopics(importer, $, outputPath, checkIfExists, mappings, logger) {
  // tag-Label
  let mainTopic = $('.tag-Label').text() || '';
  mainTopic = mainTopic ? mainTopic.trim().replace(/&amp;/g, '&') : '';

  const keywords = $('[name="keywords"]').attr('content') || '';
  const list = keywords.split(',');
  list.unshift(mainTopic);

  let topics = [];
  let products = [];

  list.forEach((t) => {
    const topic = t.trim();
    const topicLC = topic.toLowerCase();

    if (mappings[outputPath].categories[topicLC]) {
      if (topic === mainTopic) {
        // add first
        topics.unshift(0, mappings[outputPath].categories[topicLC][0]);
      } else {
        topics.push(mappings[outputPath].categories[topicLC][0]);
      }
    } else {
      // throw new Error(`Found an unmapped topic: ${topic}`);
      console.warn(`Found an unmapped topic: ${topic}`);
      topics.push(topic);
    }

    if (mappings[outputPath].products[topicLC]) {
      if (topic === mainTopic) {
        // add first
        products.unshift(0, mappings[outputPath].products[topicLC][0]);
      } else {
        products.push(mappings[outputPath].products[topicLC][0]);
      }
    }
  });

  topics.push(CMO_TOPIC);

  topics = topics.filter((t, i) => t && t.length > 0 && topics.indexOf(t) === i).map((t) => t.trim());

  await asyncForEach(
    topics,
    async (t) => {
      const topicName = importer.sanitizeFilename(t);
      if (!checkIfExists || !await importer.exists(`${outputPath}/${TYPE_TOPIC}`, topicName)) {
        logger.info(`Found a new topic: ${topicName}`);
        await importer.createMarkdownFile(`${outputPath}/${TYPE_TOPIC}`, topicName, `<h1>${t}</h1>`);
      }
    },
  );

  products = products.filter((t, i) => t && t.length > 0 && products.indexOf(t) === i).map((t) => t.trim());

  return {
    topics: topics.join(', '),
    products: products.join(', '),
  };
}

function reviewInlineElement($, tagName) {
  // collaspe consecutive <tag>
  // and make sure element does not start ends with spaces while it is before / after some text
  const tags = $(tagName).toArray();
  for (let i = tags.length - 1; i >= 0; i -= 1) {
    const tag = tags[i];
    const $tag = $(tag);
    let text = $tag.text();
    if (tag.previousSibling) {
      const $previousSibling = $(tag.previousSibling);
      if (tag.previousSibling.tagName === tagName) {
        // previous sibling is an <tag>, merge current one inside the previous one
        $previousSibling.append($tag.html());
        $tag.remove();
      }
    }
    if (text) {
      if (text.lastIndexOf(' ') === text.length - 1) {
        // move trailing space to a new text node outside of current element
        text = $tag.text(text.slice(0, text.length - 1)).text();
        $('<span> </span>').insertAfter($tag);
      }

      if (text.indexOf(' ') === 0) {
        // move leading space to a new text node outside of current element
        text = $tag.text(text.slice(1)).text();
        $('<span> </span>').insertBefore($tag);
      }
    }
  }
}

async function doImport(importer, url, checkIfRelatedExists, doCreateAssets = false, mappings, logger) {
  const host = new URL(url).origin;

  let outputPath = 'en';
  if (url.indexOf('/de/') !== -1) {
    outputPath = 'de';
  }

  const html = await importer.getPageContent(url);

  if (html && html !== '') {
    const $ = cheerio.load(html);

    // extract date from url (dirty)
    const date = moment(new Date(path.dirname(new URL(url).pathname)), 'MM-DD-YYYY').format('YYYY/MM/DD');
    const postedOn = `posted on ${date}`;

    // const $main = $('.container');

    // fix images
    $('img').each((i, img) => {
      const $img = $(img);
      let src = $img.attr('src');
      if (!src) $img.remove();
      if (src && src.indexOf('/') === 0) {
        if (src.indexOf('.') === -1) {
          // some images with no extension
          src += '.jpeg';
        }
        $img.attr('src', `${host}${src}`);
      } else {
        const dataSrc = $img.attr('data-src');
        if ((!src || src.indexOf('data:') === 0) && dataSrc) {
          // use data-src instead of base64 image
          if (dataSrc.indexOf('/') === 0) {
            $img.attr('src', `${host}${dataSrc}`);
          } else {
            $img.attr('src', dataSrc);
          }
        }
      }
    });

    // remove all existing hr to avoid section collisions
    $('.container hr').remove();

    const $title = $('.container > div.position:nth-of-type(2) .title');
    const $heroBanner = $('.container > div.position:nth-of-type(1)');

    $title.insertBefore($heroBanner);

    // add a thematic break after first titles
    $('<hr>').insertBefore($heroBanner);

    // add a thematic break after hero banner
    const $heroHr = $('<hr>').insertAfter($heroBanner);

    $('<hr>').insertAfter($heroHr);

    const nodes = await handleAuthor(importer, $, outputPath, postedOn, checkIfRelatedExists, logger);
    let previous = $heroHr;
    nodes.forEach((n) => {
      previous = n.insertAfter(previous);
    });

    const { topics, products } = await handleTopicsAndTopics(importer, $, outputPath, checkIfRelatedExists, mappings, logger);

    const $topicsWrap = $('<p>');
    $topicsWrap.html(`Topics: ${topics}`);
    const $productsWrap = $('<p>');
    $productsWrap.html(`Products: ${products}`);

    const $main = $('.container');
    $main.append('<hr>');
    $main.append($topicsWrap);
    $main.append($productsWrap);

    // const headers = $main.find('.article-header');
    // if (headers.length === 0) {
    //   // posts with headers after image
    //   const $articleRow = $('.article-title-row');
    //   $('.article-content').prepend($articleRow);
    //   $('<hr>').insertAfter($articleRow);
    // }
    // $main.find('.article-collection-header').remove();

    // embeds
    await asyncForEach($('.embed-wrapper, .spotify-wrapper').toArray(), async (node) => {
      const $node = $(node);

      let src;
      await asyncForEach(
        EMBED_PATTERNS,
        async (p) => {
          if (p.match($node)) {
            src = await p.extract($node, logger);
          }
          return src;
        },
      );

      if (!src) {
        // throw new Error('Unsupported embed - no src found');
        logger.warn(`Unsupported embed - could not resolve embed src in ${url}`);
      } else {
        if (src.indexOf('//') === 0) {
          // handle weird url starting with //
          src = `https:${src}`;
        }

        // replace children by "hlxembed" custom tag
        $node.children().remove();
        $node.append(`<hlxembed>${src}</hlxembed>`);
      }
    });
    // there might be some remaining iframes, just use the src as an embed.
    $('iframe').each((i, iframe) => {
      const $f = $(iframe);
      if ($f.attr('src') || $f.data('src')) {
        $(`<hlxembed>${$f.attr('src') || $f.data('src')}</hlxembed>`).insertAfter($f);
      }
      $f.remove();
    });

    // collaspe consecutive <em>, <strong>, <u>, <i>...
    // and make sure they do not start / end with spaces while it is before / after some text

    ['a', 'b', 'big', 'code', 'em', 'i', 'label', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u', 'var'].forEach((tag) => reviewInlineElement($, tag));

    $('.taglabel').remove();
    $('.socialmediashare').remove();
    $('.articleAuthor').remove();

    const content = $main.html();

    await importer.createMarkdownFile(`${outputPath}/${TYPE_POST}/${date}`, path.parse(url).name, content);

    return date;
  }
  return 'N/A';
}

/**
 * This is the main function
 * @param {string} name name of the person to greet
 * @returns {object} a greeting
 */
async function main(params = {}) {
  const startTime = new Date().getTime();
  const {
    url,
    force = true,
    checkIfRelatedExists = true,
    __ow_logger: logger,
    AZURE_BLOB_SAS: azureBlobSAS,
    AZURE_BLOB_URI: azureBlobURI,
    AZURE_ONEDRIVE_CLIENT_ID: oneDriveClientId,
    AZURE_ONEDRIVE_CLIENT_SECRET: oneDriveClientSecret,
    AZURE_ONEDRIVE_REFRESH_TOKEN: oneDriveRefreshToken,
    AZURE_ONEDRIVE_CONTENT_LINK: oneDriveContentLink,
    AZURE_ONEDRIVE_ADMIN_LINK: oneDriveAdminLink,
    FASTLY_TOKEN,
    FASTLY_SERVICE_ID,
    localStorage,
    cache,
    doCreateAssets,
    updateExcel = true,
  } = params;

  let { mappings } = params;

  if (!url) {
    throw new Error('Missing url parameter');
  }

  if (!azureBlobSAS || !azureBlobURI) {
    throw new Error('Missing Azure Blog Storage credentials');
  }

  try {
    let handler;
    let excelHandler;

    if (oneDriveClientId && oneDriveClientSecret) {
      if (!localStorage) {
        logger.info('OneDrive credentials provided - using OneDrive handler');
        handler = new OneDriveHandler({
          logger,
          clientId: oneDriveClientId,
          clientSecret: oneDriveClientSecret,
          refreshToken: oneDriveRefreshToken,
          sharedLink: oneDriveContentLink,
        });
      } else {
        logger.info('localStorage provided - using FShandler');
        handler = new FSHandler({
          logger,
          target: localStorage,
        });
      }

      excelHandler = new ExcelHandler({
        logger,
        clientId: oneDriveClientId,
        clientSecret: oneDriveClientSecret,
        refreshToken: oneDriveRefreshToken,
        sharedLink: oneDriveAdminLink,
      });
    } else {
      logger.info('No OneDrive credentials provided');
      throw new Error('Missing OneDrive credentials');
    }

    logger.info(`Received url ${url}`);

    if (!force) {
      // check if url has already been processed
      const rows = await excelHandler.getRows(URLS_XLSX, URLS_XLSX_WORKSHEET, URLS_XLSX_TABLE);

      // rows.value[n].values[0][0] -> year
      // rows.value[n].values[0][1] -> url
      // rows.value[n].values[0][2] -> import date
      const index = rows && rows.value
        ? rows.value.findIndex(
          (r) => (r.values.length > 0 && r.values[0].length > 1 ? r.values[0][1] === url : false),
        )
        : -1;
      const rec = index > -1 ? rows.value[index] : null;
      if (rec && rec.values[0][2]) {
        // url has already been imported
        return Promise.resolve({
          body: `${url} has already been imported.`,
        });
      }
    }

    if (!mappings) {
      // load the mappings
      mappings = await loadMappings(excelHandler);
    }

    const importer = new HelixImporter({
      storageHandler: handler,
      blobHandler: new BlobHandler({
        azureBlobSAS,
        azureBlobURI,
        log: {
          debug: () => {},
          info: () => {},
          error: (msg) => { logger.error(msg); },
          warn: (msg) => { logger.warn(msg); },
        },
      }),
      logger,
      cache,
    });

    const date = await doImport(importer, url, checkIfRelatedExists, doCreateAssets, mappings, logger);

    if (FASTLY_SERVICE_ID && FASTLY_TOKEN) {
      const fastly = new FastlyHandler({
        fastlyServiceId: FASTLY_SERVICE_ID,
        fastlyToken: FASTLY_TOKEN,
      });

      await fastly.addDictEntry(url, date);
    } else {
      logger.warn('Unable to create redirect, check FASTLY_SERVICE_ID and FASTLY_TOKEN');
    }

    if (updateExcel) {
      await excelHandler.addRow(
        URLS_XLSX,
        URLS_XLSX_WORKSHEET,
        URLS_XLSX_TABLE,
        [[date, url, new Date().toISOString()]],
      );
    }

    logger.info(`Process done in ${(new Date().getTime() - startTime) / 1000}s.`);
    return {
      body: `Successfully imported ${url}`,
      data: [date, url, new Date().toISOString()],
      statusCode: 200,
    };
  } catch (error) {
    logger.error(error.message);
    return {
      statusCode: 500,
      body: `Error for ${url} import: ${error.stack}`,
    };
  }
}

module.exports.main = wrap(main)
  .with(epsagon)
  .with(status)
  .with(oLogger.trace)
  .with(oLogger);

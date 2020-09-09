/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */

'use strict';

const assert = require('assert');
const index = require('../src/cmo/index.js');

require('dotenv').config();

describe('Index Tests', () => {
  it('index with url', async () => {
    // const url = 'https://cmo.adobe.com/articles/2020/1/5-marketing-trends-that-will-impact-your-business-most-in-2020.html';
    // const url = 'https://cmo.adobe.com/articles/2020/1/the-future-of-marketing-in-an-ai-powered-world.html';
    // const url = 'https://cmo.adobe.com/articles/2020/1/why-so-sad--the-role-ai-and-emotion-will-play-in-tomorrow-s-ads.html';
    // const url = 'https://cmo.adobe.com/de/articles/2017/11/von-bing-wird-erwartet-dass-alles-uberall-verfugbar-ist';
    // const url = 'https://cmo.adobe.com/articles/2012/9/8-strategies-for-b2b-marketing-success';
    // const url = 'https://cmo.adobe.com/articles/2019/7/welcome-to-the-new-and-improved-cmo-by-adobe0';
    const url = 'https://cmo.adobe.com/articles/2016/6/think-and-act-like-the-underdog-fast';

    const result = await index.main({
      url,
      force: true,
      checkIfRelatedExists: false,
      AZURE_BLOB_SAS: process.env.AZURE_BLOB_SAS,
      AZURE_BLOB_URI: process.env.AZURE_BLOB_URI,
      AZURE_ONEDRIVE_CLIENT_ID: process.env.AZURE_ONEDRIVE_CLIENT_ID,
      AZURE_ONEDRIVE_CLIENT_SECRET: process.env.AZURE_ONEDRIVE_CLIENT_SECRET,
      AZURE_ONEDRIVE_REFRESH_TOKEN: process.env.AZURE_ONEDRIVE_REFRESH_TOKEN,
      AZURE_ONEDRIVE_CONTENT_LINK: process.env.AZURE_ONEDRIVE_CONTENT_LINK,
      AZURE_ONEDRIVE_ADMIN_LINK: process.env.AZURE_ONEDRIVE_ADMIN_LINK,
      FASTLY_TOKEN: process.env.FASTLY_TOKEN,
      FASTLY_SERVICE_ID: process.env.FASTLY_SERVICE_ID,
      localStorage: './output',
      cache: './.cache',
    });
    assert.equal(result.body, `Successfully imported ${url}`);
    assert.equal(result.statusCode, 200);
  }).timeout(60000);
});

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
/* eslint-disable max-len */
const { asyncForEach } = require('@adobe/helix-importer/src/generic/utils');

const MAPPINGS_XLSX = '/importer/cmo/mappings.xlsx';

const MAPPINGS_XLSX_WORKSHEET = ' - Migration';
const MAPPINGS_XLSX_TABLE = '_map';

const LANGS = ['en', 'de'];

async function load(excelHandler) {
  const mappings = {};

  asyncForEach(LANGS, async (lang) => {
    mappings[lang] = {
      categories: {},
      products: {},
    };

    const worksheet = `${lang}${MAPPINGS_XLSX_WORKSHEET}`;
    const table = `${lang}${MAPPINGS_XLSX_TABLE}`;

    const rows = await excelHandler.getRows(MAPPINGS_XLSX, worksheet, table);
    rows.value.forEach((row) => {
      if (row && row.values && row.values.length > 0 && row.values[0].length > 1) {
        const cmo = row.values[0][0];
        const topics = row.values[0][1];
        const products = row.values[0][1];

        const oldTopic = cmo.trim().toLowerCase();

        const newCats = topics.split(',');
        const newProducts = products.split(',');

        mappings[lang].categories[oldTopic] = newCats.map((t) => t.trim());
        mappings[lang].products[oldTopic] = newProducts.map((t) => t.trim());
      }
    });
  });

  // const productsRows = await excelHandler.getRows(MAPPINGS_XLSX, MAPPINGS_XLSX_PRODUCTS_WORKSHEET, MAPPINGS_XLSX_PRODUCTS_TABLE);
  // productsRows.value.forEach((row) => {
  //   if (row && row.values && row.values.length > 0 && row.values[0].length > 1) {
  //     const product = row.values[0];
  //     // Products>Experience Cloud>Experience Manager
  //     const s = product[0].split('>');
  //     const oldProductName = s[s.length - 1].trim().toLowerCase();

  //     // Experience Cloud, Experience Manager
  //     // reversing to get more specific first
  //     const newProducts = product[1].split(',');

  //     // Experience Manager = [Experience Manager, Experience Cloud]
  //     mappings.products[oldProductName] = newProducts.reverse().map((t) => t.trim());
  //   }
  // });

  return mappings;
}

module.exports = { load };

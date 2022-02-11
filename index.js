require('dotenv').config();

const _ = require('lodash');

const axios   = require('axios');
const cheerio = require('cheerio');
const moment  = require('moment');

const { writeFile } = require('fs/promises');
const { json2csvAsync } = require('json-2-csv');

axios.defaults.baseURL = process.env.HTTP_BASE_URL || `http://sispro.co.id`;
axios.defaults.timeout = process.env.HTTP_TIMEOUT;

const elements = {
    NEXT_PAGE: 'ul.pagination > li.next > a',
    PAGE_INFO: 'div.count',
    READ_MORE: 'a.read-more',

    COMPANY_NAME: '.title h1',
    COMPANY_DESC: '.category table',
    COMPANY_DETAILS: '#sidebar ul li',
};

const targets = [
    {active: process.env.PAGE_CONTRACTOR, href: '/id/1-kontraktor-utama'},
    {active: process.env.PAGE_SUBCONTRACTOR, href: '/id/2-sub-kontraktor'},
    {active: process.env.PAGE_SUPPLIER, href: '/id/3-supplier'},
    {active: process.env.PAGE_SERVICE, href: '/id/4-jasa'},
    {active: process.env.PAGE_PRODUSER, href: '/id/5-produsen'},
];

const fetchSispro = async function (target, callback) {
    const { data } = await axios.get(target);
    const rawHTML = data;
    const $ = cheerio.load(rawHTML);

    await callback($, rawHTML);
}

const initCompany = async function (company) {
    const detail = `${axios.defaults.baseURL}${company}`;

    let companyData = null;

    try {
        await fetchSispro(company, function ($, rawHTML) {
            let cmpyName = $(elements.COMPANY_NAME, rawHTML).text();
            let cmpyDesc = $(elements.COMPANY_DESC, rawHTML).text().replace(/\s+/g, ' ').trim();
            let cmpyDetails = [];

            $(elements.COMPANY_DETAILS, rawHTML)
                .each((i, tr) => {
                    let details = $(tr).text()
                        .replace(/\s+/g, ' ')
                        .replace('Alamat:', '')
                        .replace(/ : /g, ': ')
                        .trim();

                    cmpyDetails.push(details);
                });
            
            console.log(`Successfully scapring from ${detail}.`);

            companyData = {
                name: cmpyName,
                desc: cmpyDesc,
                details: cmpyDetails.join(' ')
            };
        });
    } catch (error) {
        console.log(`Failed scapring from ${detail}.`);
    }

    return Promise.resolve(companyData);
};

const initHTMLTarget = async function (target, companies = []) {
    const endpoint = `${axios.defaults.baseURL}${target}`;

    try {
        await fetchSispro(target, async function ($, rawHTML) {
            const nextPage = $(elements.NEXT_PAGE).attr('href');

            let [page] = $(elements.PAGE_INFO, rawHTML).text()
                .replace(/\s+/g, ' ')
                .split(' ')
                .filter(info => Number(info));

            $(elements.READ_MORE, rawHTML).each((i, detail) => {
                companies.push($(detail).attr('href'));
            });

            console.log(`Fetch data from ${endpoint}.`);

            if (nextPage && pageResolver(page)) {
                return await initHTMLTarget(nextPage, companies);
            }
        });
    } catch (error) {
        console.log(`Failed fetch data from ${endpoint}.`);
    }

    return companies;
};

const pageResolver = function (page) {
    return page < (process.env.MAX_PAGE || 1);
};

const parseStrToBool = function (value) {
    switch (value.toString().toLowerCase().trim()) {
        case 'true':
        case 'yes':
        case '1':
            return true;

        case 'false':
        case 'no':
        case '0':
        default:
            return false;
    };
};

(async function run() {
    Promise
        .all(targets.filter(target => parseStrToBool(target.active)).map(target => initHTMLTarget(target.href)))
        .then(companies => {
            Promise
                .all(_.flattenDeep(companies).map(company => initCompany(company)))
                .then(async records => {
                    const data = await json2csvAsync(records.filter(record => record));
                    const now  = moment().format('YYYYMMDDHHmmss');
                    const file = `sispro-${now}.csv`;

                    try {
                        await writeFile(`dist/${file}`, data, 'utf8');
                        console.log(`Successfully converted ${file}!`);   
                    } catch (error) {
                        console.log(`Failed converted ${file}!`, error);
                    }
                });
        });
})();
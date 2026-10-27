import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = process.env.LIVE_BASE_URL || 'https://boson316.github.io/open_AI_stock/';
const expected = JSON.parse(readFileSync('public/data/coverage.json', 'utf8'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(base, {waitUntil: 'domcontentloaded'});
  if (response.status() !== 200) throw Error('Live homepage is unavailable');
  await page.getByText('已載入 SEC 財報').waitFor();
  const reportResponse = await page.request.get(`${base}data/coverage.json`);
  if (!reportResponse.ok()) throw Error('Live coverage report is unavailable');
  const report = await reportResponse.json();
  if (!report.complete || report.companies.length !== expected.companies.length) throw Error('Live coverage is incomplete');
  for (const company of expected.companies) {
    const remote = report.companies.find(c => c.ticker === company.ticker);
    if (!remote?.core_complete || remote.dataset_sha256 !== company.dataset_sha256) throw Error(`Stale live report: ${company.ticker}`);
    const dataResponse = await page.request.get(`${base}data/${company.ticker}.json`);
    if (!dataResponse.ok()) throw Error(`Missing live dataset: ${company.ticker}`);
    const hash = createHash('sha256').update(await dataResponse.body()).digest('hex');
    if (hash !== company.dataset_sha256) throw Error(`Live dataset differs from tested release: ${company.ticker}`);
    if (company.ticker !== 'SOFI') {
      await page.getByRole('textbox', {name: '搜尋股票'}).fill(company.ticker);
      const loaded = page.waitForResponse(r => r.url().includes(`/data/${company.ticker}.json`) && r.status() === 200);
      await page.locator('.search-results button').filter({has: page.locator('strong', {hasText: new RegExp(`^${company.ticker}$`)})}).click();
      const data = await (await loaded).json();
      if (data.ticker !== company.ticker) throw Error('Company identity mismatch');
      await page.getByText('已載入 SEC 財報').waitFor();
    }
    await page.getByText('近 20 季核心資料已核對').waitFor();
    if (company.ticker === 'TSM' && !(await page.getByRole('button', {name: /TTM 營業收入/}).innerText()).includes('NT$')) throw Error('TSM currency mismatch');
    console.log(`Verified production: ${company.ticker}, ${company.quarters} contiguous quarters, exact dataset hash`);
  }
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Production HTTPS, data integrity and all stock switches passed.');
} finally {
  await browser.close();
}

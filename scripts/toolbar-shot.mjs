// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto('http://localhost:3000/de/terminal', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
// dismiss locale nudge if present
await page.evaluate(() => {
  const keep = [...document.querySelectorAll('button')].find((b) => /de behalten/i.test(b.textContent ?? ''));
  keep?.click();
});
await new Promise((r) => setTimeout(r, 400));
// open the analyse menu so the dropdown design is visible
await page.evaluate(() => document.querySelector('[data-menu-trigger="analyse"]')?.click());
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'artifacts/wave6-toolbar.png' });
await browser.close();
console.log('shot ok');

const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../public');
async function main() {
  let server;
  let url = process.argv[2];
  if (!url) {
    server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(
        new URL(req.url, 'http://localhost').pathname,
      );
      const file = path.resolve(
        root,
        '.' + (pathname === '/' ? '/index.html' : pathname),
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, {
          'Content-Type':
            types[path.extname(file)] || 'application/octet-stream',
        });
        res.end(data);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
  }
  const options = { headless: true };
  if (process.argv[2] && process.env.CHROME_PROXY) {
    options.proxy = { server: process.env.CHROME_PROXY };
  }
  if (process.env.CHROME_PATH) options.executablePath = process.env.CHROME_PATH;
  let browser;
  try {
    browser = await chromium.launch(options);
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 },
    })) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      const initialCount = await page.locator('.item').count();
      assert(initialCount >= 6);
      assert.equal(await page.locator('.group').count(), 3);
      assert.deepEqual(await page.locator('.group h2').allTextContents(), [
        '工具',
        '百科',
        '二创',
      ]);
      const expectedIcons = {
        火の眼: 'eye',
        万舰的风景: 'voyage',
        火羽舰队: 'fleet',
        火羽ひのめ百科: 'encyclopedia',
        '火羽ひのめ 情报屋': 'profile',
        绝对不会抛下B站去其他地方的日本vtuber: 'original',
        '2022年10月12日火羽生日会直播录像': 'replay',
        '《信》': 'letter',
        '《誓火未熄》': 'anthem',
      };
      for (const [title, slug] of Object.entries(expectedIcons)) {
        const icon = page
          .getByRole('link', {
            name: `${title}（在新标签页打开）`,
            exact: true,
          })
          .locator('img');
        assert.equal(await icon.count(), 1, title);
        assert.equal(
          await icon.evaluate((el) => el.complete && el.naturalWidth > 0),
          true,
          `${title}: image loaded`,
        );
        assert.equal(
          new URL(await icon.getAttribute('src'), url).pathname
            .split('/')
            .pop(),
          `${slug}.png`,
          title,
        );
      }
      assert.equal(
        await page
          .locator('.site-icon')
          .evaluate((el) => el.complete && el.naturalWidth > 0),
        true,
      );
      await page.locator('#palette summary').click();
      assert.equal(await page.locator('#transparency').inputValue(), '100');
      assert.equal(
        await page.locator('#transparency-value').textContent(),
        '100%',
      );
      await page.locator('#panel-color').fill('#6a454a');
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--panel-color'),
        ),
        '#6a454a',
      );
      await page.locator('#title-color').fill('#abcdef');
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--title-color'),
        ),
        '#abcdef',
      );
      await page.locator('#transparency').fill('35');
      assert.equal(
        await page.locator('#transparency-value').textContent(),
        '35%',
      );
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--panel-opacity'),
        ),
        '65%',
      );
      await page.locator('#scene-transparency').fill('25');
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--scene-opacity'),
        ),
        '0.75',
      );
      await page.locator('#reset-palette').click();
      assert.equal(await page.locator('#transparency').inputValue(), '100');
      assert.equal(await page.locator('#scene-transparency').inputValue(), '0');
      assert.equal(await page.locator('#panel-color').inputValue(), '#30465e');
      assert.equal(await page.locator('#title-color').inputValue(), '#ffad78');
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--panel-opacity'),
        ),
        '0%',
      );
      await page.locator('#palette summary').click();

      assert.equal(await page.locator('h1').innerText(), '火市 技術課');
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${name}: horizontal overflow`,
      );
      const input = page.locator('#search');
      await input.fill('舰长');
      assert(await page.getByRole('link', { name: /万舰的风景/ }).isVisible());
      assert.equal(await page.getByRole('link', { name: /火の眼/ }).count(), 0);
      await input.fill('HANE VOYAGE');
      assert(await page.getByRole('link', { name: /火羽舰队/ }).isVisible());
      assert.equal(await page.getByRole('link', { name: /火の眼/ }).count(), 0);
      await input.fill('完全不存在的搜索');
      assert.equal(await page.locator('#empty').isVisible(), true);
      await page.locator('#empty-clear').click();
      assert.equal(await page.locator('.item').count(), initialCount);
      await input.fill('生日');
      await page.locator('#clear').click();
      assert.equal(await page.locator('.item').count(), initialCount);
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Control+k');
      assert.equal(
        await input.evaluate((el) => document.activeElement === el),
        true,
      );
      await input.evaluate((el) => {
        el.dispatchEvent(
          new CompositionEvent('compositionstart', { bubbles: true }),
        );
        el.value = '舰';
        el.dispatchEvent(
          new InputEvent('input', { bubbles: true, isComposing: true }),
        );
      });
      assert.equal(await page.locator('.item').count(), initialCount);
      await input.evaluate((el) => {
        el.value = '舰长';
        el.dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true }),
        );
      });
      assert(await page.getByRole('link', { name: /万舰的风景/ }).isVisible());
      assert.equal(await page.getByRole('link', { name: /火の眼/ }).count(), 0);
      await page.locator('#clear').click();
      const links = await page
        .locator('.item')
        .evaluateAll((nodes) =>
          nodes.map((a) => ({ href: a.href, target: a.target, rel: a.rel })),
        );
      assert.equal(links.length, initialCount);
      assert(
        links.every(
          (a) =>
            a.href.startsWith('https://') &&
            a.target === '_blank' &&
            a.rel.includes('noopener'),
        ),
      );
      const first = page.locator('.item').first();
      const popupPromise = page.waitForEvent('popup');
      await page
        .context()
        .route('https://best-hinome.pages.dev/**', (route) =>
          route.fulfill({ status: 200, body: 'external link test' }),
        );
      await first.click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(new URL(popup.url()).hostname, 'best-hinome.pages.dev');
      await popup.close();
      assert.deepEqual(errors, []);
      if (process.env.SCREENSHOT_DIR) {
        await page.screenshot({
          path: path.join(process.env.SCREENSHOT_DIR, `${name}.png`),
          fullPage: true,
        });
      }
      console.log(
        `${name}: initial, order, icons, palette, search, aliases, empty, clear, shortcut, IME, external link, overflow and console passed`,
      );
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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
        '.json': 'application/json',
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
      const initialCount = await page.locator('#groups .item').count();
      assert(initialCount >= 6);
      assert.deepEqual(await page.locator('#groups .group h2').allTextContents(), [
        '实用工具',
        '百科资料',
        '影像档案',
        '亲历回顾',
        '二创作品',
      ]);
      const expectedIcons = {
        火の眼: 'eye',
        万舰的风景: 'voyage',
        火羽舰队: 'fleet',
        '千舰史料 · 直播回放检索': 'replay',
        '火羽ひのめ · 直播回放字幕检索': 'replay',
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
      assert.equal(await page.locator('#palette, [data-border-option]').count(), 0);
      const cardStyle = await page.locator('.card').first().evaluate((card) => ({
        fill: getComputedStyle(card).backgroundColor,
        edge: getComputedStyle(card, '::before').paddingTop,
        title: getComputedStyle(card.querySelector('.item-title')).color,
        tag: getComputedStyle(card.querySelector('.tags')).color,
        section: getComputedStyle(card.closest('.group').querySelector('h2')).color,
      }));
      assert.deepEqual(cardStyle, {
        fill: 'rgba(0, 0, 0, 0)',
        edge: '1.5px',
        title: 'rgb(255, 212, 166)',
        tag: 'rgb(183, 216, 242)',
        section: 'rgb(255, 172, 156)',
      });
      const tagGaps = await page.locator('.card').evaluateAll((cards) =>
        cards.map((card) =>
          card.getBoundingClientRect().bottom - card.querySelector('.tags').getBoundingClientRect().bottom,
        ),
      );
      assert(tagGaps.every((gap) => Math.abs(gap - 10) < 0.5));

      const homeUrl = page.url();
      assert.equal(await page.getByRole('button', { name: '关于火の眼' }).count(), 0);
      assert.equal(await page.locator('#hinome-eye').count(), 0);
      const header = page.locator('header');
      assert.doesNotMatch(await header.innerText(), /在这里查找|关于本站|联系作者/);
      const footer = page.locator('footer');
      assert.match(await footer.locator('.site-summary').innerText(), /直播回放.*实用工具.*粉丝作品/);
      assert.equal(
        await footer.getByRole('link', { name: /联系作者.*游戏memory/ }).getAttribute('href'),
        'https://space.bilibili.com/1302404',
      );
      await footer.getByRole('button', { name: '关于本站' }).click();
      const siteDialog = page.getByRole('dialog', { name: '关于本站' });
      assert(await siteDialog.getByRole('link', { name: 'GitHub 反馈' }).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await siteDialog.getByRole('button', { name: '关闭关于本站' }).click();
      assert.equal(await siteDialog.count(), 0);
      assert.equal(page.url(), homeUrl);
      const recommendation = page.getByRole('dialog', { name: '提交推荐' });
      const endpoint = 'https://hinome-tech-recommendations.gaoguobin12.workers.dev';
      await page.route(endpoint + '/**', async (route) => {
        const apiRequest = route.request();
        const pathname = new URL(apiRequest.url()).pathname;
        const data = {
          '/config': { accepting: true },
          '/submit': { accepted: true },
          '/updates': { updates: [
            { published: Date.parse('2026-11-20T23:00:00Z'), section: '二创作品',
              title: '较新资源', description: '新增一条二创资源。', url: 'https://example.org/recent' },
            { published: Date.parse('2026-11-20T04:00:00Z'), section: '百科资料',
              title: '较早资源', description: '新增一条百科资料。', url: 'https://example.org/earlier' },
          ], next: null },
        }[pathname];
        assert(data, 'Unexpected recommendation request');
        if (apiRequest.method() === 'POST') {
          const submission = apiRequest.postDataJSON();
          assert.deepEqual(Object.keys(submission).sort(), ['description', 'section', 'tags', 'title', 'url']);
          assert.deepEqual(submission.tags, ['直播数据']);
        }
        await route.fulfill({
          status: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          json: data,
        });
      });
      const entry = footer.getByRole('button', { name: '提交推荐' });
      const footerRows = await footer.locator('.footer-links').evaluate((line) =>
        Array.from(line.querySelectorAll('a,button'), (item) => {
          const { top, height } = item.getBoundingClientRect();
          return top + height / 2;
        }));
      assert(footerRows.every((top) => Math.abs(top - footerRows[0]) < 1));
      const updatePanel = page.getByRole('dialog', { name: '更新记录' });
      assert.equal(await updatePanel.count(), 0);
      await entry.click();
      assert.equal(await recommendation.getByText(/审核结果|按编号查询|更新记录/).count(), 0);
      assert.equal(await recommendation.locator('[type=email], input[name=receipt], input[name=code]').count(), 0);
      assert.equal(await recommendation.locator('input[name=tags]:not([type=checkbox])').count(), 0);
      await recommendation.getByLabel('资源名称').fill('联调目录资源');
      await recommendation.getByLabel('资源链接').fill('https://example.org/qa');
      await recommendation.getByLabel('建议分区').selectOption('实用工具');
      await recommendation.getByLabel('简介').fill('本地或 CI 验收。');
      await recommendation.getByText('选择已有标签（选填）', { exact: true }).click();
      await recommendation.getByRole('checkbox', { name: '直播数据', exact: true }).check();
      await recommendation.getByRole('button', { name: '提交推荐', exact: true }).click();
      await recommendation.getByText('推荐已收到，感谢补充。', { exact: true }).waitFor();
      await recommendation.getByRole('button', { name: '关闭提交推荐' }).click();
      assert(await entry.evaluate((el) => el === document.activeElement));
      const updateEntry = footer.getByRole('button', { name: '更新记录', exact: true });
      await updateEntry.click();
      await updatePanel.getByRole('link', { name: '较新资源' }).waitFor();
      assert.deepEqual(await updatePanel.locator('article h3').allTextContents(), ['较新资源', '较早资源']);
      assert.deepEqual(await updatePanel.locator('article time').allTextContents(), ['2026.11.21', '2026.11.20']);
      assert.equal(await updatePanel.getByRole('link', { name: '较新资源' }).getAttribute('href'), 'https://example.org/recent');
      assert(await updatePanel.getByText('新增一条二创资源。', { exact: true }).isVisible());
      await updatePanel.getByRole('button', { name: '关闭更新记录' }).click();
      assert(await updateEntry.evaluate((el) => el === document.activeElement));
      await page.goto(new URL('about.html#hinome-eye', url).href);
      await siteDialog.waitFor();
      assert.equal(new URL(page.url()).pathname, new URL(homeUrl).pathname);
      await page.goto(homeUrl);

      assert.equal(await page.locator('h1').innerText(), '火市 技術課');
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${name}: horizontal overflow`,
      );
      const input = page.locator('#search');
      const layout = () => page.evaluate(() => {
        const { x, y, width, height } = document.querySelector('#catalog').getBoundingClientRect();
        return { x, y, width, height, footer: document.querySelector('footer').offsetTop };
      });
      const fullLayout = await layout();
      await input.fill('舰长');
      assert(await page.getByRole('link', { name: /万舰的风景/ }).isVisible());
      assert.equal(await page.getByRole('link', { name: /火の眼/ }).count(), 0);
      await input.fill('HANE VOYAGE');
      assert(await page.getByRole('link', { name: /火羽舰队/ }).isVisible());
      assert.equal(await page.getByRole('link', { name: /火の眼/ }).count(), 0);
      await input.fill('千舰');
      const archive = page.getByRole('link', { name: /千舰史料/ });
      assert(await archive.isVisible());
      assert.equal(
        await archive.getAttribute('href'),
        'https://hinome.renode-editor.com/',
      );
      assert.equal(
        await archive.locator('xpath=ancestor::section').locator('h2').innerText(),
        '实用工具',
      );
      const expectedSections = {
        '影像档案': ['BV1NR4y1o7bK', 'BV1iMnY6BEJb'],
        '亲历回顾': ['BV15e411V7kT', 'BV1wdpZ6hEQW', 'BV1W2Jv64EuG', 'BV1y5WF6KEuc'],
      };
      await input.fill('字幕检索');
      assert.deepEqual(await layout(), fullLayout);
      const subtitles = page.getByRole('link', { name: /直播回放字幕检索/ });
      assert(await subtitles.isVisible());
      assert.equal(await subtitles.getAttribute('href'), 'https://hinome-subtitles.pages.dev/');
      assert.deepEqual(await page.locator('#groups .group h2').allTextContents(), ['实用工具']);
      for (const [sectionTitle, videoIds] of Object.entries(expectedSections)) {
        await input.fill(sectionTitle);
        assert.deepEqual(await page.locator('#groups .group h2').allTextContents(), [sectionTitle]);
        const videoLinks = await page.locator('#groups .item').evaluateAll((items) =>
          items.map((item) => new URL(item.href).pathname.split('/')[2]),
        );
        assert.deepEqual(videoLinks, videoIds, sectionTitle);
      }
      await input.fill('完全不存在的搜索');
      assert.equal(await page.locator('#empty').isVisible(), true);
      assert.deepEqual(await layout(), fullLayout);
      await page.locator('#empty-clear').click();
      assert.deepEqual(await layout(), fullLayout);
      assert.equal(await page.locator('#groups .item').count(), initialCount);
      await input.fill('生日');
      await page.locator('#clear').click();
      assert.equal(await page.locator('#groups .item').count(), initialCount);
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
      assert.equal(await page.locator('#groups .item').count(), initialCount);
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
        .locator('#groups .item')
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
      const first = page.locator('#groups .item').first();
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
        `${name}: initial, order, icons, glass cards, search, aliases, empty, clear, shortcut, IME, external link, overflow and console passed`,
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

# 火市 技術課

火市・技术科汇集与火羽ひのめ有关的工具、二创和百科。访客在首页搜索框输入关键词，资源卡片随即筛选。桌面端可用 Ctrl/⌘ + K 聚焦搜索。

[公网首页](https://hinome-tech.pages.dev/) · [设计与来源](docs/brief.md) · [术语](CONTEXT.md) · [秋景素材来源](docs/image-source.md)

## 维护资源

资源集中在 `public/resources.js`。为每个资源填写名称、一句话介绍、HTTPS 来源链接、图标和标签。本人原投稿和完整回放归入「百科」。把一个资源放在最适合的分区，用标签或搜索别名覆盖其他常用说法。

## 本地预览与测试

```sh
python3 -m http.server 8080 --directory public
```

在浏览器打开 `http://127.0.0.1:8080/`。后台浏览器验收可以直接运行以下命令。

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

机器上已有 Chrome 时，可用 `CHROME_PATH` 指向其可执行文件。将网页地址作为参数传入 `node scripts/browser-smoke.cjs` 可以验收已经部署的页面。

## 发布

GitHub Actions 只在此仓库的 `main` 手动运行，使用上海阿里云专属 runner。Cloudflare Pages 项目为 `hinome-tech`，上传使用仓库 Actions Secrets 里的 Cloudflare Pages 编辑令牌和账号 ID。

单独验证候选可以在 `main` 运行工作流，不传发布标签。

```sh
gh workflow run publish.yml --ref main
```

正式发布时先推送候选、创建指向该提交的 Pre-release，并写明变更。然后传入候选标签。

```sh
gh workflow run publish.yml --ref main -f release_tag=v0.2.0
```

工作流在阿里云完成候选浏览器测试、Cloudflare 上传、公网文件比对及桌面和手机测试。公网验收通过后晋升正式 Release。

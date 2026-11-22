# 火市 技術課

火市・技术科汇集与火羽ひのめ有关的实用工具、百科资料、影像档案、亲历回顾和二创作品。访客在首页搜索框输入关键词，资源卡片随即筛选。桌面端可用 Ctrl/⌘ + K 聚焦搜索。

[公网首页](https://hinome-tech.pages.dev/) · [设计与来源](docs/brief.md) · [术语](CONTEXT.md) · [秋景素材来源](docs/image-source.md)

## 维护资源

资源集中在 `public/resources.js`。为每个资源填写名称、一句话介绍、HTTPS 来源链接、图标和标签。本人代表性投稿和重要直播回放归入「影像档案」，老观众及相关参与者的个人讲述归入「亲历回顾」。把一个资源放在最适合的分区，用标签或搜索别名覆盖其他常用说法。

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

GitHub Actions 只在此仓库的 `main` 手动运行，使用 GCP Cloud Run 按需弹性 runner（`hinome-tech-cloud`，`us-west1` 4 vCPU / 8 GiB）。Cloudflare Pages 项目为 `hinome-tech`，上传使用仓库 Actions Secrets 里的 Cloudflare Pages 编辑令牌和账号 ID。

单独验证候选可以在 `main` 运行工作流，不传发布标签。

```sh
gh workflow run publish.yml --ref main
```

正式发布时先推送候选、创建指向该提交的 Pre-release，并写明变更。然后传入候选标签。

```sh
gh workflow run publish.yml --ref main -f release_tag=v0.2.0
```

工作流在云端弹性 runner 完成候选浏览器测试、Cloudflare 上传、公网文件比对及桌面和手机测试。公网验收通过后晋升正式 Release。

## 提交推荐

首页页脚的「提交推荐」用于推荐资源。访客可以选填目录已有标签，最多选六个。旁边的「更新记录」按上线时间由近到远展示已经收录的资源，包含日期、名称、链接和简要介绍。

Worker 的私有 D1 保存投稿和审核进度。边缘请求限制、近一小时同一网络上限、链接去重、积压上限和全站滚动上限都在创建飞书审批前执行。全站最多 5 件／5 分钟及 30 件／24 小时，积压上限 100 件。Worker 每五分钟处理待办并回查审批，失败后退避重试，飞书实例按投稿编号去重。私有审批服务使用现有模板，仅站长在飞书审批。站长可以直接同意，也可以在详情中填写编辑意见。填写的意见原文独立传给目录编辑模型，用于编辑名称、简介和分区。意见为空时根据投稿原文整理。目录保留原链接及已选的已有标签。拒绝意见限站长后台查看。

通过后的内容进入 GitHub 发布队列，经发布工作流测试、部署、验收并晋升 Release。Worker 校验公网目录后，才把新增资源加入「更新记录」。GitHub 队列也可在 Actions 中手动运行，适用于定时检查被停用或延迟的情况。

### 推荐服务维护

- `worker/wrangler.toml` 指向生产 D1。只在目标数据库应用 `worker/migrations`。Worker 的 `PRIVATE_KEY` 用于生成不保存原始 IP 的限流键。保持稳定，轮换时以前的网络限流键会失效。
- `bridge/` 是 Google Cloud Run 的独立飞书服务。专用服务身份只读取自己的访问凭据和现有飞书应用密钥。它只允许创建和回查当前审批定义的站长实例。Worker 用 `FEISHU_BRIDGE_URL` 和加密的 `FEISHU_BRIDGE_TOKEN` 连接。飞书应用密钥保存在私有 Google Cloud 项目，提供给审批服务的运行时。
- `PUBLISH_TOKEN` 是 Worker 的发布队列访问密钥，与仓库 Actions 的 `RECOMMENDATION_PUBLISH_TOKEN` 值一致。GitHub 使用单次运行的仓库权限提交通过的目录内容，不需要单独的个人访问令牌。
- `INTAKE_MODE` 可设为 `closed`、`test`、`live`。部署时显式给定运行模式。test 模式仅受保护的 `POST /internal/test` 可建测试单；测试单有「联调·不公开」标识，不会进入更新记录或发布队列。测试完成后可使用已部署模式的回查任务验证编辑；操作时仅查询需要的状态字段。
- 本地运行 `npm run test:recommend`（Node 22 或更新）和 `npm run test:browser`。浏览器表单测试拦截投稿请求，不会给真实飞书审批添加单据。

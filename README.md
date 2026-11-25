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

每次网站发布都在 `public/releases.json` 顶部追加一条记录。`version` 为带 `v` 的版本号，`date` 为北京时间日期，`title` 概括更新，`changes` 逐条写实际变更。新增卡片可以用 `resources` 记录名称、分区、简介和链接。旧记录保留。页脚的版本号和「更新记录」都从这份文件读取。

正式发布时推送候选，创建指向该提交的 Pre-release，复用相同的版本号和变更说明，然后传入候选标签。

```sh
gh workflow run publish.yml --ref main -f release_tag=v0.4.9
```

工作流在云端弹性 runner 完成候选浏览器测试、Cloudflare 上传、公网文件比对及桌面和手机测试。公网验收通过后晋升正式 Release。

## 提交推荐

首页页脚的「提交推荐」用于推荐资源。访客可以选填目录已有标签，最多选六个。旁边的「更新记录」按上线时间由近到远展示历版功能改动、修复与新增资源。

Worker 的私有 D1 保存投稿和审核进度。边缘请求限制、近一小时同一网络上限、链接去重、积压上限和全站滚动上限都在创建飞书审批前执行。全站最多 5 件／5 分钟及 30 件／24 小时，积压上限 100 件。Worker 每五分钟处理待办并回查审批，失败后退避重试，飞书实例按投稿编号去重。私有审批服务使用现有模板，仅站长在飞书审批。站长可以直接同意，也可以在详情中填写编辑意见。目录保留原链接及已选的已有标签。拒绝意见限站长后台查看。

目录编辑先读取资源的可读正文、图片或 B 站视频的公开分镜与可用字幕。生成简介以来源内容为依据，站长意见用于取舍，投稿原简介留在审批端。新简介最多两句、42 字符，卡片最多显示两行。抓取失败或有效内容不足时，投稿保持待编辑并退避重试，后台记录 "retry_edit:source_unavailable"。

通过后的内容进入 GitHub 发布队列。工作流确认上一版已上线，将卡片与递增补丁版本的更新记录一起提交，再经测试、部署、验收并晋升 Release。重试沿用该资源已有的版本。Worker 继续校验公网目录并更新投稿状态。GitHub 队列也可在 Actions 中手动运行，适用于定时检查被停用或延迟的情况。

### 推荐服务维护

- `worker/wrangler.toml` 指向生产 D1。只在目标数据库应用 `worker/migrations`。Worker 的 `PRIVATE_KEY` 用于生成不保存原始 IP 的限流键。保持稳定，轮换时以前的网络限流键会失效。
- `bridge/` 是 Google Cloud Run 的独立飞书服务。专用服务身份只读取自己的访问凭据和现有飞书应用密钥。它只允许创建和回查当前审批定义的站长实例。Worker 用 `FEISHU_BRIDGE_URL` 和加密的 `FEISHU_BRIDGE_TOKEN` 连接。飞书应用密钥保存在私有 Google Cloud 项目，提供给审批服务的运行时。
- `PUBLISH_TOKEN` 是 Worker 的发布队列访问密钥，与仓库 Actions 的 `RECOMMENDATION_PUBLISH_TOKEN` 值一致。GitHub 使用单次运行的仓库权限提交通过的目录内容，不需要单独的个人访问令牌。
- `INTAKE_MODE` 可设为 `closed`、`test`、`live`。部署时显式给定运行模式。test 模式仅受保护的 `POST /internal/test` 可建测试单；测试单有「联调·不公开」标识，不会进入更新记录或发布队列。测试完成后可使用已部署模式的回查任务验证编辑；操作时仅查询需要的状态字段。
- 本地运行 `npm run test:recommend`（Node 22 或更新）和 `npm run test:browser`。浏览器表单测试拦截投稿请求，不会给真实飞书审批添加单据。

### 飞书三按钮审批卡

`APPROVAL_MODE=card` 只影响启用后收到的新投稿。新单由现有自建应用私聊发送一张卡片，卡上提供「同意」「同意并写意见」「拒绝」。后两项在同一张卡上展开输入区，确认后才记录决策。历史单按入队时记录的渠道继续处理。新单的站长决策、消息标识、回调事件和意见均保存在私有队列。收录编辑和发布仍使用同一套工作流。

在开发者后台的「事件与回调 › 回调配置」将 `card.action.trigger` 推送到 Cloud Run 的 `/feishu/card-callback`。应用使用既有的应用身份消息发送权限。Cloud Run 通过加密策略密钥核验飞书签名和时间，并比较应用、Verification Token 和站长身份。回调到 Worker 使用现有两服务共享凭据。密钥从 Google Cloud Secret Manager 挂载。应用中已有的事件订阅可保持原配置。

发送重试复用同一消息 UUID，保证在飞书去重有效期内重试。若卡片已送达但服务未收到确认，站长的有效操作可补齐消息标识。去重有效期前仍无法确认送达时，队列停在 `card_delivery_unconfirmed`，可核对原消息或由管理员在确认需要补发后清除该条待审记录的卡片标识与发送时间，再恢复调度。14 天以上的卡片已过期，也可按同样流程补发。清除后旧卡无法提交决策。禁止重置有决策、正在发送或原生渠道的记录。

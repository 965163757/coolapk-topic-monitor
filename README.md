# 酷窗 · 酷安 Web 工作台

基于 [Coolapk-UWP](https://github.com/Coolapk-UWP/Coolapk-UWP) 和 [Coolapk-API-Collect](https://github.com/Coolapk-UWP/Coolapk-API-Collect) 接口资料重新实现的响应式酷安 Web 客户端。首页、动态广场、应用与游戏、话题、统一搜索、用户主页、动态详情、评论及账号态互动都在站内完成；原有话题监控升级为其中的智能工作台模块。

服务每 5 分钟按发布时间增量采集监控话题，数据去重后写入长期归档。每个话题都可在关键词判断与 AI 判断中二选一；AI 可结合正文和图片给出 0–100% 的匹配度，达到阈值后进入飞书通知流程。

当前版本：**4.0.2**

## 4.0.2 视觉稳定性更新

- 线上默认直接进入工作台，不启用访问口令。
- 移除图片占位、运行状态和初始加载中的循环闪烁动画。

## 4.0.1 稳定性与安全更新

- 修复热门动态、评分频道和二手频道的失效上游入口，并给发现页增加 TTL/过期可用缓存。
- 增加完整的站点访问口令、服务端会话和锁定入口；生产环境启用后，全部业务 API 均要求登录。
- 搜索分页不再重复混入整份本地归档，分类与产品品牌页保留有效目录实体。
- AI 连接测试使用尚未保存的当前表单配置，连接探针保持纯文本并兼容多种 OpenAI-compatible 协议。
- 统一页码、畸形 URL 和上游异常响应契约；新增带模拟上游的 HTTP 集成回归测试。

## 3.4.2 图片体验与 CDN 更新

- 灯箱按真实可视区域计算适屏尺寸，超长竖图不会再被顶栏或底栏遮住；缩放、拖拽边界和横竖屏切换同步修正
- 灯箱首开按视口请求 960–1920px 的 WebP，只有继续放大时才升级到 1920px 高清版本，降低首次查看耗时与流量
- 图片响应使用一年不可变浏览器缓存，并同时输出 CDN/代理缓存头；重复浏览优先命中客户端、边缘或本机磁盘缓存
- 可通过 `IMAGE_CDN_BASE_URL` 接入自有 CDN/Pull Zone；服务端使用防循环的源站标记，CDN 故障时前端自动回退本站图片源站
- 酷安图片 CDN 会阻止第三方页面直接嵌入，因此默认仍使用受控代理，避免简单直链导致 Tencent EdgeOne 567 和图片空白

## 3.4.0 性能更新

- 图片列表按实际展示尺寸请求 WebP 缩略图，头像、卡片、Hero 与灯箱使用独立清晰度档位
- 图片代理增加内存 LRU、持久化磁盘缓存、并发请求合并、ETag/304、过期后台刷新与容量清理
- 首页公共数据增加 TTL、请求合并、过期继续服务和启动预热；主动刷新可使用 `refresh=1` 绕过缓存
- 大型归档采用紧凑快照、延迟合并写和轮询批量提交，避免读请求和每个话题重复阻塞落盘
- JS、CSS 与 JSON 自动使用 Brotli/Gzip 压缩，静态资源增加版本化长期缓存、ETag 和条件请求
- 首页热门话题改为非阻塞加载，公共首屏状态并行读取，并增加会话级缓存
- 首图优先加载，其他图片由 IntersectionObserver 按视口加载；离屏卡片使用 `content-visibility`
- 移除未使用的粗体图标字体，只保留并预加载常规 WOFF2 字体

## 3.3.0 重点更新

- 首页推荐保留酷安上游顺序，频道切换、分页加载和快速连续点击使用独立请求状态
- “今日酷安”“热闻”“值得看”等动态专题通过安全页面标识在站内打开
- 首页热门话题从真实话题榜单读取，展示标题与 `/t/` 中的规范话题名分离
- 公开详情统一使用 `topic:<话题名>` / `product:<产品 ID>` 标识，话题和数码产品不再混淆
- 话题详情支持最新发布、最近回复、热门内容三种排序及分页加载
- 列表动态最多保留 12 张图片，与沉浸式多图画廊完整衔接

## 运行

需要 Node.js 20 或更高版本：

```powershell
cd monitor-web
npm install
npm start
```

打开 `http://localhost:4173`。前端“系统设置”可配置 AI 和飞书；密钥只写入服务端 `data/settings.json`，读取设置接口只返回掩码和配置状态。

## Web 客户端功能

- 酷安首页头条、轮播、快捷频道和推荐动态
- 今日酷安、热闻、值得看、官方频道、头条榜等动态专题站内浏览
- 最新 / 热门动态广场，站内动态详情与分页评论
- 应用与游戏列表、评分、版本资料、更新说明、截图与所属动态
- 热门话题目录、话题搜索、三种排序的话题详情、数码产品讨论及一键加入监控
- 帖子、话题、用户、应用统一搜索
- 用户公开主页、动态/文章/问答/收藏/关注/粉丝分栏及本站历史归档
- 酷安账号会话连接与校验，服务端加密字段遮罩
- 点赞/取消点赞、关注/取消关注用户与话题、发布动态、回复动态与评论
- 回复、@、获赞、新增关注、私信会话和未读数
- 个人动态、文章、问答、收藏单、关注、粉丝、浏览历史与常去页面
- 收藏单详情、内容列表、关注和点赞
- 动态点赞用户、转发记录与编辑历史（公开数据无需登录）
- 图片服务端代理、失败降级、全屏自适应画廊、缩略图切换、滚轮/双击/双指缩放与拖动查看
- 发布器本地草稿、字符计数、话题/@ 快捷插入、图片拖放/粘贴与上传进度
- 站内分享、酷安 App Deep Link 与网页兜底入口
- 浅色 / 深色主题、可折叠桌面导航、移动底栏和完整响应式布局
- 首页、快讯、问答、闲聊、开箱、摄影、教程、汽车、外设、视频、美化、好物、二手、评分、数码及应用排行等频道适配

### 环境变量

生产环境建议用环境变量注入密钥，它们的优先级高于页面保存值：

```powershell
$env:PORT=4173
$env:POLL_INTERVAL_MS=300000
$env:APP_ACCESS_TOKEN="GENERATE_A_STRONG_RANDOM_VALUE"
$env:APP_ACCESS_SESSION_TTL_SECONDS=604800
$env:IMAGE_MEMORY_CACHE_BYTES=50331648
$env:IMAGE_DISK_CACHE_BYTES=536870912
$env:IMAGE_DISK_CACHE_ENTRIES=2000
$env:IMAGE_CACHE_FRESH_MS=604800000
$env:IMAGE_FETCH_MAX_ACTIVE=12
$env:IMAGE_FETCH_MAX_QUEUED=64
$env:IMAGE_CDN_BASE_URL="https://cdn.example.com/"
$env:OPENAI_API_KEY="OPENAI_API_KEY"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:OPENAI_MODEL="gpt-5.6-luna"
$env:FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/TOKEN"
$env:FEISHU_WEBHOOK_SECRET="SIGNING_SECRET"
$env:COOLAPK_UID="COOLAPK_UID"
$env:COOLAPK_USERNAME="COOLAPK_USERNAME"
$env:COOLAPK_TOKEN="COOLAPK_TOKEN"
npm start
```

设置 `APP_ACCESS_TOKEN` 后，浏览器首次打开会显示访问口令页。口令仅用于换取 `HttpOnly; SameSite=Strict` 服务端会话 Cookie，不会写入前端存储；未设置该变量时保持本地开发模式。

酷安会话也可在“账号中心”导入。页面只显示 Token 掩码，完整会话仅存放在服务器 `data/settings.json`；环境变量的优先级更高。

## 使用流程

1. 点击“添加监控话题”，搜索或直接输入准确话题名。
2. 打开“系统设置”，配置 OpenAI API Key、模型和飞书 V2 自定义机器人 Webhook，并分别执行连接测试。
3. 在某个话题顶部点击“配置 AI”，填写具体关注意图，例如商品类别、异常价格条件及排除项。
4. 可先“分析当前数据”检查判断质量；这次预览不会发送飞书通知。
5. 后续每轮抓取只分析新帖子，达到阈值后自动推送，并在“AI 命中”中保留判断与投递记录。

## 智能监控功能

- 多话题监控、关键词搜索、直接添加、移除与手动刷新
- 5 分钟后台轮询、增量翻页采集与上次成功游标
- 归档工作台分页、每页 20/50/100 条、全库关键词与 AI 命中筛选
- 站内动态详情、分页评论、图片代理与自适应多图画廊
- 每话题在“关键词判断”和“AI 判断”中严格二选一；两种模式不会串行或混合执行
- AI 判断分别保存“需要关注”和“明确排除”，排除项优先于正向条件；关键词命中可直接推送飞书
- AI 默认按每批 8 条合并识别，兼容失败或结果遗漏时自动回退到单条判断
- OpenAI Responses API 结构化判断，可选低清图片联合识别
- OpenAI、Anthropic Messages、Gemini GenerateContent 与 OpenAI 兼容接口的自动适配
- 飞书 V2 Webhook、可选签名校验、测试通知；命中推送包含帖子标题、正文、酷安 App/网页跳转、图片入口与判断原因
- 帖子搜索、全站新鲜/热门动态、用户公开主页与历史动态回溯
- 默认展示排序（发布时间 / 最后更新 / 热度）与工作台排序（时间 / 热度 / AI 匹配度）
- 去重处理、命中历史、错误状态、配置持久化、归档清理与健康检查
- 桌面和移动端响应式布局

## 来源与许可

本项目是独立的 Web 重写，不包含原 UWP 项目的 C#/XAML 源文件。功能信息架构和接口适配参考 Coolapk-UWP；依照其 GPL-3.0 许可，本目录以 GPL-3.0 发布，详见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 数据文件

- `data/state.json`：话题、动态缓存和最近 AI 判断
- `data/settings.json`：AI/飞书设置与已处理动态 ID
- `data/archive.json`：长期帖子归档、帖子详情首屏评论、AI 判断、用户公开资料与系统活动

以上运行时数据均被 `.gitignore` 排除。归档采用原子写入和串行落盘；在“系统设置 → 数据保留策略”中可设置帖子、AI 判断、用户资料保留时长和容量上限，也可立即执行清理。正式部署时请限制数据目录的操作系统访问权限，并通过反向代理启用 HTTPS 与访问控制。

详细的分层设计、保留策略与数据流见 [docs/architecture.md](docs/architecture.md)，UWP 功能对应关系见 [docs/feature-matrix.md](docs/feature-matrix.md)。

## 接口

- `GET /api/web/channels`：Web 客户端可用频道
- `GET /api/web/channel?channel=home&page=1`：首页、数码、话题、应用等固定频道的标准化内容；首页保留上游推荐顺序
- `GET /api/web/page?source=V8_JINRI_NEWS&page=1`：读取酷安动态专题页；`source` 支持安全页面标识及受控的 `#/feed`、`#/article`、`#/topic`、`#/product`、`#/apk` 站内列表目标
- `GET /api/search/all?q=关键词`：帖子、话题、用户和应用统一搜索
- `GET /api/apps/:id`：应用详情、截图与所属动态
- `GET /api/web/topics/:source?page=1&sort=dateline_desc|lastupdate_desc|popular`：公开话题或数码产品详情与动态；`source` 推荐使用 URL 编码后的 `topic:<话题名>` 或 `product:<产品 ID>`，同时兼容旧版纯话题名
- `GET /api/health`：进程健康状态
- `GET /api/status`：抓取与 AI 运行状态
- `GET|PUT /api/settings`：安全读取或更新集成设置
- `GET|PUT|DELETE /api/account`、`POST /api/account/test`：酷安会话状态、连接、断开与校验
- `GET /api/notifications`、`GET /api/notifications/counts`、`GET /api/messages`：通知、未读数与私信会话
- `POST /api/feeds`：发布动态
- `POST /api/feeds/:id/replies`、`POST /api/replies/:id/replies`：回复动态或评论
- `POST /api/interactions/feeds/:id/like`、`POST /api/interactions/replies/:id/like`：点赞或取消点赞
- `POST /api/interactions/users/:uid/follow`、`POST /api/interactions/topics/:tag/follow`：关注或取消关注
- `GET /api/users/:uid/feeds`、`GET /api/users/:uid/collections`、`GET /api/users/:uid/connections`：用户完整内容
- `GET /api/collections/:id`：收藏单详情、动态与应用
- `GET /api/account/history`：浏览历史和常去内容
- `POST /api/integrations/test-ai`：测试 AI 连接
- `POST /api/integrations/test-feishu`：发送飞书测试消息
- `GET /api/topics`：监控话题及最新动态
- `GET /api/dashboard/feeds?page=1&pageSize=20&topic=话题&sort=created_desc`：监控归档分页、筛选和排序
- `POST /api/topics`：添加监控话题
- `PATCH /api/topics/:tag`：更新话题 AI 规则
- `DELETE /api/topics/:tag`：停止监控
- `POST /api/topics/:tag/analyze`：手动分析当前动态
- `GET /api/topics/search?q=关键词`：搜索话题
- `GET /api/evaluations?page=1&pageSize=50&status=matched|all&topic=话题名`：按话题筛选、去重后的当前判断、分页记录与聚合统计
- `GET /api/feeds/:id`：动态完整详情及第一页评论
- `GET /api/feeds/:id/replies?page=2`：分页评论
- `GET /api/image?url=图片地址&w=720&q=78&format=webp`：带尺寸转换、两级缓存、长期客户端/CDN 缓存与条件请求的酷安图片代理
- `GET /api/search/feeds?q=关键词&sort=dateline_desc|lastupdate_desc|popular`：帖子搜索（远端候选、监控缓存和归档联合检索）
- `GET /api/discovery/feeds?mode=recent|hot`：全站新鲜或热门动态
- `GET /api/search/users?q=关键词`：用户搜索
- `GET /api/users/:uid`：用户公开主页与本地历史动态
- `GET /api/archive/summary`、`GET /api/archive/feeds`：归档统计与检索
- `GET /api/activity`：系统活动
- `POST /api/maintenance/cleanup`：按当前保留策略执行清理

## 验证

```powershell
npm test
node --check server.js
node --check public/app.js
```

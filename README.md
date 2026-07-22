# 话题雷达

面向长期运行的酷安话题监控工作台。服务每 5 分钟按发布时间增量采集监控话题，数据去重后写入长期归档；工作台可分页回看全部历史。每个话题都可配置自然语言关注意图，由 AI 结合正文和图片给出 0–100% 的匹配度，达到阈值后进入飞书通知流程。

## 运行

需要 Node.js 20 或更高版本：

```powershell
cd monitor-web
npm install
npm start
```

打开 `http://localhost:4173`。前端“系统设置”可配置 AI 和飞书；密钥只写入服务端 `data/settings.json`，读取设置接口只返回掩码和配置状态。

### 环境变量

生产环境建议用环境变量注入密钥，它们的优先级高于页面保存值：

```powershell
$env:PORT=4173
$env:POLL_INTERVAL_MS=300000
$env:OPENAI_API_KEY="OPENAI_API_KEY"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:OPENAI_MODEL="gpt-5.6-luna"
$env:FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/TOKEN"
$env:FEISHU_WEBHOOK_SECRET="SIGNING_SECRET"
npm start
```

## 使用流程

1. 点击“添加监控话题”，搜索或直接输入准确话题名。
2. 打开“系统设置”，配置 OpenAI API Key、模型和飞书 V2 自定义机器人 Webhook，并分别执行连接测试。
3. 在某个话题顶部点击“配置 AI”，填写具体关注意图，例如商品类别、异常价格条件及排除项。
4. 可先“分析当前数据”检查判断质量；这次预览不会发送飞书通知。
5. 后续每轮抓取只分析新帖子，达到阈值后自动推送，并在“AI 命中”中保留判断与投递记录。

## 已实现

- 多话题监控、关键词搜索、直接添加、移除与手动刷新
- 5 分钟后台轮询、增量翻页采集与上次成功游标
- 归档工作台分页、每页 20/50/100 条、全库关键词与 AI 命中筛选
- 三栏拖拽调宽、键盘调宽、布局本地记忆
- 站内动态详情、分页评论、图片代理与可缩放/拖动画廊
- 每话题独立 AI 关注意图、匹配阈值、通知开关；空阈值继承全局设置
- OpenAI Responses API 结构化判断，可选低清图片联合识别
- OpenAI、Anthropic Messages、Gemini GenerateContent 与 OpenAI 兼容接口的自动适配
- 飞书 V2 Webhook、可选签名校验、测试通知；命中推送包含帖子标题、正文、酷安 App/网页跳转、图片入口与判断原因
- 帖子搜索、全站新鲜/热门动态、用户公开主页与历史动态回溯
- 默认展示排序（发布时间 / 最后更新 / 热度）与工作台排序（时间 / 热度 / AI 匹配度）
- 去重处理、命中历史、错误状态、配置持久化、归档清理与健康检查
- 桌面和移动端响应式布局

## 数据文件

- `data/state.json`：话题、动态缓存和最近 AI 判断
- `data/settings.json`：AI/飞书设置与已处理动态 ID
- `data/archive.json`：长期帖子归档、帖子详情首屏评论、AI 判断、用户公开资料与系统活动

以上运行时数据均被 `.gitignore` 排除。归档采用原子写入和串行落盘；在“系统设置 → 数据保留策略”中可设置帖子、AI 判断、用户资料保留时长和容量上限，也可立即执行清理。正式部署时请限制数据目录的操作系统访问权限，并通过反向代理启用 HTTPS 与访问控制。

详细的分层设计、保留策略与数据流见 [docs/architecture.md](docs/architecture.md)。

## 接口

- `GET /api/health`：进程健康状态
- `GET /api/status`：抓取与 AI 运行状态
- `GET|PUT /api/settings`：安全读取或更新集成设置
- `POST /api/integrations/test-ai`：测试 AI 连接
- `POST /api/integrations/test-feishu`：发送飞书测试消息
- `GET /api/topics`：监控话题及最新动态
- `GET /api/dashboard/feeds?page=1&pageSize=20&topic=话题&sort=created_desc`：监控归档分页、筛选和排序
- `POST /api/topics`：添加监控话题
- `PATCH /api/topics/:tag`：更新话题 AI 规则
- `DELETE /api/topics/:tag`：停止监控
- `POST /api/topics/:tag/analyze`：手动分析当前动态
- `GET /api/topics/search?q=关键词`：搜索话题
- `GET /api/evaluations?page=1&pageSize=50&status=matched|all`：去重后的当前 AI 判断、分页记录与聚合统计
- `GET /api/feeds/:id`：动态完整详情及第一页评论
- `GET /api/feeds/:id/replies?page=2`：分页评论
- `GET /api/image?url=图片地址`：酷安图片代理
- `GET /api/search/feeds?q=关键词&sort=created_desc`：帖子搜索（远端候选、监控缓存和归档联合检索）
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

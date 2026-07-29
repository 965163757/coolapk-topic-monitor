# Coolapk-UWP → Web 功能映射

| UWP 模块 | Web 页面 / 站内能力 | 服务端接口 |
| --- | --- | --- |
| 首页与分类频道 | 首页、快讯、问答、闲聊、数码、酷图、教程等 | `/api/web/channel` |
| 动态广场 | 最新、热门、分页加载 | `/api/discovery/feeds` |
| 动态详情 | 正文、原图、评论、点赞用户、转发、编辑历史 | `/api/feeds/:id/*` |
| 发布与回复 | 文字、最多 9 张图片、动态回复、评论回复 | `POST /api/feeds`、`POST /api/*/replies` |
| 应用市场 | 应用/游戏列表、详情、版本、评分、截图、相关动态 | `/api/apps/:id` |
| 话题 | 热门话题、搜索、详情、关注、动态列表 | `/api/web/topics/:tag` |
| 用户主页 | 资料、动态、文章、问答、收藏单、关注与粉丝 | `/api/users/:uid/*` |
| 收藏单 | 详情、动态、应用、关注与点赞 | `/api/collections/:id` |
| 通知中心 | 回复、@动态、@回复、获赞、新增关注、未读数 | `/api/notifications*` |
| 私信 | 会话列表、未读数、置顶状态 | `/api/messages` |
| 我的 | 动态、文章、问答、收藏、关注、粉丝、历史、常去 | `#/account` |
| 账号会话 | 导入、校验、遮罩显示、断开 | `/api/account` |
| 全局搜索 | 帖子、话题、用户、应用 | `/api/search/all` |
| 主题与布局 | 浅色/深色、桌面侧栏、移动底栏、弹层详情 | 前端本地偏好 |
| 话题监控 | 定时抓取、长期归档、关键词/AI 二选一、飞书 | `/api/topics`、`/api/evaluations` |

账号态请求沿用 Coolapk-UWP 的 `uid`、`username`、`token` Cookie 结构。完整 Token 只保存在服务端设置文件或环境变量中，公开设置接口只返回掩码。

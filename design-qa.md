# Design QA — V4「轻盈指挥台」

## 视觉真相与验收环境

- 选定方案：`C:\Users\Yuan\.codex\generated_images\019f7ac1-9d86-7f52-a617-a36b3f82b456\call_xcfhmnWb6Vy2mGLJlG5iOZhT.png`
- 本地参考副本：`C:\Users\Yuan\Desktop\My\Coolapk-API-Collect\monitor-web\design-audit\v4-reference.png`
- 最终桌面截图：`C:\Users\Yuan\Desktop\My\Coolapk-API-Collect\monitor-web\design-audit\v4-home-desktop.png`
- 最终移动端截图：`C:\Users\Yuan\Desktop\My\Coolapk-API-Collect\monitor-web\design-audit\v4-home-mobile.png`
- 深色模式截图：`C:\Users\Yuan\Desktop\My\Coolapk-API-Collect\monitor-web\design-audit\v4-home-dark.png`
- 详情与图片灯箱：`design-audit\v4-feed-detail.png`、`design-audit\v4-lightbox.png`
- 聚焦对照图：`C:\Users\Yuan\Desktop\My\Coolapk-API-Collect\monitor-web\design-audit\v4-comparison-top-final.png`
- 视口：1487 × 1058 CSS px，DPR 1；参考图：1487 × 1058 px
- IAB 原始截图为 1472 × 1047 px（浏览器截图不含滚动条沟槽）；仅为并排比较使用高质量双三次插值归一到 1487 × 1058 px
- 页面状态：首页、浅色模式、实时数据

## 视觉检查

- **字体**：正文与控件字号统一收敛到 14–16 px，标题层级清晰；宽屏与手机端均保持可读。
- **间距**：单行顶栏、频道栏、话题榜、信息流和右侧 AI 指挥卡形成稳定的 8/12/16/24 px 节奏。
- **色彩**：浅灰画布、纯白卡片、克制蓝色主色和橙色提示色与选定方案一致；深色模式具备独立对比度。
- **图片**：信息流缩略图按固定容器裁切；灯箱使用 contain 适配整屏，可切换图片、缩放、下载和关闭。
- **文案**：移除冗长说明；AI 命中优先展示内容标题/原因，不再生成“某某的动态”。
- **结构**：桌面采用横向主导航与右侧 AI 指挥卡；手机采用紧凑 AI 摘要、折叠菜单和底部五栏导航。

## 交互检查

- 首页频道切换、刷新、加载更多、动态详情、用户主页、话题详情和添加监控均可操作。
- 动态详情在站内原生弹窗显示正文与评论；已验证 20 条评论。
- 图片灯箱可完整显示 1500 × 992 原图，最大适配区域 1331 × 884，无上半部分裁切。
- 热门话题弹窗、动态页、应用页、话题页、监控页、AI 命中页和系统设置页均可进入。
- 话题搜索与全局搜索可使用按钮或 Enter 提交。
- 监控添加面板与搜索结果选择链路可用。
- 更多菜单在路由切换与 Escape 后正确关闭；移动菜单同步维护 `aria-expanded`。
- 手机端“更多”保留写动态、通知、刷新、主题和账号入口；900 px 平板顶栏无隐藏或品牌/搜索重叠。
- 浅色/深色切换的标签和状态正确；`prefers-reduced-motion` 下关闭非必要动画。
- 1487 × 1058 与 390 × 844 均无页面级横向溢出。
- 浏览器控制台 error / warning：0。

## 对照迭代

1. **初版**：旧侧栏与 CRM 表格占据视觉中心，未形成选定方案的水平顶栏、话题榜和指挥卡层级。
2. **第二版**：修复首页初始化时 AI 命中为空、手机端 AI 卡过长、全局搜索 Enter 偶发失效、主题切换标签不同步。
3. **最终版**：关闭移动端快捷功能不可达、平板顶栏位移与首页慢接口阻塞问题；布局几何、色彩、密度和层级与参考方向一致。实时内容、头像和配图随接口变化，作为产品数据差异保留。

## 自动检查

- `node --check public/app.js`：通过
- `npm test`：68/68 通过
- `git diff --check`：通过

## 最终结果

passed

# CLAWeb Stage Summary — 2026-03-13

> 目的：给当前 `claweb` 仓库与运行中的测试站一个清晰的阶段基线，避免后续继续靠聊天记录续工。

## 1. 当前阶段判断

CLAWeb 已从“功能打通期”进入“可持续打磨期”。

这意味着：
- 基础文本闭环已成立；
- 公网测试入口已可真实使用；
- 图片链路与富文本主干已完成一轮真实验证；
- 当前更需要做的是工程收口、能力扩展与长期打磨，而不是继续停留在 MVP-0 级别的可用性怀疑。

一句话总结：**现在已经是可持续测试、可继续扩展、但尚未完全定稿的产品雏形。**

---

## 2. 已完成且已验证的内容

### 2.1 基础闭环
- `hello -> ready -> message -> assistant` 文本闭环已在 nuomi / claweb 测试线上验证通过。
- `claweb` 仓库已达到 GitHub 公开最低可交付状态并已公开发布。

### 2.2 公网参考客户端入口
- 现网已存在 `/claweb/` 浏览器参考客户端入口，与旧 webchat 并行。
- 该入口已完成真实公网访问与用户侧消息往返验证。

### 2.3 图片链路
- 图片 payload 已恢复正常透传。
- 重复图片根因已确认：同一 `turnId` 被上游拆成 `media-only` 与 `text+same media` 两帧。
- 当前前台表现已恢复为单次“文字+图”。

### 2.4 富文本 MVP-1
当前已支持并完成真实测试：
- 段落 / 换行
- emoji / 常见符号
- 粗体 / 斜体 / 行内代码
- 代码块
- 列表
- 引用
- 安全链接
- 反斜杠转义字面量显示

### 2.5 Reply 体验
- composer 上方的 reply banner 已改为紧凑摘要，不再整段占位。
- 消息气泡中的 reply preview 已改为单行省略摘要。
- 历史记录已补入 `replyPreview` 传输 / 落盘 / 回填逻辑，不再频繁退化为 `Reply to: (message not in view)`。

### 2.6 样式精修（当前阶段够用）
- 代码块、引用块、列表、链接已做一轮观感优化。
- 当前状态可继续真实测试，但 UI 仍属于长期打磨项，不建议现在陷入细枝末节。

---

## 3. 本轮关键经验

### 3.1 媒体问题不要先猜前端
若出现图片重复或异常：
- 先确认上游 frame 是否已重复下发；
- 区分“没透传”与“重复下发”；
- 不要仅靠前端合并或延长 coalesce 时间掩盖问题。

### 3.2 改了代码但界面没变化，不一定是服务没重启
本轮已明确遇到静态资源缓存导致旧 JS 继续生效的问题。

排查顺序建议：
1. 运行中的服务是否已 reload / restart
2. 浏览器是否仍在吃旧版静态资源
3. 是否需要 bump 资源版本号强制刷新

### 3.3 reply 只存 `replyTo id` 不够
如果历史恢复阶段只有 `replyTo` 而无 `replyPreview`：
- 视图内找不到原消息时就只能退化显示；
- 所以 reply 相关能力若想稳定，必须尽量同步保存引用摘要。

---

## 4. repo 与测试站的关系（重要）

当前存在两套角色不同的实体：

### 4.1 仓库基线：`/root/.openclaw/workspace/claweb`
定位：
- 正式 `claweb` 项目仓库
- 含插件主线、文档、examples、发布元信息

### 4.2 运行中的测试站：`/opt/claweb-example`
定位：
- frontdoor 独立运行实例
- 面向真实测试、真实用户验证
- package 与目录结构会更偏部署实例，而不是插件仓库

### 4.3 当前判断
repo 与测试站存在结构性差异是正常的；
但**关键前端与 frontdoor 逻辑必须持续回灌到 repo 基线**。

本轮已确认关键文件已同步回 repo：
- `examples/frontdoor/server.js`
- `public/claweb/app.js`
- `public/claweb/index.html`
- `public/claweb/style.css`

---

## 5. 当前明确“不做/暂不做”的边界

当前富文本仍刻意不支持：
- 原始 HTML
- 任意内联样式
- 复杂表格
- 脚本类内容

原则：
- 继续采用 markdown 安全子集；
- 前端渲染优先，避免服务端直接拼 HTML；
- 若未来扩能力，也保持 sanitize / 白名单策略。

---

## 6. 架构原则（后续必须遵守）

### 6.1 CLAWeb 的定位
CLAWeb 应被视为 **OpenClaw 的 client-facing channel**，而不是一个被局限在网页里的聊天页项目，也不是一套独立协议、独立媒体系统或独立生成框架。

它的职责是：
- 承接 OpenClaw 已有消息与媒体输出；
- 提供面向客户端接入的 channel 语义（session / reply / history / media）；
- 提供 reference access layer（如 frontdoor / login / history / ws）；
- 提供一个或多个 reference client；当前仓库中的浏览器 UI 只是第一个参考客户端；
- 在不分叉协议的前提下增强客户端体验，而不是把能力锁死在 browser page 上。

### 6.2 兼容方向
后续原则应固定为：
- **不是让 OpenClaw 适配某一个 CLAWeb 客户端；**
- **而是让 CLAWeb 作为 channel 尽量兼容 OpenClaw。**
- **不是让 CLAWeb 去适配某个脚本；而是让脚本/skill 先适配 OpenClaw。**
- **不是把 browser client 当成 channel 本体；而是把 browser / app / pc client 都视为可复用同一 channel 语义的接入端。**

也就是说：
- OpenClaw 已支持的脚本、skill、plugin 输出格式，CLAWeb 应尽量直接承接；
- 脚本若要进入这条链路，应优先输出 OpenClaw 标准消息/媒体格式，而不是要求 CLAWeb 为其增加私有兼容逻辑；
- 不应为了某个单点需求，在 CLAWeb 内部另造一套专用协议或专用媒体语义。

### 6.3 媒体交接标准
媒体交接遵循 OpenClaw 现有标准：
- 文本指令：`MEDIA:<path-or-url>`
- 结构化字段：`mediaUrl` / `mediaUrls`

明确不新增：
- `VIDEO:`
- `IMAGE:`
- `ASSET:`
- 其他 CLAWeb 私有前缀或专用返回协议

### 6.4 视频能力边界
视频生成逻辑属于模型 / skill / 脚本层，不属于 CLAWeb。

CLAWeb 对视频的职责仅包括：
- 接住上游已生成的视频结果；
- 识别其媒体类型；
- 在各客户端正确展示（当前已验证的是 browser reference client）。

因此，后续视频接入目标不是“给 CLAWeb 增加视频生成逻辑”，而是：
- 让上游视频结果稳定落到 OpenClaw 标准媒体格式；
- 再由 CLAWeb 原样承接与展示。

---

## 7. 下一阶段建议顺序

### P1. 工程收口（最高优先级）
建议先完成：
- 把本轮已验证的改动整理成清晰提交；
- 确认 repo 与测试站关键逻辑继续对齐；
- 减少“测试站修好了，但仓库没跟上”的漂移风险。

### P2. OpenClaw 兼容性收口
建议优先围绕“兼容 OpenClaw，而非自造协议”推进：
- 盘点当前 CLAWeb 已兼容的 OpenClaw 媒体/消息输出形式；
- 定位仍然带有 CLAWeb 私有语义的承接点；
- 先补媒体（尤其视频）结果承接，不把生成逻辑塞进前端通道层。

### P3. 富文本能力扩展
在当前稳定基础上，下一批值得补的内容：
- 标题
- 分隔线
- task list
- 更细的嵌套规则

### P4. 参考客户端体验增强
后续可继续推进：
- 搜索 / 定位消息增强
- 图片与文本混排细节
- token 免手填 / 登录体验优化
- 多轮历史恢复与线程体验优化
- 为未来 app / pc 客户端沉淀更清晰的 client contract

### P5. UI 长期打磨
当前样式已够用；
后续可按真实使用慢慢 polish，而不是当前阶段优先事项。

---

## 7. 建议的下一步动作

如果只做两个动作，建议按这个顺序：

1. **先做一次收口提交**
   - 主题围绕：rich text MVP、reply preview compaction、history replyPreview fallback、cache busting、frontdoor sync。

2. **再开下一轮能力扩展**
   - 首选：标题 / 分隔线 / task list。

---

## 8. 当前状态一句话版（给以后续工用）

> CLAWeb 当前已完成作为 OpenClaw client-facing channel 的第一条参考实现基线：文本闭环、公网 browser reference client、图片链路收口、富文本安全子集、reply preview 摘要与历史回填都已跑通；下一步应继续把“channel 语义”与“reference clients”分层，而不是把仓库定义锁死在网页端。

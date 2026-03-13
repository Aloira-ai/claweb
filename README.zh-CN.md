# claweb

[English](./README.md) | [简体中文](./README.zh-CN.md)

OpenClaw 的一个面向客户端接入的 channel，以及一个浏览器参考客户端。

`claweb` 的目标是：**让路由、会话、回复流继续留在 OpenClaw 内部**，同时暴露一个可被 Web、App、PC 客户端等形态共同接入的 channel 表面，而不是把能力锁死在某个单一网页 UI 里。当前仓库中的浏览器 UI 只是第一个参考客户端，不是这个 channel 的全部边界。

## 这个仓库包含什么

- OpenClaw 的 WebSocket channel plugin 运行时。
- 面向客户端接入的 channel 语义：session、reply、history、media handoff。
- 位于 `public/claweb/` 的公开浏览器参考客户端。
- 位于 `examples/` 的示例配置（OpenClaw 配置与固定身份映射示例）。
- 一个可选的“frontdoor”参考宿主，位于 `examples/frontdoor/`：
  - 提供客户端入口 UI
  - 实现 `/login` / `/history` / `/ws`
  - 并把消息代理到上游 `claweb` channel

## 当前范围（v0.2.0）

当前仓库已经包含一条经过验证的、面向客户端接入的 CLAWeb 基线，而浏览器 UI 是第一个参考客户端：

- `hello -> ready -> message` WebSocket 基本流程。
- 浏览器侧的消息归一化与去重（兼容实时消息 + 历史回放）。
- 用户 echo 识别，避免 role 混乱导致重复展示。
- 历史回放兼容稳定排序（`ts`, `_idx`）。
- channel 协议语义：`hello -> ready -> message`、reply 关联、history 回放、media handoff。
- 浏览器参考客户端中的富文本安全子集：段落、换行、emoji、粗体、斜体、行内代码、代码块、列表、引用、安全链接。
- reply preview 紧凑摘要与历史回填。
- 浏览器参考客户端在页面刷新 / 切后台后的 session 恢复与自动重连。
- 浏览器参考客户端的图片上传链路：普通图片默认原图发送，仅超大图走压缩兜底。
- client / frontdoor 对 OpenClaw 标准媒体交接（`MEDIA:` / `mediaUrl`）的兼容承接。

当前 **仍不在本仓库范围内**：

- 人格 / prompt / 记忆注入逻辑。
- Telegram 或其他私有适配层。
- 完整生产认证体系与运维加固。
- 原始 HTML 富文本、任意内联样式、复杂表格、可执行内容。
- 让 CLAWeb 自己承担视频生成或业务编排逻辑。

## 仓库结构

- `index.ts`：插件入口与 channel 注册。
- `src/`：channel 运行时实现。
- `public/claweb/`：浏览器参考客户端（`index.html`, `style.css`, `app.js`）。
- `examples/openclaw.config.example.jsonc`：最小 OpenClaw 插件配置示例。
- `examples/claweb-login.example.json`：固定身份映射示例（仅占位符，不含真实密钥）。
- `examples/frontdoor/`：reference access host 示例。

## 快速开始

1. 安装依赖：`npm install`
2. 静态检查：`npm run typecheck`
3. 在 OpenClaw profile 中加载插件。
4. 参考 [`examples/openclaw.config.example.jsonc`](./examples/openclaw.config.example.jsonc) 配置 `channels.claweb`。
5. 用你的 Web 服务托管 `public/claweb/`，并接好这些接口：
   - `POST /claweb/login`
   - `GET /claweb/history`
   - `WS /claweb/ws`

## 文档入口

- channel 架构分层：[`docs/channel-architecture.md`](./docs/channel-architecture.md)
- 浏览器参考客户端接入约定：[`docs/frontend-integration.md`](./docs/frontend-integration.md)
- 项目范围与边界：[`docs/project-scope.md`](./docs/project-scope.md)
- 回归检查清单：[`docs/regression-checklist.md`](./docs/regression-checklist.md)
- 状态模型（raw / recent / runtime）：[`docs/state-model.md`](./docs/state-model.md)
- 当前阶段总结：[`docs/internal/CLAWeb-STAGE-SUMMARY.md`](./docs/internal/CLAWeb-STAGE-SUMMARY.md)

## 对外发布定位

- 这个仓库目前偏向 **公开源码项目**，当前里程碑已进入 `0.2.x`。
- 适合打 GitHub Release / tag，但仍未启用 npm 发布。
- `package.json` 里保留了 `"private": true`，用于避免误发布到 npm。

## 安全说明

- 不要提交真实口令、token、用户映射文件。
- Git 中只保留示例占位配置。
- 在没有明确完成网络加固前，优先使用本地绑定（`127.0.0.1`）。
- 详见 [`SECURITY.md`](./SECURITY.md)。

## 当前阶段说明

如果你想快速理解“这个项目现在做到哪了”，建议先看：

- [`docs/internal/CLAWeb-STAGE-SUMMARY.md`](./docs/internal/CLAWeb-STAGE-SUMMARY.md)

这份文档概括了：
- 已验证的能力
- 当前边界
- repo 与测试站的关系
- 下一阶段建议顺序

## License

Apache-2.0

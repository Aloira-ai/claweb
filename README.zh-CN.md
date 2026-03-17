# claweb

[English](./README.md) | [简体中文](./README.zh-CN.md)

![Release](https://img.shields.io/github/v/release/Aloira-ai/claweb?label=release)
![License](https://img.shields.io/github/license/Aloira-ai/claweb)
![Runtime](https://img.shields.io/badge/runtime-OpenClaw%20channel-7c3aed)
![Client](https://img.shields.io/badge/client-browser%20reference-2563eb)

**CLAWeb 是一个面向客户端接入的 OpenClaw channel，附带浏览器参考客户端和参考 access host。**

它的核心思路是：**把路由、会话流、reply 流、记忆策略继续留在 OpenClaw 内部**，而对外提供一个可被 Web、App、PC 客户端等形态共同消费的客户端接入表面。

如果你是第一次了解这个项目，可以先这样理解：

- **OpenClaw** 负责路由、prompt、记忆和 agent 行为
- **CLAWeb** 负责定义面向客户端的接入契约
- **`access/frontdoor/`** 是 `/login`、`/history`、`/ws` 的参考宿主
- **`clients/browser/`** 是第一个参考客户端，不是产品边界的全部

## 为什么会有 CLAWeb

CLAWeb 解决的是这层空档：
- 一边是 OpenClaw 内部 runtime / agent / skill 世界
- 一边是客户端真正需要的登录、历史、实时消息、reply 展示、媒体承接

也就是说：
- **OpenClaw** 负责路由、prompt、记忆、agent 行为
- **CLAWeb** 负责面向客户端的 channel contract 与参考实现

## 这个仓库现在包含什么

- **Channel runtime**：`src/`
- **Reference access layer**：`access/frontdoor/`
- **Browser reference client**：`clients/browser/`
- **Example configs / sample data**：`examples/`
- **Architecture / contract / integration docs**：`docs/`

## 当前已验证范围（`v0.2.0`）

当前仓库已经验证并收口了这些能力：

- `hello -> ready -> message` WebSocket 基本流程
- 浏览器侧实时消息 + 历史回放的归一化与去重
- 稳定的历史排序回放（`ts`, `_idx`）
- reply 关联与紧凑 reply preview 回填
- 浏览器客户端中的富文本安全子集
- 页面刷新 / 切后台后的 session 持久化与自动重连
- 图片上传链路中的“默认原图优先，仅超大图压缩兜底”
- 对 OpenClaw 标准媒体交接（`MEDIA:` / `mediaUrl`）的兼容承接

## 截图预览

### 聊天主界面

![CLAWeb 聊天主界面](./docs/assets/screenshots/chat-interface.jpg)

### 登录 / 入口页

![CLAWeb 登录入口页](./docs/assets/screenshots/login-entry.jpg)

## 明确不在范围内的东西

这个仓库 **当前不负责**：

- 人格 / prompt 逻辑
- 记忆注入策略
- Telegram 或其他私有适配层
- 完整生产级认证 / 运维加固
- 原始 HTML / 可执行富内容
- 让 CLAWeb 自己承担视频生成或业务编排

## 仓库地图

### 1）Channel runtime
- `index.ts`
- `src/`

这是 OpenClaw 内部真正的 CLAWeb channel 层。

### 2）Reference access layer
- `access/frontdoor/`

这里是 `/login`、`/history`、`/ws` 的参考 access host。  
它不是 channel runtime 本体。

### 3）Reference clients
- `clients/browser/`

这里是第一个浏览器参考客户端。  
它不应被视为 CLAWeb 的全部边界。

### 4）Examples
- `examples/openclaw.config.example.jsonc`
- `examples/claweb-login.example.json`

这里只放示例配置与示例数据。

## 快速开始

如果你是第一次接触 CLAWeb，建议先看这两份文档：

- **一步一步搭建指南**：[`docs/setup-guide.zh-CN.md`](./docs/setup-guide.zh-CN.md)
- **常见问题排查**：[`docs/troubleshooting.zh-CN.md`](./docs/troubleshooting.zh-CN.md)

本地最短路径可以理解为：

1. 安装依赖并做静态检查：
   ```bash
   npm install
   npm run typecheck
   ```
2. 把当前仓库作为 OpenClaw 插件安装并启用：
   ```bash
   openclaw plugins install /path/to/claweb --link
   openclaw plugins enable claweb
   ```
3. 参考 [`examples/openclaw.config.example.jsonc`](./examples/openclaw.config.example.jsonc) 配置 `channels.claweb`。
4. 启动 [`access/frontdoor/`](./access/frontdoor/) 里的参考 access host。
5. 打开浏览器 UI，并确认这些标准接口可用：
   - `GET /`
   - `POST /login`
   - `GET /history`
   - `WS /ws`

兼容别名接口也可以存在：
- `POST /claweb/login`
- `GET /claweb/history`
- `WS /claweb/ws`

## 文档入口

- 搭建指南（一步一步）：[`docs/setup-guide.zh-CN.md`](./docs/setup-guide.zh-CN.md)
- 常见问题排查：[`docs/troubleshooting.zh-CN.md`](./docs/troubleshooting.zh-CN.md)
- 架构分层：[`docs/channel-architecture.md`](./docs/channel-architecture.md)
- Channel 协议约定：[`docs/channel-contract.md`](./docs/channel-contract.md)
- 浏览器客户端接入约定：[`docs/browser-client-integration.md`](./docs/browser-client-integration.md)
- 项目范围与边界：[`docs/project-scope.md`](./docs/project-scope.md)
- 文档总索引：[`docs/README.md`](./docs/README.md)
- 回归检查清单：[`docs/regression-checklist.md`](./docs/regression-checklist.md)
- 状态模型：[`docs/state-model.md`](./docs/state-model.md)

如果你想最快理解“项目现在做到哪了”，建议先看：
- [`docs/project-status.md`](./docs/project-status.md)

## 对外发布定位

- 这个仓库目前偏向 **公开源码项目**，当前里程碑为 `0.2.x`
- 适合打 GitHub Release / tag
- 当前仍不做 npm 发布
- `package.json` 中保留 `"private": true`，用于避免误发 npm

## 安全说明

- 不要提交真实口令、token、用户映射文件
- Git 中只保留示例占位值
- 在没有明确做完网络加固前，优先使用本地绑定（`127.0.0.1`）
- 详见 [`SECURITY.md`](./SECURITY.md)

## License

Apache-2.0

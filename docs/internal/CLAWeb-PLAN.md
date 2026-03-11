# CLAWeb（claweb）— OpenClaw Web Channel 方案（archive draft）

> 目标：把“网页入口”做成 **OpenClaw 的一个真正 Channel**（像 Telegram 一样），而不是 WebChat 自己拼 prompt 调 `/v1/responses`。
>
> 核心收益：上下文/会话线程/记忆/skills/转发都由 OpenClaw 统一处理；网页仅负责 UI + 长连接。

---

## 0. 现状与问题（为什么要做 claweb）

当前某旧版 WebChat 的实现是：WebChat 服务端每条消息都 `fetch /v1/responses`，并自行注入 core/memory/history 等 prompt 片段。这会导致：

- WebChat 变成“第二个大脑”，影响人格与体验（拦截器/规则/提示语劫持对话）。
- HTTP 无状态导致必须自己拼上下文；模式与 Telegram（天然 thread）不一致。

**claweb 的目标**：把 Web 入口变成 OpenClaw 的 channel plugin，使 Web 跟 Telegram 一样进入 OpenClaw 的消息管道。

---

## 1. 项目定位

- 项目名：`claweb`
- 类型：OpenClaw 插件（Plugin） + 一个 Channel（`id: "claweb"`）
- 传输：优先 **WebSocket**（v0 仅 WS）
- 开源倾向：通用、可发布到 GitHub
- 现有 WebChat：保持不动（claweb 作为新项目，完成后再考虑实装/迁移）

---

## 2. 关键架构（必须像 Telegram 一样）

### 2.1 核心原则

1) **OpenClaw owns the session**：会话线程（sessionKey）由 OpenClaw 管。
2) **Web is a channel**：Web 消息进入 OpenClaw channel pipeline（routing → ctx → session record → dispatch reply → deliver）。
3) **No prompt stuffing in web layer**：网页层不注入人格/记忆/规则（这些属于 agent/profile）。

### 2.2 参考样板（已验证可借鉴）

- 官方：`api.registerChannel({ plugin })` 支持自定义 channel（OpenClaw docs：`docs/tools/plugin.md`）。
- 内置示例：`openclaw/extensions/telegram/*`（channel plugin + gateway.startAccount）。
- 第三方样板：`soimy/openclaw-channel-dingtalk`（完整 inbound → `rt.channel.*` 管线，包含 dedup + session lock）。

---

## 3. claweb MVP 范围（分阶段）

### MVP-0（文本闭环，最小可用）

- WS server 接收 `{type:"message", text}`
- 为该连接/用户生成稳定 sessionKey
- 构造 inbound ctx → `dispatchReplyWithBufferedBlockDispatcher`
- deliver：把 assistant 的文本回推给该 WS client

> 不做：媒体、前端 UI、持久化映射、复杂权限

### MVP-1（媒体）

- 客户端上传图片/音频（multipart 或 WS binary）
- 使用 `rt.channel.media.saveMediaBuffer` 保存为 inbound media
- ctx 中填 `MediaPath/MediaType`（让 tools 能取到）

### MVP-2（生产级）

- dedup（消息去重窗口）
- inflight lock（同 sessionKey 串行 dispatch，避免并发导致空回复）
- reconnect 恢复（clientId 重新绑定 sessionKey）
- rate limit、origin allowlist

---

## 4. Channel 的关键实现细节（必须实现）

### 4.1 sessionKey 设计（像 Telegram 的 thread）

建议规则：

- Direct chat：`claweb:<accountId>:user:<userId>`
- Room chat：`claweb:<accountId>:room:<roomId>`

其中：
- `accountId`：OpenClaw channel account（支持 multi-account）
- `userId`：网页端的逻辑用户标识（例如 `web-user-1`）
- `roomId`：可选（聊天室/多端共享）

**要求：同一 user/room 必须稳定映射到同一 sessionKey**，这样 OpenClaw 的 session/memory 才会连续。

### 4.2 OpenClaw 管线调用（照 dingtalk 的做法）

在 claweb inbound handler 中，流程如下：

1) route：
- `rt.channel.routing.resolveAgentRoute({ cfg, channel: "claweb", accountId, peer: {kind:"direct"|"group", id} })`
  - 产出：`agentId`、`sessionKey`（以及可能的 mainSessionKey）

2) ctx：
- 使用 `rt.channel.reply.finalizeInboundContext({...})` 构造标准 ctx（字段至少包含）：
  - `Body`, `RawBody`, `CommandBody`
  - `From`, `To`, `SenderId`, `SenderName`
  - `SessionKey`, `AccountId`, `ChatType`
  - `Provider`, `Surface`, `Timestamp`, `MessageSid`
  - 若有媒体：`MediaPath`, `MediaType`

3) session 记录：
- `rt.channel.session.recordInboundSession({ storePath, sessionKey, ctx, ... })`

4) dispatch：
- `rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({ ctx, cfg, dispatcherOptions: { deliver } })`

5) deliver（关键）：
- deliver 收到 OpenClaw 输出 payload（可能是 text/blocks/media）
- 转成 WS outbound 发回 client

**并发要求**：同一 `sessionKey` 的 dispatch 必须串行（参考 dingtalk 的 `acquireSessionLock(route.sessionKey)`）。

---

## 5. WebSocket 协议（建议 v0）

### 5.1 Client → Server

- `hello`
```json
{ "type": "hello", "token": "...", "clientId": "uuid", "userId": "web-user-1", "roomId": "default" }
```

- `message`
```json
{ "type": "message", "id": "uuid", "text": "...", "timestamp": 0 }
```

- `typing`（可选）
```json
{ "type": "typing", "state": "on" }
```

### 5.2 Server → Client

- `ready`
```json
{ "type": "ready", "serverVersion": "0.1.0" }
```

- `message`
```json
{ "type": "message", "id": "uuid", "text": "...", "role": "assistant" }
```

- `error`
```json
{ "type": "error", "id": "uuid", "message": "..." }
```

协议原则：
- 不出现人格/规则字段；这些由 agent/profile 决定。
- 连接级 token 用于认证；不要把 OpenClaw gateway token 暴露给浏览器。

---

## 6. 安全模型（开源必写）

- 认证：WS `hello.token` 必须校验（建议 `channels.claweb.accounts.<id>.authToken`）。
- origin allowlist（可选）：仅允许指定域名。
- rate limit：每连接、每 user。
- 绝不允许客户端传本地路径让服务端读取（避免路径泄露/任意文件读取）。
- 媒体若支持 URL 下载：必须做 SSRF 防护（allowlist host、禁止内网段、限制 size）。

---

## 7. OpenClaw 插件打包/加载建议

- 代码：TypeScript
- 插件 manifest：`openclaw.plugin.json`（必须有严格 schema）
- 发布：npm（可选）或 GitHub 源码

OpenClaw 内置扩展示例：通常为 `index.ts + openclaw.plugin.json + src/channel.ts`。

---

## 8. 配置草案（channels.claweb）

```json5
{
  "channels": {
    "claweb": {
      "accounts": {
        "default": {
          "enabled": true,
          "listenHost": "127.0.0.1",
          "listenPort": 18999,
          "authTokenFile": "/path/to/your/claweb.token",
          "defaultAgentId": "assistant-default",
          "dmPolicy": "allowlist",
          "allowFrom": ["web-user-1"]
        }
      }
    }
  }
}
```

> `defaultAgentId` / allowlist 只是 MVP 配置；后续可扩展 routes。

---

## 9. 目录结构建议（repo skeleton）

```
claweb/
  openclaw.plugin.json
  package.json
  tsconfig.json
  index.ts
  src/
    channel.ts
    runtime.ts
    server/
      ws-server.ts
      auth.ts
      protocol.ts
      session-map.ts
    inbound/
      build-ctx.ts
    outbound/
      deliver.ts
  docs/
    ARCHITECTURE.md
    CONFIG.md
    PROTOCOL.md
    SECURITY.md
```

---

## 10. 开发验证清单（交接给后续 AI/工程师）

### 文本闭环
- [ ] gateway 启动且能 dispatch（用现成 OpenClaw gateway）
- [ ] WS 连接成功（token 校验通过）
- [ ] client 发一句话 → OpenClaw 回复 → client 收到
- [ ] 同一 userId 再发一句话：上下文连续（证明 sessionKey 稳定且 session 记录工作）

### 并发/锁
- [ ] 同一 sessionKey 快速连发 3 条：不会出现空回复/乱序（session lock 生效）

### 安全
- [ ] token 缺失/错误：拒绝连接
- [ ] origin 不在 allowlist：拒绝连接（若启用）

---

## 11. 关键“不要做”的事（防重蹈覆辙）

- 不要在 Web 层注入人格/规则/长期记忆（core/memory/history prompt stuffing）。
- 不要在 Web 层做拦截器“代替 agent 决策”。
- 不要把 OpenClaw gateway token 下发到浏览器。

---

## 12. 后续扩展（可选）

- 多用户：userId 映射到 allowlist（channels.claweb.allowFrom）
- 多 agent：routes（按 userId/roomId 指定 agentId）
- 前端 UI：React/Vue 仅做示例，不强绑定
- SSE/HTTP fallback：移动端网络差时补充

---

## 13. 交接说明（给接手 AI）

接手 AI 优先阅读：
1) OpenClaw docs：`openclaw/docs/tools/plugin.md`（Register a messaging channel）
2) 内置参考：`openclaw/extensions/telegram/src/channel.ts`
3) 样板仓库：`soimy/openclaw-channel-dingtalk`（重点看 inbound-handler.ts 的 `rt.channel.*` 调用顺序）

实现策略：先 MVP-0 文本闭环，再逐步加安全/并发/媒体。

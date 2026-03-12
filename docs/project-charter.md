# CLAWeb Project Charter (v1)

> **定位一句话**：CLAWeb 是一个 **类似 Telegram 的原生聊天入口（Web Native Client）**。
> - **对话/上下文/记忆**：交给 OpenClaw（以及其背后的模型与记忆体系）
> - **UI/连接/交互**：由 CLAWeb 负责

## 1. Goals（目标）

### P0（必须做到）
1) **作为稳定入口可长期使用**
- 刷新可恢复（recent snapshot / raw history 回放）
- 断线可重连（WS）
- detached reply：断线期间 assistant 仍能落盘，回来看得到

2) **契约清晰且可复刻**
- Host 只要实现 3 个 canonical 端点即可接入：`POST /login`、`GET /history`、`WS /ws`
- 兼容端点可选：`/claweb/login`、`/claweb/history`、`/claweb/ws`
- 协议语义可扩展且不自相矛盾：`turnId` / `messageId` / `replyTo`

3) **可维护（改动可回归、可回滚）**
- 有回归清单/脚本
- 有迁移脚本（历史命名/结构升级）
- 线上 test 站作为验证面：`claweb.example.com`

### P1（应该做到）
- 多会话（thread list）与快速切换
- 搜索（messages + pinned memory）
- 更丰富的消息类型：引用、卡片、工具结果、状态条

### P2（之后再做）
- 更完整的权限/账号体系
- 多端强一致（非首要）

## 2. Non-goals（明确不做，防止失控）
- 不做完整 IM 平台（群成员/好友系统/复杂权限）
- 不把“模型记忆策略”塞进前端（前端不做大脑）
- 不绑定私有系统（webchat/love/nuomi 等只能作为部署样板，不进入契约）

## 3. Responsibility Split（分工边界）

### CLAWeb（Client / UI）负责
- 连接状态与重连策略（展示 Online/Offline/Auth failed 等）
- 消息渲染与交互（pending、引用 replyTo、错误提示、滚动定位）
- 发送 turn（生成 turnId/messageId）

### Host / OpenClaw（Backend）负责
- 会话固定（userId/roomId/clientId 的稳定映射）
- 上下文组装（给模型喂哪些历史/记忆）
- 记忆体系读写（长期一致性、提炼、检索）
- 历史落盘与一致性（ts + _idx 排序；messageId 去重）

## 4. Acceptance Criteria（验收标准）

### Realtime
- `hello -> ready` 成功率稳定
- 发 3 条消息：pending 正确清理，assistant 回答可见

### Recovery
- 刷新后：history 回放无重复、无乱序
- WS 断线后：可重连继续发送
- detached reply：断线时发起的 turn，在重连/刷新后能看到 assistant 回复

### Contract
- `turnId/messageId/replyTo` 语义在文档中明确，frontdoor 参考实现遵守

## 5. Reference Verification Surface（验证面）
- 线上：`https://claweb.example.com/`
- 参考 host：`examples/frontdoor/`

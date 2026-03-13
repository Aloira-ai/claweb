# CLAWeb Execution Plan（基于当前现状的施工计划）

本计划以 **“原生聊天入口（类似 Telegram）”** 为目标，强调：
- 前端 CLAWeb 做 UI/连接/交互
- 上下文与记忆交给 OpenClaw/模型

> 原则：先把 P0 稳定性与回归体系收口，再做 P1 功能。

---

## 0) 当前现状（已完成）

- GitHub 仓库：`Aloira-ai/claweb`
- test 站：`claweb.example.com`（root `/` 即页面）
- host：已切到 `access/frontdoor` 参考实现
- canonical contract：`/login` `/history` `/ws`（兼容 `/claweb/*`）
- history：raw JSONL + recent snapshot（60 条、TTL 7d）
- 迁移：legacy history → keyed history 脚本已入仓库
- 协议：frontdoor 已做 `turnId/messageId` 分离，并携带 `replyTo`

---

## 1) Phase 1（P0 收口）：回归体系 + 可观测性（建议 1~2 天）

### 1.1 回归清单升级（文档）
- 产物：`docs/regression-checklist.md` 补强
- 补充项：
  - turnId/messageId/replyTo 行为验证
  - snapshot 命中/回退 raw 的验证步骤
  - detached reply 的最小复现步骤

验收：任何 PR 合并前跑一遍 checklist，能在 10 分钟内完成。

### 1.2 Smoke 脚本（可选但强烈推荐）
- 产物：
  - `access/frontdoor/scripts/smoke-http.js`
  - `access/frontdoor/scripts/smoke-ws.js`
- 覆盖：
  - `/login` 成功
  - `/history` 返回按 `ts,_idx` 排序
  - `/ws` hello->ready
  - 发 turn，收到 assistant message 且带 replyTo

验收：线上/本机都能一键跑通。

### 1.3 可观测性（frontdoor 侧）
- 产物：`access/frontdoor/server.js` 追加最小日志/计数（不引入重依赖）
  - snapshot hit/miss
  - upstream close/error
  - per-session key 打印（userId/roomId/clientId）

验收：出现“历史空/断线”时，日志能指向原因类别。

---

## 2) Phase 2（P1 功能）：像 Telegram 一样好用（建议 3~7 天）

优先级建议：
1) **会话列表 / thread 切换**（基础 UX）
2) **replyTo 引用渲染**（提升对话可读性）
3) **搜索**（messages + pinned memory）
4) **状态栏**（模型/工具/连接状态更清楚）

注意：这些功能不得侵入“记忆策略”，只做 UI + 协议字段展示。

---

## 3) Phase 3（P2 运维与安全）：长期跑得住（之后再做）

- upstream token 改为 `*_TOKEN_FILE`
- nginx websocket 模板固化
- systemd unit 模板化（Restart、WorkingDirectory、EnvironmentFile）
- 证书策略（自签→更正式）

---

## 4) 施工方式（每一项都要有）

- 变更说明（What/Why）
- 回滚点（备份文件名/旧版本）
- 验收步骤（按 checklist 或 smoke 脚本）
- 线上验证（claweb.example.com）

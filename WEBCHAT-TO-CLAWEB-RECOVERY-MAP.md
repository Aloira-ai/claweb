# CLAWeb 回收清单：从 `<private-first-party-webchat>` 到 `workspace/claweb`

## 目的
在不把 first-party 验证壳子原样搬进公共仓库的前提下，梳理：
- 哪些能力应该回收到 `claweb`
- 哪些文件只能作为 demo/example 参考
- 哪些内容绝不能进入公共仓库

当前判断依据：
- `workspace/claweb` 已有 **WebSocket channel plugin 主体**
- `<private-first-party-webchat>/public/claweb/*` 已有 **真实验证过的浏览器端入口**
- `<private-first-party-webchat>/server.js` 里同时混有：
  - 通用的 CLAWeb 入口逻辑
  - first-party webchat prototype 专用逻辑
  - 过渡期并行兼容代码

因此不能整文件搬运，只能按能力回收。

---

## 一、建议回收到 `claweb` 的内容（通用能力）

### A. 浏览器端静态前端（高优先）
来源：
- `/root/.openclaw/<private-first-party-webchat>/public/claweb/index.html`
- `/root/.openclaw/<private-first-party-webchat>/public/claweb/style.css`
- `/root/.openclaw/<private-first-party-webchat>/public/claweb/app.js`

建议去向：
- `workspace/claweb/public/claweb/index.html`
- `workspace/claweb/public/claweb/style.css`
- `workspace/claweb/public/claweb/app.js`

可回收原因：
- 这是当前已真实跑通的通用 Web 入口
- 不依赖 first-party persona 才能工作
- 已具备 Phase 1 修复后的关键一致性逻辑：
  - 消息归一
  - 去重
  - 用户回显识别
  - 历史恢复显示
  - 登录后自动进入固定会话

回收时要做的轻量清理：
- 文案从“当前验证现场”整理成“公共入口文案”
- 保留 `/claweb/` 路径约定，但不要硬编码私有部署语境
- 确认无真实 passphrase / token / identity 示例残留

---

### B. 历史恢复与稳定排序的通用规则（高优先）
来源：
- `/root/.openclaw/<private-first-party-webchat>/server.js` 中 `loadClawebHistory`
- `/root/.openclaw/<private-first-party-webchat>/public/claweb/app.js` 中历史恢复与去重配合逻辑

建议去向：
- `workspace/claweb` 的服务端实现层（可能新增 HTTP/静态服务模块）
- 或者 `examples/embedded-server/` 一类参考实现

应回收的不是“整段 webchat server”，而是这几条通用规则：
- 历史持久化落服务端，不只靠浏览器 localStorage
- 历史读取返回前按 `ts` 升序、`_idx` 稳定排序
- 历史恢复与实时帧渲染共享同一去重规则
- `frame.type=message` 不应默认全部按 assistant 渲染

---

### C. 登录映射思路（中优先，回收为 example，不回收真实方案）
来源：
- `/root/.openclaw/<private-first-party-webchat>/server.js` 中：
  - `loadClawebLoginConfig`
  - `findSessionByPassphrase`
  - `authenticateClawebSession`
  - `resolveClawebClientId`

建议去向：
- `workspace/claweb/examples/` 或 `docs/`
- 作为“fixed identity mapping” 示例方案

可公开的应是：
- 通过本地文件把 passphrase 映射到固定 `identity/userId/roomId/clientId/token`
- 历史固定落到同一会话轨道

不能公开的部分：
- 真实 `claweb-login.local.json`
- 真实 identity 命名
- 真实 token/passphrase

结论：
- **回收“机制说明 + example schema”**
- **不回收“本地真实映射文件”**

---

### D. “退出后 reply 续跑 / 回复补写历史”的行为边界（高优先）
来源：
- `/root/.openclaw/<private-first-party-webchat>/server.js` 中 CLAWeb proxy/detached/pending turn 相关逻辑

建议去向：
- `workspace/claweb` 主实现（如果 claweb 要成为真正通用入口）
- 若当前主插件尚无对应 HTTP/桥接层，则至少写进 `docs/architecture.md` 或 `docs/mvp-roadmap.md`

应回收的核心不是 first-party 专用实现细节，而是公共能力定义：
- 用户发完消息立刻退出，assistant 回复仍继续生成
- 回复完成后补写回服务端历史
- 用户重进后能看到完整历史

这已经是现网验证过的高价值能力，属于 claweb 的产品资产，不应长期只存在于 webchat 壳子里。

---

## 二、建议只作为 demo / example 保留的内容

### A. `<private-first-party-webchat>/public/claweb` 作为 first-party demo
可保留，但应重新定位为：
- first-party example
- 演示站实现
- 兼容旧 webchat 服务下的嵌入式 demo

不应继续被当成：
- 公共主实现唯一真身

---

### B. Passphrase 登录页交互
当前登录体验可继续沿用，但更适合在公共仓库中写成：
- demo login flow
- example mapping flow

因为不同部署方未来可能改成：
- token 输入
- invite code
- 自定义 session picker

所以应保留其“可替换前端示例”定位。

---

## 三、不建议直接回收到 `claweb` 主项目的内容

### A. `webchat/server.js` 整体文件
原因：
- 里面混有大量与 first-party webchat prototype 绑定的逻辑：
  - `/api/auth`
  - 旧 `/` 页面
  - Telegram adapter
  - media/image/video
  - system prompt / persona
  - 上传与媒体存储
  - socket.io 旧链路
- 若整文件搬到公共 claweb，会严重污染边界

结论：
- **不要整文件迁移**
- 只拆出 CLAWeb 通用层所需能力

### B. Persona / prompt / first-party 私有设定
例如：
- `SYSTEM_PROMPT`
- demo-user-b / demo-passphrase / CLAWeb关系设定
- 任何陪伴关系特化文字

这些都不属于通用 Web 入口层。

### C. Media / upload / video 逻辑
当前 claweb 定位仍是：
- text-first MVP
- no media
- no uploads

因此这部分不应被误带进公共 claweb 主线。

---

## 四、建议在 `claweb` 新增的目录层

建议新增：
- `public/claweb/`：浏览器前端静态资源
- `examples/`：配置示例、登录映射示例、反代示例
- `docs/`：架构、边界、MVP 说明、release notes

如果短期还不想把 HTTP/静态服务真正并入主插件，也至少应：
- 先把前端放进 `claweb` 仓库
- 再把“如何挂到现有服务里”写成 example / docs

---

## 五、建议的回收优先级

### P0（先做）
1. 回收浏览器前端三件套
   - `index.html`
   - `style.css`
   - `app.js`
2. 把 Phase 1 关键修复写进 claweb 文档/变更说明
3. 补 example 级登录映射说明

### P1（随后做）
4. 抽离服务端历史恢复/排序规则到 claweb 可复用层
5. 抽离 detached reply / 补写历史 的公共行为定义
6. 重写 README / SECURITY / examples

### P2（可后做）
7. 决定 first-party demo 是否继续留在 webchat 目录
8. 决定 npm/package 发布与 `private` 策略

---

## 六、当前一句话判断
不是把 `<private-first-party-webchat>` 搬进 GitHub，
而是：

> **把其中已经验证过的通用 CLAWeb 能力，按“公共实现 / example / 私有壳”三层拆开，再回收到 `workspace/claweb`。**

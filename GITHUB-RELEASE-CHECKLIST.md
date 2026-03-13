# CLAWeb GitHub 发布前整理清单

## 目标
把当前已在 **first-party 私有验证壳子** 中验证有效的 CLAWeb 能力，整理回 `workspace/claweb`，形成一个**可公开理解、可公开安装、可公开示例化**的通用项目，再更新到 GitHub。

当前原则：
- `claweb` 是通用 Web 入口 / Web Channel 插件
- `first-party` 只是 first-party example，不是产品定义
- 不能把本地验证现场、真实身份映射、真实密钥方案直接推上 GitHub

---

## 一、必须先做（发布前硬门槛）

### 1. 通用代码回收进 `/root/.openclaw/workspace/claweb`
把已经在 `<private-first-party-webchat>` 验证有效、且具备通用价值的内容回收到 claweb 主项目：
- Web 前端入口的通用实现
- WebSocket 接入与会话收发逻辑
- 历史恢复闭环
- “退出后 reply 续跑 / 回复补写历史”所依赖的通用行为边界
- Phase 1 已验证有效的最小补丁：
  - 消息归一
  - 去重
  - 用户回显识别
  - 历史稳定排序

**目标**：公共仓库的主实现应在 `workspace/claweb`，而不是长期寄生在 `<private-first-party-webchat>`。

### 2. 本地敏感信息彻底隔离
必须确认以下内容不进入 GitHub：
- `data/claweb-login.local.json`
- 真实 passphrase
- 真实 token
- 真实 userId / roomId / clientId 映射
- 任何现网专用 URL / 本地部署细节 / 私有身份信息

保留到公开仓库的只能是：
- `data/claweb-login.example.json`
- 示例字段说明
- 安装与配置方式

### 3. README 按“公开项目”重写
README 要从“本地验证说明”升级成“公开可用项目说明”，至少包含：
- 这是什么
- 适用场景
- MVP 边界（text-first / no media / no uploads / no complex auth）
- 安装方式
- 配置方式
- 示例路由 / 示例登录映射
- 已知限制
- 安全提醒

### 4. 清理或重写发布边界文档
需要逐项确认：
- `CLAWeb-PLAN.md`：保留、移动到 docs，还是内部化
- `docs/internal/`：公开仓库是否保留，若保留需弱化内部语气
- `SECURITY.md`：按公开项目口径重写，避免过多暴露私有部署语境

### 5. 明确 `package.json` 发布立场
确认：
- 是否继续保留 `"private": true`
- 是先作为 GitHub 开源项目发布，还是连 npm / package 发布也一起规划

如果暂时只上 GitHub，不发包，保留 `private` 也可以；但要写清楚项目状态。

---

## 二、建议紧接着做（强建议）

### 6. first-party demo 与公共实现分层
建议明确结构：
- `claweb/`：公共实现
- `examples/`：公开示例配置/示例页面
- `demo/` 或 first-party example：first-party 风格样板（若保留）

避免长期出现：
- 通用入口一份
- first-party demo 壳子里又挂一份
- 名字相近但边界不清

### 7. 给出最小配置样例
至少准备：
- 插件加载方式
- Web 路由示例
- 登录映射示例
- 历史落盘示例
- 反代示例（如 `/claweb/` 与 `/claweb/ws`）

### 8. 补一份公开仓库的“已验证能力”清单
把这次真实验证过的内容写清楚：
- 固定身份映射
- 历史恢复
- 回复续跑
- 刷新重进可恢复
- Phase 1 的消息一致性修复

### 9. 写清当前不做什么
明确告诉外部用户：
- no media
- no uploads
- no reconnect engineering
- no complex auth
- no memory prompt stuffing

这样外部预期不会跑偏。

---

## 三、可延后（不是现在的阻塞项）

### 10. 更完整的状态层设计
可后续继续推进：
- raw history
- recent state
- session state

但不应阻塞这次 GitHub 整理。

### 11. 更正式的 token / identity 方案
当前本地验证可继续沿用，但公开版后续可以再升级为更正式的方案。

### 12. 更完整的公网回归矩阵
当前至少已有：
- 本机最小验证
- 真实浏览器链路首轮回归

更复杂场景（多条连续消息 / 长消息 / 更多异常恢复）可后补。

---

## 四、绝不能原样带上 GitHub 的东西

### 敏感/私有内容
- 本地真实登录映射
- 真实暗号
- 真实 token
- 本地服务地址与运维细节
- first-party 私有关系设定
- 用户专属身份命名（如 `demo-user-a` / `demo-user-b` 若带真实语境）

### 过渡态结构
- 把 `<private-first-party-webchat>` 当作公共主项目本体
- 让公共实现长期依赖 first-party 现场代码结构

---

## 五、建议的实际执行顺序

### 第 1 步：列出要回收的文件/能力
从 `<private-first-party-webchat>` 中梳理：
- 哪些是通用代码
- 哪些是 first-party 专用壳子
- 哪些只是临时验证代码

### 第 2 步：回收进 `workspace/claweb`
把通用实现挪回 claweb 主项目，并确保目录结构清晰。

### 第 3 步：重写公开文档
优先处理：
- `README.md`
- 示例配置
- `SECURITY.md`
- 发布边界说明

### 第 4 步：做一次 release 前检查
核对：
- 敏感文件未被带入
- `private` 立场明确
- 示例可运行
- 文案不再以 first-party demo 为产品中心

### 第 5 步：更新 GitHub
等公共形态整理完成后，再提交/推送。

---

## 六、当前判断
当前状态适合：
- **进入 GitHub 发布前整理阶段**

当前状态不适合：
- **把 `<private-first-party-webchat>` 里的验证现场原样直接推上 GitHub**

一句话：
> 先“整理成公共项目”，再“更新 GitHub”。

# CLAWeb 搭建指南（中文）

这份指南按 **“稍微小白也能跟着做”** 的标准来写。  
目标不是讲架构术语，而是让你最后真的把 CLAWeb 跑起来。

完成后，你会得到这样一套本地可用环境：

- OpenClaw 在 `127.0.0.1:18999` 提供上游 CLAWeb channel
- `access/frontdoor` 在 `http://127.0.0.1:18081` 提供浏览器入口
- 你可以在浏览器里打开页面、登录、查看历史、实时聊天

如果你更想先看原理，再看：
- [`./channel-architecture.md`](./channel-architecture.md)

如果你只是想先搭起来，直接按本文一步一步走就行。

---

## 一、先用一句话理解 CLAWeb 是什么

你可以把仓库理解成三层：

### 1）Channel runtime（`src/`、`index.ts`）
这是 **真正挂在 OpenClaw 里的 CLAWeb 插件**。

### 2）Reference access host（`access/frontdoor/`）
这是一个小型 Node 服务，负责：
- 提供登录接口
- 提供历史消息接口
- 提供 WebSocket 实时接口
- 顺便把浏览器 UI 也一起托管出来

### 3）Browser reference client（`clients/browser/`）
这是你在浏览器里打开看到的聊天页面。

最简单的脑补方式：

> OpenClaw 是大脑  
> CLAWeb 是 Web 入口协议层  
> `access/frontdoor` 是浏览器和 OpenClaw 之间的小桥

---

## 二、开始前你需要准备什么

### 必需品
- 已安装 **OpenClaw**
- 已安装 **Node.js**
- 有 **npm** 命令
- 你能修改 OpenClaw 的配置文件

### 建议版本
- Node 20+（Node 22 更稳）
- 本仓库当前依赖的 `openclaw` 版本是 `^2026.3.7`

### 先做这个检查

```bash
node -v
npm -v
openclaw --version
```

如果这里就报错，先不要继续。先把环境补齐。

---

## 三、搭建总流程先看一眼

你真正要做的事情，其实就是这 7 步：

1. 安装仓库依赖
2. 把 `claweb` 安装成 OpenClaw 插件
3. 创建一个共享 token 文件
4. 在 OpenClaw 配置里加上 `channels.claweb`
5. 重启 OpenClaw，让上游 channel 跑起来
6. 配置并启动 `access/frontdoor`
7. 用浏览器打开页面并登录测试

下面开始逐步展开。

---

## 四、正式开始搭建

## 第 1 步：安装仓库依赖

先进入仓库根目录：

```bash
cd /path/to/claweb
npm install
npm run typecheck
```

### 这一步在做什么？
- `npm install`：安装插件本身需要的依赖
- `npm run typecheck`：检查 TypeScript 代码有没有明显问题

### 看到什么算成功？
- `npm install` 正常结束
- `npm run typecheck` 不报错退出

如果 `typecheck` 失败，先别往下走。

---

## 第 2 步：把 CLAWeb 安装成 OpenClaw 插件

OpenClaw 的插件建议用 CLI 管理。

本地仓库最方便的方式是：

```bash
openclaw plugins install /path/to/claweb --link
openclaw plugins enable claweb
```

### 为什么推荐 `--link`？
因为它会直接链接你的本地仓库，而不是复制一份。  
这样你后续改文档、改代码，就还是改这一份。

### 做完后检查一下

```bash
openclaw plugins list
openclaw plugins info claweb
openclaw plugins doctor
```

### 成功标志
- `plugins list` 里能看到 `claweb`
- 状态是启用的
- `plugins doctor` 没有报 manifest/schema 相关错误

---

## 第 3 步：创建共享 token 文件

OpenClaw 上游 CLAWeb channel 和前面的 frontdoor，需要用 **同一个 token** 才能互相通信。

可以这样创建：

```bash
mkdir -p ~/.config/claweb
openssl rand -hex 32 > ~/.config/claweb/claweb.token
chmod 600 ~/.config/claweb/claweb.token
```

### 这一步为什么重要？
因为后面：
- OpenClaw 会用它保护上游 CLAWeb socket
- `access/frontdoor` 会用它去连 OpenClaw

如果两边 token 不一致，页面可能能打开，但聊天会死在 WebSocket 那一步。

### 成功标志

```bash
cat ~/.config/claweb/claweb.token
```

能看到一长串随机字符串就行。  
**不要把这个文件提交进 Git。**

---

## 第 4 步：在 OpenClaw 配置中加入 `channels.claweb`

参考：
- [`../examples/openclaw.config.example.jsonc`](../examples/openclaw.config.example.jsonc)

你需要在 OpenClaw 配置中加入类似这样一段：

```jsonc
{
  "channels": {
    "claweb": {
      "accounts": {
        "default": {
          "enabled": true,
          "listenHost": "127.0.0.1",
          "listenPort": 18999,
          "authTokenFile": "/home/YOUR_USER/.config/claweb/claweb.token"
        }
      }
    }
  }
}
```

把路径改成你自己机器上的真实绝对路径。

### 字段说明
- `enabled`：启用这个 channel
- `listenHost`：监听地址
- `listenPort`：监听端口
- `authTokenFile`：token 文件路径

### 新手最重要提醒
先不要把它暴露到公网。  
**第一次搭建请坚持使用 `127.0.0.1`。**

这样最安全，也最容易排查问题。

---

## 第 5 步：重启 OpenClaw

保存配置后，用你平时的方式重启 OpenClaw / gateway。

可以顺手检查：

```bash
openclaw gateway status
openclaw plugins list
```

### 成功标志
- OpenClaw 能正常启动
- 没有配置错误
- `claweb` 插件仍然是启用状态
- 上游预期监听在 `127.0.0.1:18999`

如果这里起不来，优先排查配置语法问题。

---

## 第 6 步：配置 frontdoor 的登录文件

frontdoor 需要一个登录映射文件，示例在这里：
- [`../access/frontdoor/config/claweb-login.example.json`](../access/frontdoor/config/claweb-login.example.json)

你可以复制出一个本地版本：

```bash
cd /path/to/claweb
cp ./access/frontdoor/config/claweb-login.example.json ./access/frontdoor/config/claweb-login.local.json
```

然后编辑它，比如改成：

```json
{
  "guest-a": {
    "displayName": "Guest A",
    "passphrases": ["change-me-now"],
    "userId": "user-guest-a",
    "roomId": "room-main",
    "clientId": "guest-a"
  }
}
```

### 字段怎么理解？
- `displayName`：登录后页面里显示的名字
- `passphrases`：登录口令
- `userId`：这位用户的稳定身份 id
- `roomId`：房间 id
- `clientId`：客户端 id

### 新手建议
第一次先只配 **一个身份**，别一上来配好几个。  
房间也先统一用 `room-main`，最省事。

---

## 第 7 步：启动 frontdoor

打开第二个终端：

```bash
cd /path/to/claweb/access/frontdoor
npm install
```

然后用这组环境变量启动：

```bash
BIND=127.0.0.1 \
PORT=18081 \
CLAWEB_STATIC_ROOT=../../clients/browser \
CLAWEB_LOGIN_CONFIG=./config/claweb-login.local.json \
CLAWEB_HISTORY_DIR=./data/history \
CLAWEB_UPSTREAM_WS=ws://127.0.0.1:18999 \
CLAWEB_UPSTREAM_TOKEN_FILE=$HOME/.config/claweb/claweb.token \
node server.js
```

### 这一步做了什么？
它会：
- 托管浏览器页面
- 提供 `/login`
- 提供 `/history`
- 提供 `/ws`
- 通过 token 连接上游 OpenClaw 的 CLAWeb channel

### 成功标志
- 进程启动后没有立刻退出
- 没有报缺少 token 的警告
- 没有明显启动报错

如果你看到这种提示：

> `missing CLAWEB_UPSTREAM_TOKEN (or *_TOKEN_FILE)`

说明 token 没配对，先不要继续浏览器测试。

---

## 第 8 步：打开浏览器页面

浏览器打开：

```text
http://127.0.0.1:18081
```

### 成功标志
- 页面能打开
- 不是 404
- 不是空白页

如果这里就打不开，问题通常还在 frontdoor/static root 这一层。

---

## 第 9 步：登录测试

输入你在 `claweb-login.local.json` 里配置的 passphrase。

### 成功标志
登录成功后，页面应该能拿到一组 session 信息，比如：
- `displayName`
- `token`
- `userId`
- `roomId`
- `clientId`
- `wsUrl`

接下来浏览器会去连接 `/ws`。

---

## 第 10 步：发送第一条消息

可以先发一条最简单的：

```text
hello
```

### 成功标志
正常情况下会出现这样的流程：
1. 浏览器连上 WebSocket
2. 发出 `hello`
3. 收到 `ready`
4. 你的用户消息出现
5. assistant 回复出现

如果登录能成功，但一直收不到回复，最常见的原因是：
- 上游 token 不一致
- OpenClaw 的 CLAWeb channel 没真正监听在 `127.0.0.1:18999`
- frontdoor 连不上上游 WS
- `claweb` 插件没有启用

---

## 五、仓库里最常用的几个文件

### 仓库根目录
- `index.ts`：插件入口
- `src/`：CLAWeb channel runtime
- `examples/openclaw.config.example.jsonc`：OpenClaw 配置示例

### frontdoor
- `access/frontdoor/server.js`：参考 access host
- `access/frontdoor/config/claweb-login.example.json`：登录映射示例
- `access/frontdoor/data/history/`：历史消息存储
- `access/frontdoor/scripts/smoke-http.js`：HTTP 冒烟测试
- `access/frontdoor/scripts/smoke-ws.js`：WS 冒烟测试

### 浏览器端
- `clients/browser/`：浏览器参考客户端静态资源

---

## 六、自检清单

你可以按这个 checklist 对照：

- [ ] 根目录 `npm install` 成功
- [ ] 根目录 `npm run typecheck` 成功
- [ ] `openclaw plugins install /path/to/claweb --link` 成功
- [ ] `openclaw plugins enable claweb` 成功
- [ ] token 文件已创建
- [ ] OpenClaw 配置已加上 `channels.claweb`
- [ ] OpenClaw 已正常重启
- [ ] `claweb-login.local.json` 已创建
- [ ] frontdoor 已用正确环境变量启动
- [ ] 浏览器能打开 `http://127.0.0.1:18081`
- [ ] 能成功登录
- [ ] 能收到 assistant 回复

---

## 七、下一步该看什么

如果你已经本地跑通了，下一步一般就是：
- 上反向代理
- 配域名
- 开 HTTPS / WSS
- 做更正式的认证与运维加固

如果你卡住了，继续看：
- [`./troubleshooting.zh-CN.md`](./troubleshooting.zh-CN.md)

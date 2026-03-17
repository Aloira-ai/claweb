# CLAWeb 常见问题排查（中文）

如果你遇到的是这种情况：

> 页面能打开，但某一步死活不对

那就按这份排查表从上往下查。  
大多数问题其实都集中在这几类：

- 插件没装好 / 没启用
- OpenClaw 配置没生效
- token 不一致
- frontdoor 没启动好
- 登录映射文件不对
- `/login`、`/history`、`/ws` 三条链路没接完整

---

## 1）先做最基础检查

```bash
node -v
npm -v
openclaw --version
openclaw plugins list
openclaw plugins info claweb
openclaw plugins doctor
openclaw gateway status
```

你要确认的是：
- Node / npm 可用
- OpenClaw 可用
- `claweb` 插件存在
- `claweb` 插件已启用
- gateway 状态正常
- `plugins doctor` 没报 manifest/schema 错误

如果这层都不对，先别查浏览器。

---

## 2）问题：`claweb` 插件根本没出现在 OpenClaw 里

### 一般说明什么？
插件还没真正被 OpenClaw 安装进去。

### 直接这样修

```bash
openclaw plugins install /path/to/claweb --link
openclaw plugins enable claweb
```

然后再看：

```bash
openclaw plugins list
openclaw plugins info claweb
```

如果还是不行，再跑：

```bash
openclaw plugins doctor
```

---

## 3）问题：一加 `channels.claweb`，OpenClaw 就起不来了

### 最常见原因
是配置文件写错了，不一定是 CLAWeb 本身坏了。

### 常见错误
- 少逗号
- 层级放错
- `authTokenFile` 路径写错
- 改错了配置文件

### 对照这个例子重查
- [`../examples/openclaw.config.example.jsonc`](../examples/openclaw.config.example.jsonc)

重点看：
- `enabled`
- `listenHost`
- `listenPort`
- `authTokenFile`

### 小建议
如果你一口气改了很多地方，先撤回，只保留最小 `channels.claweb` 配置块，再试一次。

---

## 4）问题：frontdoor 启动时提示缺少 token

你可能会看到：

> `missing CLAWEB_UPSTREAM_TOKEN (or *_TOKEN_FILE)`

### 这说明什么？
frontdoor 没拿到用于连接上游 OpenClaw 的 token。

### 解决办法
确认下面至少有一个设置正确：
- `CLAWEB_UPSTREAM_TOKEN`
- `CLAWEB_UPSTREAM_TOKEN_FILE`

推荐用文件方式：

```bash
CLAWEB_UPSTREAM_TOKEN_FILE=$HOME/.config/claweb/claweb.token node server.js
```

再确认文件真的存在：

```bash
ls -l $HOME/.config/claweb/claweb.token
cat $HOME/.config/claweb/claweb.token
```

---

## 5）问题：浏览器页面根本打不开

### 表现
- `http://127.0.0.1:18081` 打不开
- 浏览器提示 refused
- 404
- 空白页

### 先查这几件事

#### A. frontdoor 进程是不是还活着？
如果 `node server.js` 启动后立刻退出，那先看报错。

#### B. `BIND` / `PORT` 对不对？
本地建议值：

```bash
BIND=127.0.0.1
PORT=18081
```

#### C. `CLAWEB_STATIC_ROOT` 对不对？
通常是：

```bash
CLAWEB_STATIC_ROOT=../../clients/browser
```

这个路径错了，服务虽然可能启动，但页面资源会托管失败。

---

## 6）问题：登录失败

### 常见表现
- `invalid_credentials`
- `missing_passphrase`
- `login_not_configured`

### 优先检查
#### A. 你加载的是不是正确的登录文件？
例如：

```bash
CLAWEB_LOGIN_CONFIG=./config/claweb-login.local.json
```

#### B. JSON 结构是不是对的？
例如：

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

#### C. passphrase 是不是输错了？
第一次测试建议别搞太复杂，先用一个容易输入的临时口令。

---

## 7）问题：登录成功了，但就是聊不起来

### 表现
- 页面进去了
- 登录也成功了
- 但没实时回复
- WebSocket 断开
- 发消息后没 assistant 回答

### 最常见原因
#### A. OpenClaw 上游 CLAWeb channel 没真的起来
检查：

```bash
openclaw plugins list
openclaw plugins info claweb
openclaw gateway status
```

#### B. frontdoor 指向的上游 WS 地址错了
本地应该是：

```bash
CLAWEB_UPSTREAM_WS=ws://127.0.0.1:18999
```

#### C. token 不一致
这是最常见的坑之一。

一定要确认：
- OpenClaw 配置里的 `authTokenFile` 指向的是 token A
- frontdoor 的 `CLAWEB_UPSTREAM_TOKEN_FILE` 也指向同一个 token A

不是两个不同文件。

---

## 8）问题：历史消息总是空的

### 可能原因
- 本来就还没产生历史
- `userId` / `roomId` / `clientId` 前后不一致
- `CLAWEB_HISTORY_DIR` 配错了
- 历史还没落盘

### 先查
```bash
ls -R ./data/history
```

再确认：
- 你每次登录是不是同一个身份
- `roomId` 有没有变
- `clientId` 有没有乱改

---

## 9）问题：`/login` 通了，但 `/history` 或 `/ws` 不通

### 一般说明什么？
你的三条链路没有接完整。

浏览器客户端期望的标准接口是：
- `POST /login`
- `GET /history`
- `WS /ws`

兼容别名也可以有：
- `POST /claweb/login`
- `GET /claweb/history`
- `WS /claweb/ws`

如果你自己做了一层宿主/代理，建议先退回 reference frontdoor 验证，别一上来就多层转发。

---

## 10）问题：消息重复、顺序怪怪的

这通常说明 history/realtime 那层没有按约定处理。

### 关键规则
历史排序应该按：
1. `ts` 升序
2. `_idx` 升序

去重优先按：
- `messageId`
- 不够时才退回 `(role, ts, text)`

可以继续看：
- [`./browser-client-integration.md`](./browser-client-integration.md)
- [`./channel-contract.md`](./channel-contract.md)
- [`./state-model.md`](./state-model.md)

---

## 11）别瞎猜，直接跑自带 smoke test

### HTTP 冒烟测试

```bash
cd /path/to/claweb/access/frontdoor
node scripts/smoke-http.js \
  --base http://127.0.0.1:18081 \
  --passphrase YOUR_PASSPHRASE \
  --userId user-guest-a \
  --roomId room-main \
  --clientId guest-a
```

### WS 冒烟测试

```bash
cd /path/to/claweb/access/frontdoor
node scripts/smoke-ws.js \
  --base http://127.0.0.1:18081 \
  --passphrase YOUR_PASSPHRASE \
  --clientId guest-a \
  --message "ping"
```

它们能帮你快速判断问题到底是在：
- 登录
- 历史
- WebSocket
- reply 关联
- 路由接线

比只盯着浏览器页面猜快很多。

---

## 12）卡死时的最稳回退法

如果你已经越改越乱了，建议退回这套最小形态：

- 单机本地
- `listenHost=127.0.0.1`
- `listenPort=18999`
- `BIND=127.0.0.1`
- `PORT=18081`
- 只配一个 identity
- OpenClaw 和 frontdoor 共用同一个 token 文件
- 不上反代
- 不上 HTTPS
- 不加自定义路径前缀

先把这个最小闭环跑通，再一层层往上加复杂度。  
这通常比你同时排五个变量快得多。

# 参与开发

先谢谢你愿意花时间。这份文档只讲「怎么在这个仓库里干活」，不讲插件本身怎么用 —— 那是 [README](README.md) 的事。

---

## 目录

- [三分钟跑起来](#三分钟跑起来)
- [代码长什么样](#代码长什么样)
- [改分类规则](#改分类规则)
- [加一个 HTTP 路由](#加一个-http-路由)
- [改界面](#改界面)
- [测试怎么写的](#测试怎么写的)
- [提交 PR 之前](#提交-pr-之前)
- [几个容易踩的坑](#几个容易踩的坑)

---

## 三分钟跑起来

不需要 `npm install`。这个仓库**没有任何运行时依赖**，测试也只用了 Node 内置模块。

```bash
git clone https://github.com/KERBALMans/dsh-plugin-studio.git
cd dsh-plugin-studio

node scripts/all.mjs --offline
```

跑完你会看到 10 个套件的汇总。`--offline` 表示不连真实客户端，用仓库里 `fixtures/` 的数据渲染页面 —— CI 就是这么跑的。

想对着**自己的真实客户端**跑：

```bash
# 先确认客户端在跑，端口在「设置 → 关于」或启动日志里
node scripts/all.mjs --offline=false

# 或者指定端口
node scripts/render.mjs --port=50329
```

`DSH_WEB_PORT` 环境变量也行。端口每次重启客户端都会变，所以脚本不会写死。

### 把它装进自己的客户端

改完代码想立刻看效果，两个办法：

**办法一：软链进 profile（推荐）**

```bash
# Windows
mklink /D "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-plugin-studio" "你的仓库路径"
```

然后在客户端里禁用再启用一次这个插件。

**办法二：让客户端直接读仓库**

```bash
dsh plugin add file:/绝对路径/dsh-plugin-studio
```

改完代码后不用重启客户端，在「设置 → 插件」里把 `dsh-plugin-studio` 关掉再打开就行 —— Host 会重新加载模块。

---

## 代码长什么样

两半，跑在两个进程里，**不要互相 import**：

```
index.js          Host 半：HTTP 路由、读文件、调服务
lib/              Host 半的实现，按职责分文件
  env.js            路径、服务探测、错误文本
  caps.js           能力探测（按方法存在性，不看版本号）
  inventory.js      插件清单（优先 pluginManager，回落读文件）
  classify.js       三级分类的核心，改动最频繁
  usage.js          最后使用时间（读会话日志）
  skills.js         技能清单
  remote.js         GitHub 检索
  ai.js             调模型做讲解
  remove.js         删除（插件与技能共用）
client.js         Client 半：整个界面，一个文件
locale/           zh.json / en.json
cordis.patch.yml  插件怎么挂进 Loader
```

打包和整合包存储直接写在 `index.js` 的路由里（`/pack`、`/save`、`/saved`、`/delete-pack`），没有单独成文件 —— 它们只是把已有对象序列化后写盘，抽出来反而多一层跳转。

`client.js` 是**一个文件**，不拆分。理由：Client 半没有构建步骤，拆成多个文件要么用 `require` 相对路径（Loader 对 Client 模块的解析规则和 Host 不同），要么在打包时拼接 —— 两者都比一个 1000 行的文件更容易出问题。它内部按 `/* ---- 区块 ---- */` 分节，找东西用搜索。

### 两半之间只通过 HTTP 说话

Host 注册路由，Client `fetch` 相对路径：

```
GET  /api/dsh-plugin-studio/inventory     插件清单 + 三级树
GET  /api/dsh-plugin-studio/skills        技能清单
GET  /api/dsh-plugin-studio/diag          诊断信息
POST /api/dsh-plugin-studio/explain       AI 讲解
POST /api/dsh-plugin-studio/remove        删除插件
POST /api/dsh-plugin-studio/skills/remove 删除技能
POST /api/dsh-plugin-studio/pack          打包
POST /api/dsh-plugin-studio/save          保存整合包
```

完整清单在 README 的「HTTP 接口」一节。**加路由要同时改三处**：`index.js` 的路由表、`client.js` 的 `request()` 调用、`scripts/routes.mjs` 的断言。

---

## 改分类规则

这是最容易改出问题的地方，因为它不是「对/错」而是「更合理/更不合理」。

规则在 `lib/classify.js`，三个层次：

```js
FAMILIES      一级分类，8 个，固定（ui / tools / model / session / net / ops / core / other）
DOMAINS       二级分类，每个 family 下若干条，带 order 和 match()
PURPOSE_RULES 从描述和代码里认「这插件是干什么的」，给二级分类提供证据
```

`other` 是兜底，正常情况下**不应该有任何行落进去**。测试会断言这一点：

```js
check('没有落进 other 的行', view.rows.every((row) => row.family !== 'other'))
```

改规则时的流程：

```bash
# 1. 看某个插件的打分过程，别猜
node scripts/scores.mjs dsh-session-clean

# 2. 改 lib/classify.js

# 3. 再跑一次，确认它落到了你想要的地方
node scripts/scores.mjs dsh-session-clean

# 4. 跑全部，确认没把别的插件改坏
node scripts/all.mjs --offline
```

`scores.mjs` 会打印每个候选分类的得分和命中理由，像这样：

```
dsh-session-clean
  -> session/session.clean  high
  why: 说明里写明它清理会话 | 代码里引用了 sessionQuery
```

**加规则前先想清楚它会不会误伤。** 一条 `/pack|backup|export/` 看起来无害，实际上把「插件市场」也匹配成了「打包与备份」。规则写窄一点，用 `\b` 和更具体的词。

---

## 加一个 HTTP 路由

`index.js` 里 `makeHandler(ctx)` 返回一个 `(req, res)` 函数，路由表在它内部：

```js
const routes = {
  '/': () => rootPayload(),
  '/inventory': () => analyse(ctx, { kind: 'plugin' }),
  // 新增：
  '/foo': (body) => doFoo(ctx, body),
}
```

三条约定：

1. **永远返回 `{ ok: true, ... }` 或 `{ ok: false, error: '...' }`**，不要抛到外面 —— 未捕获的异常会让客户端看到 `HTTP 500` 而不是一句人话。
2. **写操作要有 `dryRun`**。`removeMany()` 的实现是「dryRun 时走完全一样的代码路径，只是最后不落盘」，这样 dryRun 通过就等于真跑也能通过。
3. **不要信任 body**。`body` 已经过 `JSON.parse` 和大小限制，但字段类型还是得自己查。

---

## 改界面

`client.js` 里没有 JSX，用的是 `React.createElement` 的短别名 `h`。原因：Client 半没有构建步骤，JSX 需要转译。

```js
h('div', { className: 'dps-row' }, h('span', null, row.title))
```

### 样式只能用 token

```css
/* 对 */
color: var(--dsw-alias-label-primary);

/* 错 —— style.mjs 会拦下来 */
color: #1a1a1c;
color: rgb(26, 26, 28);
```

可用的 token 是客户端声明的那些，`--dsw-alias-*` 和 `--dsw-specific-*` 两族。写之前先看 `client.js` 顶部已有的用法，或者查客户端的 `Theme.listTokens`。

硬编码颜色的后果不是「不好看」，是**深色主题下看不见**。

### 不要碰别人的 DOM

`document.body`、`document.querySelector`、`innerHTML` 全部被 `scripts/style.mjs` 拦。这个插件只在自己的面板里渲染，伸手到外面会跟客户端抢 DOM。

需要弹窗就渲染一个覆盖层（看 `confirming` 那段），需要复制就调 `navigator.clipboard`，失败了显示一个只读文本框让用户自己选。

### 改完看一眼

```bash
node scripts/render.mjs --offline   # 生成 build/preview.html
node scripts/measure.mjs            # 真实浏览器量布局
node scripts/shoot.mjs              # 截图到 build/
```

`measure.mjs` 会报：面板有没有宽度、行有没有渲染出来、有没有横向溢出、三级缩进是不是逐级递增、颜色 token 有没有解析出来。**它比截图有用**，因为截图你得自己看，它是数字。

---

## 测试怎么写的

10 个套件，每个都是独立可跑的 `.mjs`：

| 套件 | 管什么 |
| --- | --- |
| `smoke` | 底层函数一个个测 |
| `analyse` | `analyse()` 整条管线 |
| `scores` | 打印每个插件的打分（诊断用，不断言） |
| `routes` | 每个 HTTP 路由的返回形状 |
| `actions` | 删除、打包这些写操作 |
| `ai` | AI 讲解的解析（不真调模型） |
| `style` | client.js 的样式与模块契约 |
| `compat` | 5 个版本的 Service 契约 |
| `render` | 用 React 替身渲染出 HTML |
| `measure` | 真实浏览器量布局 |

跑全部：`node scripts/all.mjs --offline`

### 三条规矩

**一、测试不能依赖「本机装了什么」。**

这条踩过两次。第一次断言「至少有若干行能算出最后使用时间」，删掉一个插件之后就挂了 —— 环境变了，逻辑没变。改成用合成数据测规则本身：

```js
const synthetic = { tools: { demo_tool: NOW - 60_000 } }
const strong = lastUsedFor({ name: 'demo-plugin', toolNames: ['demo_tool'] }, synthetic)
check('工具调用命中算真实使用', strong.time === NOW - 60_000 && strong.strong === true)
```

**二、破坏性测试要自己清理。**

`actions.mjs` 会往 `categories.json` 写手动分类，跑完必须删掉，否则污染真实界面：

```js
// 末尾
await call(handler, '/api/dsh-plugin-studio/categories/reset', { all: true })
check('分类表已清空', Object.keys(readCategories().assignments).length === 0)
```

**三、断言要写清楚失败时看到什么。**

```js
check('每一行都有三级分类', view.rows.every((row) => row.family && row.domain), `${view.rows.filter((r) => !r.family).length} 行缺失`)
```

第三个参数是失败时打印的细节。没有它，你只知道「挂了」，不知道挂在哪。

### fixtures

`fixtures/` 下是提交进仓库的固定数据：

- `inventory.json` / `skills.json` / `root.json` —— 一次真实运行的快照，路径已脱敏
- `profile/` —— 一个合成 profile，7 个插件覆盖全部一级分类

`render` / `measure` 在 `--offline` 下读这些，所以 CI 不需要真实客户端。

重新生成：

```bash
node scripts/_make-profile-fixture.mjs    # 重建 fixtures/profile/
```

---

## 提交 PR 之前

```bash
node scripts/all.mjs --offline
```

必须全绿。然后：

- [ ] `package.json` 的 `dependencies` 还是空的
- [ ] 没有新增硬编码颜色
- [ ] 破坏性操作有 dryRun 或确认框
- [ ] 改界面的话，贴了截图
- [ ] 改分类规则的话，在 PR 里写了「哪些插件从哪挪到了哪，为什么」

commit message 用 `type: 说明` 的形式，跟已有历史保持一致：

```
feat: 三级分类支持手动覆盖
fix: 技能删除后列表不刷新
docs: 补 UPLOAD-GUIDE 的 Release 步骤
```

---

## 几个容易踩的坑

**`/tmp` 在 Node 里不是 `/tmp`。** 工作目录在 E 盘时，`/tmp/x` 会被解析成 `E:\tmp\x`。脚本里要写绝对路径。

**`new URL(...).pathname` 是百分号编码的。** 路径含空格（`MY Base Text`）时直接当参数用会报错，要 `fileURLToPath()`。

**React 不在磁盘上。** 它被打包进客户端 shell 的 bundle 里，`node_modules` 里找不到。所以 `render.mjs` 自己实现了一个最小替身，只覆盖 `client.js` 用到的 5 个 hook。

**`git credential fill` 会挂住。** 装了 GCM 的机器上它弹 GUI 等你点，脚本里就永远等下去。用 token 直接推，或者设 `GIT_TERMINAL_PROMPT=0`。

**客户端端口每次重启都变。** 不要把端口写进脚本。

---

## 许可

提交的代码按 [MIT](LICENSE) 授权。

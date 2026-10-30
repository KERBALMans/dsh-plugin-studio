# 手动上传到 GitHub 网页版 · 小白超详细教程

本教程假设你**从来没上传过代码**，也没装过 Git。全程只用浏览器点鼠标，不需要命令行。

预计耗时：**10 分钟**。

---

## 目录

- [第 0 步：准备什么](#第-0-步准备什么)
- [第 1 步：注册 GitHub 账号](#第-1-步注册-github-账号)
- [第 2 步：新建一个仓库](#第-2-步新建一个仓库)
- [第 3 步：上传文件（网页拖拽）](#第-3-步上传文件网页拖拽)
- [第 4 步：确认文件都在](#第-4-步确认文件都在)
- [第 5 步：写仓库简介](#第-5-步写仓库简介)
- [第 6 步：发布一个 Release（可选但推荐）](#第-6-步发布一个-release可选但推荐)
- [第 7 步：拿到安装地址](#第-7-步拿到安装地址)
- [常见问题](#常见问题)

---

## 第 0 步：准备什么

你需要三样东西：

**1. 一个浏览器**
Edge、Chrome、Firefox 都行。本机已有 Edge。

**2. 一个邮箱**
用来注册 GitHub。QQ 邮箱、163、Gmail 都行。

**3. 插件文件夹**

> **注意：文件夹在 `E:\MY Base Text\DeepSeek Harness\dsh-plugin-studio\`**
>
> 这个路径里有空格，复制的时候注意别丢了空格。

上传前先确认文件夹里**有这 19 个文件**（其他文件不用管）：

```
dsh-plugin-studio/
├── index.js
├── client.js
├── cordis.patch.yml
├── package.json
├── icon.svg
├── README.md
├── CHANGELOG.md
├── LICENSE
├── locale/
│   ├── zh.json
│   └── en.json
└── lib/
    ├── env.js
    ├── caps.js
    ├── inventory.js
    ├── classify.js
    ├── usage.js
    ├── skills.js
    ├── ai.js
    ├── remote.js
    └── remove.js
```

**不要上传的文件夹**（GitHub 网页版也不支持一次传整个文件夹树，这些也用不上）：

- `scripts/` —— 测试脚本，用户装了不需要
- `build/` —— 预览用的 HTML 和截图
- `dist/` —— 打包产物

---

## 第 1 步：注册 GitHub 账号

**已经有账号就跳到第 2 步。**

1. 浏览器打开 **https://github.com/signup**

2. 页面中间有个输入框，写着 `Enter your email`。填入你的邮箱，点绿色按钮 **Continue**。

3. 输入密码（至少 8 位，要有数字和字母），点 **Continue**。

4. 输入用户名。**这个用户名会出现在你的安装地址里**，比如填 `zhangsan`，将来地址就是 `github.com/zhangsan/dsh-plugin-studio`。只能用英文字母、数字、连字符。

5. 页面上会出现一道验证题，让你按顺序点图形（比如"点击图中所有的猫"）。点完点 **Continue**。

6. 会往你邮箱发一封 8 位验证码。去邮箱找 **GitHub** 发来的邮件，把验证码填进去。

   > 收不到？看看垃圾邮件箱。还是没有就点页面上的 **Resend code** 重发。

7. 注册完成后会问你几个问题（团队规模、用途），**随便选或者直接拉到页面底部点 Skip**，不影响使用。

8. 最后会进入 `https://github.com/` 首页。看到右上角有你的头像，说明注册成功。

---

## 第 2 步：新建一个仓库

> **仓库（Repository）就是 GitHub 上的一个项目文件夹。**

1. 在 GitHub 任意页面，**点右上角的 `+` 号**（在你头像左边）。

2. 在弹出的菜单里点 **New repository**。

3. 进入新建页面，填三处：

   **① Repository name** —— 填 `dsh-plugin-studio`
   > 必须一字不差。这个名字要和 `package.json` 里的 `name` 字段一致，否则安装会出问题。

   **② Description** —— 填这句（也可以自己写）：
   ```
   插件工坊：DeepSeek Harness 插件与技能管理器，三级自动分类、批量删除、AI 讲解、最后使用时间
   ```

   **③ 选 `Public`** —— 公开仓库，别人才能装。
   > 选 Private 的话，只有你自己能看到，别人装不了。

4. **下面的三个勾选项都不要勾**：
   - `Add a README file` —— 不勾，我们有自己的 README
   - `Add .gitignore` —— 不勾
   - `Choose a license` —— 不勾，我们有自己的 LICENSE 文件

   > 勾了会生成一个空的 README，之后上传会冲突。

5. 点页面底部的绿色按钮 **Create repository**。

6. 创建成功后会看到一个**空仓库页面**，中间有一大段命令行提示（`git init`、`git remote add` 那些）——**不用管它们**，我们要用的是网页上传。

---

## 第 3 步：上传文件（网页拖拽）

这是最关键的一步，需要分 **3 次** 上传，因为网页版一次只能传同一层级的文件。

### 3.1 打开上传页面

在空仓库页面上，找到这行小字：

> **uploading an existing file**

点它。（如果找不到，直接在地址栏输入：`https://github.com/你的用户名/dsh-plugin-studio/upload/main`）

### 3.2 第一次上传：根目录的 8 个文件

页面上有一个虚线框，写着 **Drag files here to add them to your repository**。

1. 打开 Windows 文件资源管理器，进到 `E:\MY Base Text\DeepSeek Harness\dsh-plugin-studio\`

2. **按住 `Ctrl` 键**，依次点击这 8 个文件（点错了再点一次就取消）：
   - `index.js`
   - `client.js`
   - `cordis.patch.yml`
   - `package.json`
   - `icon.svg`
   - `README.md`
   - `CHANGELOG.md`
   - `LICENSE`

   > **不要用 `Ctrl+A` 全选**——那会把 `lib`、`locale`、`scripts`、`build`、`dist` 这些文件夹也选上。网页版对文件夹的处理不可靠，容易传一半失败。

3. 把这 8 个文件**拖到浏览器的虚线框里**（或者点虚线框里的 **choose your files** 去选）。

4. 拖进去后，虚线框下面会出现文件列表，显示每个文件名。确认是 8 个。

5. 页面往下拉，有个输入框写着 **Commit changes**，里面默认是 `Add files via upload`。

   **改成**：`初始提交：插件工坊 1.0.0`

6. 点绿色的 **Commit changes** 按钮。

7. 等 3 秒，页面会自动跳回仓库首页，你能看到刚才上传的 8 个文件。

### 3.3 上传 locale 文件夹（2 个文件）

网页版没法直接把文件"传进某个文件夹"，但有两条可靠路径。**推荐用方法 A**。

#### 方法 A：Create new file 建路径（最稳，推荐）

GitHub 有个特性：**在文件名里输入 `/`，它会自动创建文件夹**。

1. 仓库首页 → **Add file** 下拉按钮 → **Create new file**
2. 在文件名输入框（写着 `Name your file...`）里输入：
   ```
   locale/zh.json
   ```
   > 输入 `/` 的一瞬间，输入框左边会出现 `locale /` 的路径提示，说明文件夹建好了。这是正常的。
3. 在下面的大编辑框里，粘贴 `zh.json` 的内容（见本文末尾附录）
4. 拉到底部，Commit 输入框填 `添加中文语言包`，点 **Commit new file**
5. 重复第 1–4 步，这次文件名填 `locale/en.json`，粘贴 `en.json` 内容，Commit 消息填 `添加英文语言包`

#### 方法 B：先传到根目录，再改路径

1. 仓库首页 → **Add file** → **Upload files**
2. 点 **choose your files**，进到 `dsh-plugin-studio\locale\`，选中 `zh.json` 和 `en.json`，点 **打开**
3. Commit 消息填 `添加语言包`，点 **Commit changes**
   > 此时两个文件躺在**根目录**，路径不对，下一步修正。
4. 点进 `zh.json`，点右上角的**铅笔图标** ✏️
5. 在顶部的文件名输入框里，把 `zh.json` 改成 `locale/zh.json`
6. 点 **Commit changes**
7. 对 `en.json` 重复第 4–6 步

两种方法结果一样。方法 A 一次到位不会错，方法 B 少粘贴两次但要多改两步路径。

### 3.4 上传 lib 文件夹（9 个文件）

`lib` 里的文件加起来约 120KB，其中 `classify.js` 有 39KB。**用方法 B（先传后改路径）更省事**，因为要传 9 个文件，逐个用 Create new file 粘贴会很慢。

1. 仓库首页 → **Add file** → **Upload files**
2. 点 **choose your files**，进到 `dsh-plugin-studio\lib\`
3. **按住 `Ctrl` 键**多选这 9 个文件：
   ```
   env.js
   caps.js
   inventory.js
   classify.js
   usage.js
   skills.js
   ai.js
   remote.js
   remove.js
   ```
4. 点 **打开**，等它们出现在虚线框下面
5. Commit 消息填 `添加核心模块`，点 **Commit changes**
   > 9 个文件会全部躺在根目录。
6. **逐个改路径**：点进每个 `.js` 文件 → 铅笔图标 ✏️ → 把文件名 `env.js` 改成 `lib/env.js` → Commit

   > 9 次重复操作有点烦，但每次只要 3 秒。改完一个，列表里的文件名会从 `env.js` 变成 `lib/env.js` 的显示形式（GitHub 会显示为文件夹层级）。

**如果你更想用 Create new file 一次到位**：对上面 9 个文件逐个执行「Add file → Create new file → 文件名填 `lib/env.js` → 粘贴内容 → Commit」。`classify.js` 39KB 粘贴进网页编辑器没问题，只是要等 2 秒。

---

## 第 4 步：确认文件都在

传完后，回到仓库首页（点左上角的仓库名 `dsh-plugin-studio`）。

你应该看到这样的结构：

```
lib/                    ← 文件夹，右边显示 9 个文件
locale/                 ← 文件夹，右边显示 2 个文件
CHANGELOG.md
LICENSE
README.md
client.js
cordis.patch.yml
icon.svg
index.js
package.json
```

**逐个点进去检查**：

1. 点 `lib` 文件夹 → 应该有 9 个 `.js` 文件
2. 点 `locale` 文件夹 → 应该有 `zh.json` 和 `en.json`
3. 点 `package.json` → 页面显示 JSON 内容，**确认第 2 行是 `"version": "1.0.0"`**，第 2 行的上一行是 `"name": "dsh-plugin-studio"`

**如果少文件了**：点 **Add file → Upload files** 补传，或者用 Create new file 重传那个文件（同名会覆盖）。

---

## 第 5 步：写仓库简介

回到仓库首页，看右侧栏，有个齿轮图标 ⚙️ 在 **About** 旁边。

1. 点那个齿轮
2. **Description** 填：
   ```
   插件工坊：DeepSeek Harness 插件与技能管理器。三级自动分类、批量删除、AI 大白话讲解、最后使用时间、一键打包。
   ```
3. **Topics** 依次输入并回车，加这几个标签：
   ```
   dsh  deepseek-harness  plugin-manager  skills  cordis
   ```
4. 点 **Save changes**

> 简介和标签能让别人搜到你的仓库，也让页面看起来完整。

---

## 第 6 步：发布一个 Release（可选但推荐）

> **Release 是什么？** 是给仓库打一个"版本快照"，附带可下载的安装包。有了 Release，别人可以用 `github:用户名/dsh-plugin-studio#v1.0.0` 精确安装这个版本。

1. 在仓库首页，看右侧栏，点 **Releases** 旁边的 **Create a new release**。

   > 找不到？直接在地址栏输入：`https://github.com/你的用户名/dsh-plugin-studio/releases/new`

2. **Choose a tag** 输入框里填：`v1.0.0`

3. 点它下面弹出的 **Create new tag: v1.0.0 on publish**

4. **Release title** 填：`v1.0.0 · 插件工坊首个正式版`

5. **Describe this release** 大框里，粘贴这段：

   ```markdown
   ## 插件工坊 1.0.0

   DeepSeek Harness 的插件与技能管理器，`dsh-modpack` 的下一代。

   ### 六个功能

   - **三级自动分类** —— 8 个一级分类、17 个二级分类，每行都带判定依据，不会出现"无法判断"
   - **批量删除** —— 复选框多选，删除后按需提示重启，并说明为什么要重启
   - **AI 大白话讲解** —— 结合代码、描述、GitHub 检索，说清"帮你做什么"和"删了会怎样"
   - **最后使用时间** —— 区分"真的用过"和"只是被提到"
   - **技能管理页** —— 与插件页功能对等：分类、删除、打包、启停
   - **重新设计的界面** —— 只用主题 token，深浅色自动跟随

   ### 安装

   ```
   plugin_manager action: install_bundle
                   target: github:你的用户名/dsh-plugin-studio
   ```

   ### 兼容性

   `engines.dsh >= 0.2.0-rc.1`。已针对 `0.2.1-rc.1` / `rc.2` / `rc.3` 及两种未来契约做过验证（见 `scripts/compat.mjs`）。
   ```

6. **Attach binaries** 区域，点 **Attach binaries by dropping them here or selecting them**

   选中这个文件：
   ```
   E:\MY Base Text\DeepSeek Harness\dsh-plugin-studio\dist\dsh-plugin-studio-1.0.0.tgz
   ```

   > 这个文件约 74KB，上传很快。

7. 确认 **This is a pre-release** **不要勾**（1.0.0 是正式版）

8. 点绿色按钮 **Publish release**

9. 等几秒，会跳转到 Release 页面。你能看到标题、说明，以及底部的 **Assets** 里有个 `dsh-plugin-studio-1.0.0.tgz` 可以下载。

---

## 第 7 步：拿到安装地址

现在你的仓库地址是：

```
https://github.com/你的用户名/dsh-plugin-studio
```

**在 Harness 里安装**，用这个写法：

```
github:你的用户名/dsh-plugin-studio
```

完整例子（假设用户名是 `zhangsan`）：

```
github:zhangsan/dsh-plugin-studio
```

在 Harness 里执行的完整命令：

```
plugin_manager action: install_bundle
                target: github:zhangsan/dsh-plugin-studio
```

**如果要装特定版本**（需要第 6 步做了 Release）：

```
plugin_manager action: install_bundle
                target: github:zhangsan/dsh-plugin-studio#v1.0.0
```

**如果要从 Release 里的 tgz 安装**：

先下载 `dsh-plugin-studio-1.0.0.tgz`，然后：

```
plugin_manager action: install_bundle
                target: E:\下载路径\dsh-plugin-studio-1.0.0.tgz
```

---

## 常见问题

### 上传时提示 "file is too large"

单个文件超过 25MB 会被拒绝。本插件最大的文件 `classify.js` 只有 39KB，不会遇到。如果遇到，说明你选错了文件。

### 上传后文件夹是空的

GitHub 不支持空文件夹。文件夹里有文件才会显示。如果你看到 `lib/` 是空的，说明文件传到别处去了，检查是不是传到了根目录。

### 我传错了文件，怎么删？

1. 点进那个文件
2. 点右上角的 **垃圾桶图标** 🗑️
3. 拉到页面底部点 **Commit changes**

### 我传错了文件名，怎么改？

1. 点进那个文件
2. 点右上角的 **铅笔图标** ✏️
3. 在顶部的文件名输入框里改名字（可以带 `/` 来移动位置）
4. 点 **Commit changes**

### 为什么不能一次拖整个文件夹？

GitHub 网页版不支持拖拽文件夹（会静默失败或只传里面的部分文件）。要传文件夹必须：
- 拖拽时只选文件（不选文件夹），或者
- 用 **Create new file** 输入带 `/` 的路径来建文件夹

想一次传整个项目，只能装 Git 用命令行。本教程为了"零安装"，用的是网页方案。

### 传完之后，怎么更新版本？

1. 改本地文件
2. 在 GitHub 上点进对应文件，点铅笔图标，粘贴新内容，Commit
3. 改 `package.json` 里的 `version` 字段（比如 `1.0.0` → `1.0.1`）
4. 发一个新 Release（tag 填 `v1.0.1`）

### 仓库设成 Private 了，别人装不了怎么办？

点仓库页面的 **Settings** 标签 → 拉到最底部 **Danger Zone** → **Change visibility** → 选 **Change to public** → 按提示输入仓库名确认。

### 我需要装 Git 吗？

本教程全程不需要。Git 只有在你想用命令行批量上传、或者想保留完整提交历史时才需要。

---

## 附录：两个语言包的内容

如果你用「Create new file」方式建 `locale/` 文件夹，需要粘贴下面两个文件的内容。

### `locale/zh.json`

```json
{
  "meta.title": "插件工坊",
  "meta.description": "一个页面管好插件和技能：三级自动分类、批量删除、AI 大白话讲解、最后使用时间、一键打包。",
  "section.label": "插件工坊"
}
```

### `locale/en.json`

```json
{
  "meta.title": "Plugin Studio",
  "meta.description": "One page for plugins and skills: three-level auto-classification, batch removal, plain-language AI explainers, last-used times, and one-click packing.",
  "section.label": "Plugin Studio"
}
```

---

## 附录：上传清单核对表

传完后对着这张表逐个打勾：

- [ ] `package.json` —— 打开确认 `"name": "dsh-plugin-studio"`、`"version": "1.0.0"`
- [ ] `index.js`
- [ ] `client.js`
- [ ] `cordis.patch.yml`
- [ ] `icon.svg`
- [ ] `README.md`
- [ ] `CHANGELOG.md`
- [ ] `LICENSE`
- [ ] `locale/zh.json`
- [ ] `locale/en.json`
- [ ] `lib/env.js`
- [ ] `lib/caps.js`
- [ ] `lib/inventory.js`
- [ ] `lib/classify.js`
- [ ] `lib/usage.js`
- [ ] `lib/skills.js`
- [ ] `lib/ai.js`
- [ ] `lib/remote.js`
- [ ] `lib/remove.js`

**19 个文件，一个都不能少。** 少了 `cordis.patch.yml` 装不上；少了 `lib/` 里的文件会启动即报错。

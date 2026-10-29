# 面向 DeepSeek Harness 的 CodeGraph

[English](README.md) · [中文](README.zh-CN.md)

本 bundle 把 [CodeGraph](../../README.md) 接入 DeepSeek Harness：

- **Skill** — `codegraph` 教 agent Mermaid 与源码位置约定。
- **工具** — `codegraph_build` 一次完成图的校验和构建；`codegraph_walkthrough_build` 构建讲解页；`codegraph_list` 查找两种历史产物。
- **对话卡片** — 每次构建展示主题、图类型、统计和校验错误，并提供打开图的按钮。
- **图 tab** — 生成的 `.codegraph/output/**/graph.html` 在右侧栏专用 tab 打开。点击节点、箭头、时序消息或 actor，会在 Harness 源码预览中打开对应行，优先使用第二个 pane。
- **CodeWalkthrough** — 同一个 CodeGraph Skill 还可以生成长文式、可交互的讲解页。`codegraph_walkthrough_build` 写入 `.codegraph/output/**/walkthrough.html`；页面支持上下滚动的多节长文、内联 SVG/CSS/JS、源码引用，以及可折叠的浏览器源码分栏。在 DSH 中，源码链接改为打开 Harness 代码 pane。

## 安装

需要 Node.js 18+，以及支持 plugin-manager 的 DSH。在 DSH 里让 agent 安装本地 bundle：

> 安装 `/绝对路径/CodeGraph/dsh` 的 CodeGraph 插件。

底层由 agent 调用插件管理器执行
`plugin_manager install_bundle /绝对路径/CodeGraph/dsh`。bundle 以链接方式安装，
复用 `../skill/CodeGraph`（脚本、模板和 vendored Mermaid）。请保持 CodeGraph
checkout 在原路径；移动或删除后需要重新安装。如果 Skill、工具或图 tab 没有出现，
刷新一次 DSH 页面。

插件只写入 `<workspace>/.codegraph/`，并拒绝 session workspace 之外的 `repo`。

## 使用

让 agent 画一个流程，例如：

> 用 CodeGraph 画一下登录流程的时序图。

agent 会加载 `codegraph`、阅读代码，并用 Mermaid 文本和位置表调用
`codegraph_build`。结果卡片可以打开图。review 模式使用
`review: { base, head }`。

点击节点、箭头、消息或 actor 打开的是**当前源码**的对应行。DSH 原生的
changed-files review tab 按轮次聚合，不会按图元素逐个打开；需要看 diff 时请使用
单独的 changes review。

如果要的是一篇讲解网页而不是图：

> 用 CodeGraph 为我介绍退款流程，做成一个可交互的网页。

CodeWalkthrough 会先问清读者、范围、深度，以及是否要加 3–5 道自测题；再读相关
代码和测试，然后用 `codegraph_walkthrough_build` 传入自由 HTML 片段和源码引用。
如果加了自测，会放在最后，支持选项判分或点击查看答案。工具会抽取真实源码、套上统一
外壳，并在返回前跑静态自检。只有配合证据表和 `window.__cwCheck()` 的运行时检查，
内容才真正可靠。

## 目录结构

```text
dsh/
├── index.js             Host：skill + 工具
├── client.js            Web：结果卡片 + 图/讲解页 tab
├── lib/build.js         图校验/构建/列表管线
├── lib/walkthrough.js   讲解页调用与自检包装
├── skill-adapter.md     追加到 SKILL.md 的 DSH 运行时覆盖
├── cordis.patch.yml     bundle 配置行
├── locale/{en,zh}.json  插件管理器元数据
└── icon.svg
```

图 renderer 与独立 skill 共用。它新增了 sandbox 安全的 `localStorage` 保护、持久选中
（点空白画布取消）和单行、可截断 topic 的 header。DSH 专属逻辑由 `#dsh` 控制：
`postMessage` 桥接；在文件被图 tab 框住时隐藏内嵌 Web 代码栏、editor 选择器和
工作区路径；在图右侧显示文件/函数/行卡片。普通浏览器不显示卡片和轨道，并保留
Web 代码栏。

CodeWalkthrough 有独立的外壳，位于
`../skill/CodeGraph/template/walkthrough/`。它把被引用的源码嵌入单个 HTML，
因此浏览器分栏离线可用；在 DSH 中隐藏该分栏，改发 `codewalk.navigate` 给 tab。
它的工作流契约在 `../skill/CodeGraph/references/walkthrough.md`。

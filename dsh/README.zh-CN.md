# 面向 DeepSeek Harness 的 CodeGraph

[English](README.md) · [中文](README.zh-CN.md)

本 bundle 把 [CodeGraph](../../README.md) 接入 DeepSeek Harness：

- **Skill** — `codegraph` 教 agent Mermaid 与源码位置约定。
- **工具** — `codegraph_build` 一次完成校验和构建；`codegraph_list` 查找历史产物。
- **对话卡片** — 每次构建展示主题、图类型、统计和校验错误，并提供打开图的按钮。
- **图 tab** — 生成的 `.codegraph/output/**/graph.html` 在右侧栏专用 tab 打开。点击节点、箭头、时序消息或 actor，会在 Harness 源码预览中打开对应行，优先使用第二个 pane。

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

## 目录结构

```text
dsh/
├── index.js             Host：skill + 工具
├── client.js            Web：结果卡片 + 图 tab
├── lib/build.js         校验/构建/列表管线
├── skill-adapter.md     追加到 SKILL.md 的 DSH 运行时覆盖
├── cordis.patch.yml     bundle 配置行
├── locale/{en,zh}.json  插件管理器元数据
└── icon.svg
```

renderer 与独立 skill 共用。它新增了 sandbox 安全的 `localStorage` 保护、持久选中
（点空白画布取消）和单行、可截断 topic 的 header。DSH 专属逻辑由 `#dsh` 控制：
`postMessage` 桥接；在文件被图 tab 框住时隐藏内嵌 Web 代码栏、editor 选择器和
工作区路径；在图右侧显示文件/函数/行卡片。普通浏览器不显示卡片和轨道，并保留
Web 代码栏。同一个 HTML 仍然可以在浏览器中正常打开。

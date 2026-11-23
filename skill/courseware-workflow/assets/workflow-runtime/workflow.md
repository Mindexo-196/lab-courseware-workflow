# HTML Courseware Workflow V3.6

## Agent Policy

默认由 Main Agent 完成全部工作，不自动创建任何子 Agent。

只有用户明确要求使用子 Agent 时：

- 最多创建一个；
- 只处理用户指定的单一任务；
- 结果由 Main Agent 审核、合并并继续完成其余步骤。

禁止自动创建 Generator/Reviewer 组合或多个并行审查 Agent。

## 唯一状态

每个任务只有一份：

```text
Workflow/runs/<task-id>/live.json
```

它同时保存：

- brief、已有原件引用、CST 路径与哈希；
- `deck` 内容、逐屏配置、交互和页面级 CSS；
- 当前预览、静态/浏览器检查结果；
- Reviewer 问题；
- 人工决定与自然语言反馈；
- token、费用和阶段历史。

不再生成 task、state、review、human、preview、rewrite、usage 等平行 JSON。

## 上下文记忆

`memory.json` 只负责防止对话上下文丢失：

- 当前任务要求；
- 压缩后的历史决定与人工反馈；
- 页面基本信息，不含 HTML；
- `live.json` 路径与哈希；
- token 与费用。

`memory.json` 是唯一允许传给模型的大上下文摘要。构建仍只读取 `live.json`。
每次状态更新后自动刷新，并限制历史长度与文件体积。
预算按当前模型上下文动态计算：上下文 1,048,576 tokens，有效 95%，推荐值为有效
上下文的 50%，硬上限为名义上下文的 125%。当前硬上限约 5MB，已超过名义上下文
容量。`resume` 会报告上下文 token、体积、单页平均体积和 token 估算。

恢复上下文时先运行 `resume` 校验并刷新 `memory.json`。需要修改某页时，只使用 `page` 动作读取该页，
不得把完整 `live.json` 或全部 HTML 放入上下文。

## CST 关联

运行时直接读取：

```text
CST/CONTENT.md
CST/SKILL.md
CST/TEMPLATE.html
```

`live.cst.hashes` 保存三文件哈希。每次构建重新计算；CST 改变后，旧审查和预览自动失效。

## 交互联动规则

每个交互屏至少包含两个用户可操作控件和两个 `linked_components`，并共享同一个
`linked_state`。
Builder 把组件数量和状态写入 slide 标记；浏览器检查拒绝单组件交互屏。
`chart` 是标准组合交互族，输入控件、图形、表格读数和解释必须同步。

用户明确请求三维文件关系网络时，使用 `workflow-network` 模式。文件节点与中央
状态可以保留标签，次要流程节点可用小型无序标签触点；球体使用 `MeshBasicMaterial`
平涂且场景不得添加灯光。交互必须支持拖拽旋转、滚轮缩放、键盘方向键、复位和
可暂停自动环绕；连线需要方向，并处理减少动态效果。检查旋转过程中的标签安全区与
中英文切换。

## 视觉回归约束

- 分层 3D 网络使用固定 HTML 标签带；主阅读方向可能塌缩时，用
  `data-network-orbit-range` 限制自动环绕角度，避免四层在侧视时叠成一根纵列。
- 3D 状态提示与 canvas 无障碍名称必须随中英文同时刷新。
- 表格交互只保留一层 `.ix-table-wrap` 外框；`.table-scroll` 与 `.ix-detail`
  是内部双区，间距为 0，详情区不再绘制独立边框、圆角、背景模糊或阴影。
- Lab 语义配色按页面选择使用既有角色色与低透明度底纹；不得因此改变共享控件的
  圆角和字重。
- `EPERM` 子进程失败或 `file://` 浏览器限制属于执行环境问题，应改用获批的子进程
  运行路径或本地 HTTP 预览，不通过修改课件模板绕过。

## 五个动作

```text
Main Agent
  → init
  → build
  → review
  → feedback / patch live.deck
  → deliver
```

用户明确要求时，仅可将其中一个隔离步骤交给一个子 Agent。

### 1 init

从已有内容 JSON 建立 `live.json`。如提供原 HTML，只复制到 run 目录 `working/`，原文件不改。

### 2 build

`build-content.mjs` 直接读取 `live.deck` 与三份 CST，生成 `preview.html`。

随后各执行一次：

- 静态检查；
- 浏览器检查。

结果写回 `live.preview`，不生成独立报告。

### 3 review

Main Agent 直接读取：

- `live.json`
- `preview.html`
- 已有原件与工作副本（如有）

生成审查补丁。`run-task.mjs review` 将问题按严重等级合并回 `live.review`。
若用户明确要求，最多把一个 Reviewer 子 Agent 用于本步骤。

### 4 feedback

Main Agent 在对话界面展示 `preview.html` 与问题。用户回复：

- `revise`：修改 `live.deck` 后重新 `build`；
- `approve`：进入交付；
- `abort`：停止。

不生成 human request/response 或 rewrite plan 文件。

### 5 deliver

批准后直接把已通过检查的 preview HTML 提升到交付目录，只重写 Three.js 相对路径。

生成：

```text
courseware/<english-slug>/
├── content_<english-slug>.md
├── content_<english-slug>.json
└── <english-slug>.html
```

## 命令

```text
node Workflow/scripts/run-task.mjs init ...
node Workflow/scripts/run-task.mjs build ...
node Workflow/scripts/run-task.mjs review ...
node Workflow/scripts/run-task.mjs feedback ...
node Workflow/scripts/run-task.mjs deliver ...
node Workflow/scripts/run-task.mjs status ...
node Workflow/scripts/run-task.mjs usage ...
node Workflow/scripts/run-task.mjs memory ...
node Workflow/scripts/run-task.mjs page --live <live.json> --page <n>
node Workflow/scripts/run-task.mjs resume --live <live.json>
```

## 打包规则

新版本 ZIP 与 SHA-256 成功生成后，删除所有旧版本 Skill ZIP、校验文件和旧解包目录；
`Workflow/dist/` 与 `Workflow/releases/current.json` 只保留当前版本。发布目录同时生成
原生 Skill ZIP 和 Codex marketplace 插件 ZIP；DSH 与 Harness 优先通过 Skill 入口加载，
无需额外 JavaScript 插件进程。

用户只在对话界面操作；Main Agent 执行这些动作。

# 〈课件主题〉 — 内容与交付 Manifest

> 版本：4.1
> 机器内容源：`live.json.deck`
> 实现骨架：`CST/TEMPLATE.html`
> 设计、交互与验收规则：`SKILL.md`
> 本文件定义内容字段以及 `live.json.deck → HTML → 交付 Markdown` 的对应关系。

## 1 单一真源

| 产物 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `live.json.deck` | 课程元数据、学习目标、逐屏数据、交互键、来源、页面级 CSS | 脚本、最终 DOM 实现 |
| `TEMPLATE.html` | 舞台、主题、屏型、组件和交互引擎 | 具体课程内容 |
| `SKILL.md` | 设计规则、审查 Gate 和验收标准 | 某屏文案、具体数据 |
| `content_课件标题.md` | 页面矩阵、交互索引、来源、验收摘要和文件摘要 | 重新定义正文或复制整份 HTML |
| `课件标题.html` | 实际文案、DOM、视觉、交互和最终渲染结果 | 规范真源 |

交付 Markdown 是审计 Manifest，不是第二份 HTML 内容源。

## 2 元数据

`live.json.deck.metadata` 必须包含：

| 字段 | 中文含义 | 示例 |
| --- | --- | --- |
| `course` / `course_en` | 课程 | 计算机科学概论 / Introduction to Computer Science |
| `chapter` / `chapter_en` | 章 | 第 5 章 算法 / Chapter 5 Algorithms |
| `part` / `part_en` | 部分 | 第 2 部分 / Part 2 |
| `range` / `range_en` | 节范围 | 第 5.1–5.6 节 / Sections 5.1–5.6 |
| `deck_title` / `deck_title_en` | 课件标题 | 基本算法 / Basic Algorithms |
| `deck_sub` / `deck_sub_en` | 副标题 | 从表示到执行 / From Representation to Execution |
| `date` | 日期 | 2026-11-21 |
| `members` / `members_en` | 成员 | 学号 姓名 |
| `deck_version` | 课件版本 | 1.0 |

主题固定为 `lab`。

## 3 Brief

`live.json.brief` 必须回答：

- 页面目标和业务/教学目标。
- 目标受众与先备知识。
- 明确的内容范围和不扩展范围。
- 阅读路径、练习和交互意图。
- 交付形态、离线约束、语言和验收方式。

无法自动判断的内容冲突写入人工审查问题。

## 4 内容模型

`live.json.deck.content` 字段：

| 字段 | 内容 |
| --- | --- |
| `learning_outcomes` | 学习目标 |
| `key_messages` | 中英文关键结论 |
| `evidence` | 例子、公式、数据或可核验证据 |
| `sources` | 教材、网页、本地文件等来源 |

正文必须区分：

- 事实与解释；
- 核心结论与补充说明；
- 示例数据与真实来源数据；
- 已知边界与推测。

## 5 逐屏数据

`live.json.deck.slides` 每项至少包含：

```json
{
  "id": "s1",
  "type": "screen-cover",
  "eyebrow": "01 · 主题",
  "eyebrow_en": "01 · TOPIC",
  "title": "页面标题",
  "title_en": "Page title",
  "lead": "导语",
  "lead_en": "Lead",
  "body_html": "可信 HTML 片段",
  "widget": {}
}
```

按屏型填写主体槽位：

| 屏型 | 必须字段 |
| --- | --- |
| `screen-cover` | `visual_html` |
| `screen-text` | `title`、`title_en`、`body_html` |
| `screen-split` | `left_html`、`right_html` |
| `screen-table` | `body_html` 内包含语义表格 |
| `screen-figure` | `body_html` 或对应交互主体 |
| `screen-widget` | `body_html` 与唯一 `widget` |
| `screen-summary` | `body_html` |
| `screen-quiz` | `.quiz-q` 结构和唯一 `widget` |

### 5.1 页面级样式

只属于当前课件的 CSS 写入顶层 `style_overrides` 字符串数组：

```json
{
  "style_overrides": [
    "[data-title-zh=\"当前页面\"] .body-area > .quiz { max-height: 350px; }"
  ]
}
```

- 页面选择器必须限定到当前课件屏，不得修改全局主题。
- 全局字体、间距和通用组件规则放在 `Workflow/overrides/`。
- 每个字符串不得包含 `</style>`。
- Builder 将数组按顺序注入 `<style data-content-overrides>`。

### 5.2 已有原件

已有 HTML 通过 `run-task.mjs init --source-html <path>` 登记：

```json
{
  "source": {
    "mode": "copy-on-write",
    "original_ref": "courseware/已有课件.html",
    "working_ref": "Workflow/runs/<task-id>/working/已有课件.html",
    "sha256": "…"
  }
}
```

- 原文件只读，Reviewer 直接读取原文件。
- 所有候选改动写入 run 目录工作副本和 `preview.html`。
- 不创建新的“原件审查版”替代原始文件。

## 6 交互数据

每个交互根必须有唯一 `data-iw-id`，且不得嵌套另一个 `data-iw`。

每个交互屏还必须声明：

```json
{
  "linked_state": "binary-search",
  "linked_components": [
    {"name": "目标滑块", "type": "slider", "role": "input"},
    {"name": "数组", "type": "svg", "role": "visual"},
    {"name": "状态表", "type": "table", "role": "readout"},
    {"name": "算法轨迹", "type": "algo", "role": "step"}
  ]
}
```

- `linked_components` 至少两项。
- 所有组件共享同一个 `linked_state`。
- 任一输入变化必须同步更新至少另一个可见组件。

`widget` 字段：

```json
{
  "key": "quiz",
  "instance_key": "quiz-main",
  "title": "练习",
  "title_en": "Practice",
  "value": "未作答"
}
```

复杂交互或交互返工还必须提供：

```json
{
  "interaction_review": {
    "required": true,
    "candidates": [
      {
        "id": "C1",
        "name": "候选名称",
        "source_ref": "https://真实来源",
        "source_type": "external",
        "preview_html": "可运行预览片段",
        "mechanism": "交互机制",
        "strengths": ["优点"],
        "limitations": ["限制"],
        "fit": "适配理由"
      }
    ],
    "selected_candidate_id": null,
    "selected_by": null
  }
}
```

最多保留 3 个方案，用户选定后才能实现。

### 6.1 交互图形与终端字段

教材类交互 SVG 在交互根上声明：

```html
<div class="svg-scene" data-iw="svg" data-iw-id="flow-main"
  data-flow-highlight="single-fill">
```

- `single-fill` 表示选中状态只填充已绘制图形，无状态描边或额外选择框。
- 每个 `[data-svg-node]` 的子图形共同构成命中范围，不得加入透明热区。
- 时间线的年份、版本或里程碑节点必须使用带填充的 `rect`、`polygon` 等图形。
- 交互节点无论是否选中均不得保留轮廓描边；使用灰色填充与黄色填充区分状态。
- 交互图使用 `aria-label` 与 `<desc>` 命名，不使用会产生悬浮提示的 `<title>`。

终端类交互使用三个职责标记：

| 标记 | 职责 |
| --- | --- |
| `data-terminal-pane` | 固定屏幕边界，裁剪所有内部溢出 |
| `data-terminal-scroll` | 只让输出内容在屏幕内纵向滚动 |
| `data-terminal-fixed` | 固定输入栏或底部操作区 |

Builder 不改写这些标记；浏览器检查负责验证大量输出后输入栏仍在屏幕内。

## 7 内容到 HTML 的对应

| live JSON / CST | HTML 产物 |
| --- | --- |
| 元数据 | `<title>`、顶部栏、封面元信息 |
| `deck.slides[]` | 一个 `section.slide` |
| `screen-*` | 对应模板块 |
| `body_html` / `left_html` / `right_html` / `visual_html` | 对应注入槽位 |
| `widget.instance_key` | `data-iw-id` |
| `interaction_review.selected_candidate_id` | 交互实现和来源记录 |
| `sources` | 页面来源链接 |
| `style_overrides` | 当前课件专属的 `<style>` 内容 |

## 8 交付 Markdown

`content_课件标题.md` 由机器生成，至少包含：

1. 版本、页数、交互数、主题和语言。
2. 内容目标与学习成果。
3. 页面结构表：页码、屏 ID、屏型、标题、交互实例键。
4. 交互索引：组件键、实例键和页码。
5. 来源列表与交互选型来源。
6. 静态、浏览器和单轮基础审查结果，以及人工确认状态。
7. HTML 与 JSON 的 SHA-256。

交付目录：

```text
courseware/<课件标题>/
├── content_<课件标题>.md
├── content_<课件标题>.json
└── <课件标题>.html
```

## 9 来源与验证

- 所有事实性断言必须有教材、本地材料或可访问来源支持。
- 推断内容必须明确标记为推断。
- 页面数量、交互实例键和来源链接由脚本核验。
- HTML 必须通过静态检查、浏览器检查和一次基础审查。
- 发布前必须生成 `Workflow/runs/<task-id>/preview.html`，直接展示真实交互 HTML。
- 截图只用于失败诊断，不能替代临时 HTML 预览。
- 交付前必须在对话界面展示临时 HTML 并获得确认。
- 用户要求继续修改时不设置固定轮数上限，直到用户明确满意。

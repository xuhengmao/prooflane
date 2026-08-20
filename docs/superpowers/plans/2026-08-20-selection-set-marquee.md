# DES-1A.3 选择集与框选基础实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SVG 设计画布上增加多选、修饰键选择和文档坐标框选，同时保持单节点编辑和保存边界稳定。

**Architecture:** 新增纯函数 `selection.ts` 管理可选择节点和矩形命中；`DesignSvgCanvas` 管理临时框选手势和选择轮廓；`DesignCanvasHost` 透传选择集；`DesignWorkspace` 将选择集作为临时 UI 状态；属性面板按 0/1/多选分支渲染，不改命令和存储模型。

**Tech Stack:** Next.js 16、React 19、TypeScript、SVG、Tailwind CSS v4、next-intl、Vitest、Testing Library。

## Global Constraints

- 选择集、框选矩形和多选轮廓不写入 DesignDocument、revision 或 localStorage。
- 仅普通单节点允许拖拽；多选不触发批量移动命令。
- 锁定、隐藏、document、page 节点不可进入选择集。
- 命中函数按 `document.nodes` 原始顺序返回稳定 id，后续可替换为空间索引。
- 不实现批量属性、编组、对齐、CanvasKit、导出、AI Composer 或原型执行。
- 手工编辑使用 `apply_patch`；PowerShell 命令前启用 Windows UTF-8。

---

### Task 1: 选择命中纯函数

**Files:**
- Create: `src/lib/design/selection.ts`
- Create: `src/lib/design/selection.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it("filters hidden, locked, document and page nodes", () => {
  expect(selectableNodes(document).map((node) => node.id)).toEqual(["shape"])
})

it("returns nodes intersecting the selection rectangle in document order", () => {
  expect(hitTestSelectionRect(document, { x: 10, y: 10, width: 100, height: 100 })).toEqual(["shape"])
})
```

- [ ] **Step 2: 运行确认失败**

运行：`pnpm vitest run src/lib/design/selection.test.ts`

预期：模块不存在，测试失败。

- [ ] **Step 3: 实现纯函数**

实现 `selectableNodes` 过滤规则；实现 `rectIntersectsBounds` 支持负向框选宽高并把边界接触视为相交；实现 `hitTestSelectionRect` 过滤并按原数组顺序返回 id。

- [ ] **Step 4: 运行通过并提交**

运行：`pnpm vitest run src/lib/design/selection.test.ts`

```powershell
git add src/lib/design/selection.ts src/lib/design/selection.test.ts
git commit -m "feat(DES-1A.3): 增加选择集命中纯函数"
```

### Task 2: SVG 多选与框选交互

**Files:**
- Modify: `src/components/design/design-svg-canvas.tsx`
- Modify: `src/components/design/design-svg-canvas.test.tsx`

- [ ] **Step 1: 写失败测试**

覆盖普通点击替换、Shift/Ctrl/Cmd 追加移除、空白清空、框选命中、锁定/隐藏过滤、多选轮廓和单节点拖拽回归。

- [ ] **Step 2: 运行确认失败**

运行：`pnpm vitest run src/components/design/design-svg-canvas.test.tsx`

预期：现有组件只接受 `selectedNodeId`，多选和框选断言失败。

- [ ] **Step 3: 实现选择集状态**

将 props 改为 `selectedNodeIds` 与 `onSelectionChange`；节点点击根据修饰键生成新数组；空白点击按规则清空或保持；Escape 清空。

- [ ] **Step 4: 实现框选**

在 SVG 空白区域 pointer down 记录文档坐标，移动超过 3 文档像素后维护临时 rect，pointer up 调用 `hitTestSelectionRect`；选择框使用 `pointer-events="none"` 的绿色半透明 SVG rect。

- [ ] **Step 5: 实现多选轮廓和拖拽边界**

单选沿用现有四角控制点；多选绘制包围全部选中 bounds 的轮廓；只有唯一节点选中且按下节点就是它时启用拖拽。

- [ ] **Step 6: 运行通过并提交**

运行：`pnpm vitest run src/components/design/design-svg-canvas.test.tsx`

```powershell
git add src/components/design/design-svg-canvas.tsx src/components/design/design-svg-canvas.test.tsx
git commit -m "feat(DES-1A.3): 增加画布多选与框选"
```

### Task 3: 工作台与属性面板接入选择集

**Files:**
- Modify: `src/components/design/design-workspace.tsx`
- Modify: `src/components/design/design-canvas-host.tsx`
- Modify: `src/components/design/design-properties-panel.tsx`
- Modify: `src/components/design/design-workspace.test.tsx`
- Modify: `src/components/design/design-properties-panel.test.tsx`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: other existing locale message files

- [ ] **Step 1: 写失败测试**

断言选择集变化不触发保存；多选面板显示数量和范围摘要；多选不出现 X/Y/文本编辑字段；prototype/run 不能创建或拖拽选择。

- [ ] **Step 2: 运行确认失败**

运行：`pnpm vitest run src/components/design/design-workspace.test.tsx src/components/design/design-properties-panel.test.tsx`

预期：工作台仍只传递单个 selectedNodeId，属性面板无法处理多选。

- [ ] **Step 3: 接入选择集**

工作台持有 `selectedNodeIds`；单选时向属性面板传一个节点，多选传节点数组；保存逻辑保持只读取 document；CanvasHost 透传选择集。

- [ ] **Step 4: 更新多语言文案**

增加 `properties.multipleSelected`、`properties.selectionSummary` 等键，十个语言包结构一致。

- [ ] **Step 5: 运行通过并提交**

运行：`pnpm vitest run src/components/design/design-workspace.test.tsx src/components/design/design-properties-panel.test.tsx src/i18n/messages.test.ts`

```powershell
git add src/components/design src/i18n/messages
git commit -m "feat(DES-1A.3): 将选择集接入设计工作台"
```

### Task 4: 文档、质量门禁与实施记录

**Files:**
- Modify: `README.md`
- Modify: `D:\工作相关\工作文件\工作资料\AI项目\docs\10-Prooflane原生AI设计工作台产品规划与分阶段路线图.md`
- Modify: `D:\工作相关\工作文件\工作资料\AI项目\docs\19-Prooflane-DES-1A七阶段实施路线图.md`
- Create: `D:\工作相关\工作文件\工作资料\AI项目\docs\23-Prooflane-DES-1A.3-选择集与框选实施记录.md`

- [ ] **Step 1: 同步文档**

记录多选、修饰键、框选和命中纯函数已交付；明确批量编辑、空间索引和 CanvasKit 仍未交付。

- [ ] **Step 2: 执行最终门禁**

```powershell
pnpm vitest run --reporter=dot
pnpm eslint src/components/design src/lib/design/selection.ts src/lib/design/selection.test.ts
pnpm build
git diff --check
```

- [ ] **Step 3: 提交 README**

```powershell
git add README.md
git commit -m "docs(DES-1A.3): 记录选择集与框选交付"
```

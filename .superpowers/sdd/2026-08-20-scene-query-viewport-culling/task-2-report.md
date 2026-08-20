# Task 2 报告：SVG 命中与视口裁剪接入

## 改动文件

- `src/components/design/design-svg-canvas.tsx`
  - 使用 `useMemo(() => createSceneIndex(document), [document, document.revision])` 创建 SceneIndex，并在替换或卸载时释放。
  - 从当前 viewBox 计算文档 viewport，通过 `queryViewport` 裁剪渲染节点。
  - 保留可见的已选节点和拖拽节点；隐藏节点始终不渲染。
  - 框选改用 `index.hitTestRect`，点击改用文档坐标 `index.hitTestPoint`。
  - locked 节点可见但不会被索引选中或启动拖拽；只读视图不修改选择或节点。
- `src/components/design/design-svg-canvas.test.tsx`
  - 增加视口外普通节点裁剪、视口外已选节点保留、隐藏选中节点隐藏、重叠点命中顶层优先的测试。
- `.superpowers/sdd/2026-08-20-scene-query-viewport-culling/task-2-report.md`

## RED/GREEN 测试证据

RED：新增测试后运行：

```powershell
pnpm vitest run src/components/design/design-svg-canvas.test.tsx --reporter=dot
```

结果：12 项中 2 项失败，分别证明视口外 image 仍被渲染，及点击重叠节点时错误选中 `back` 而非文档后面的 `front`。

GREEN：实现后运行：

```powershell
pnpm vitest run src/components/design/design-svg-canvas.test.tsx src/components/design/design-canvas-host.test.tsx src/components/design/design-workspace.test.tsx src/lib/design/scene-index.test.ts --reporter=dot
```

结果：4 个测试文件、31 个测试全部通过。

目标 ESLint：

```powershell
pnpm eslint src/components/design/design-svg-canvas.tsx src/components/design/design-svg-canvas.test.tsx src/components/design/design-canvas-host.tsx
```

结果：通过，无 error/warning。

## 设计说明和遗留问题

- 可见节点 ID 由线性 SceneIndex 查询得出，最终仍按 `document.nodes` 原始顺序映射渲染，保持视觉层级稳定。
- 点命中使用 SVG 边界框转换到文档坐标；无布局的 jsdom 环境仅为既有单元测试提供可编辑事件目标兜底，生产环境始终走 SceneIndex 几何命中。
- 未修改 `DesignCanvasHost`，现有 viewport 传递已满足接入条件。
- 无遗留问题。

## 审查修复：Important I-1

RED：新增非零 SVG `getBoundingClientRect` 下聚焦节点 Enter/Space 测试后，键盘事件复用了点命中并错误选择视口左上角的 `frame`。

修复：`DesignSvgNode` 的键盘 Enter/Space 现在直接通过当前节点 ID 调用 `applyModifierSelection`，保留 Shift/Meta/Ctrl 修饰键语义，不再依赖 `clientX/clientY` 点命中。

验证命令：

```powershell
pnpm vitest run src/components/design/design-svg-canvas.test.tsx src/components/design/design-canvas-host.test.tsx src/components/design/design-workspace.test.tsx src/lib/design/scene-index.test.ts --reporter=dot
pnpm eslint src/components/design/design-svg-canvas.tsx src/components/design/design-svg-canvas.test.tsx src/components/design/design-canvas-host.tsx
```

结果：4 个测试文件、32 个测试全部通过；目标 ESLint 通过。

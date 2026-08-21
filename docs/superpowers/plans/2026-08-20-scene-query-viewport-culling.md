# DES-1A.3 场景查询与视口裁剪实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立渲染器无关的 `SceneIndex` 查询层，并将专业点命中、矩形框选和视口裁剪接入当前 SVG 画布，为后续 CanvasKit/WebGL 共用同一套几何契约。

**Architecture:** `SceneIndex` 接收完整 `DesignDocument`，构建轻量几何记录和 ID 映射，第一版使用确定性的线性扫描。它负责可见性过滤、点命中层级排序、矩形命中文档顺序和视口相交查询；React 画布通过 `useMemo` 按文档 revision 重建索引，仅在 viewport 变化时复用索引。选择状态、视口状态和索引均不写入设计文档。

**Tech Stack:** TypeScript、React 19、SVG `viewBox`、Vitest、Testing Library、ESLint、Next.js 16。

## Global Constraints

- `DesignDocument` 是设计事实来源，查询层只返回节点 ID，不修改文档。
- `visible === false` 节点不参与视口和命中；`locked === true` 节点可渲染但不可选；`document/page` 不可选。
- 点命中返回视觉层级从上到下；矩形命中和视口查询保持文档顺序。
- 支持负向矩形和边界接触相交。
- 仅文档 revision 或节点几何/可见性变化时重建索引；viewport、zoom、pan 变化复用索引。
- 不引入 R-tree、四叉树、Worker、CanvasKit/WebGL 主渲染、吸附、导出或批量变换。
- 旧的 `selectedNodeId/onSelectNode` 兼容接口继续保留。
- 所有手工编辑使用 `apply_patch`；目标命令前启用 Windows UTF-8 基线。

---

### Task 1: SceneIndex 契约与纯函数行为

**Files:**
- Create: `src/lib/design/scene-index.ts`
- Create: `src/lib/design/scene-index.test.ts`
- Modify: `src/lib/design/selection.ts`
- Modify: `src/lib/design/selection.test.ts`

**Interfaces:**
- Consumes: `DesignDocument`, `DesignBounds` from `src/lib/design/ast.ts`.
- Produces: `SceneIndex`, `createSceneIndex(document)`, and stable geometric query behavior used by the SVG canvas.

- [ ] **Step 1: Write failing tests for the public contract**

```ts
it("returns visible viewport nodes in document order", () => {
  const index = createSceneIndex(document)
  expect(index.queryViewport({ x: 0, y: 0, width: 100, height: 100 })).toEqual([
    "background",
    "card",
  ])
})

it("returns the visually topmost point hit first", () => {
  const index = createSceneIndex(overlappingDocument)
  expect(index.hitTestPoint({ x: 30, y: 30 })).toEqual(["top", "bottom"])
})

it("filters locked, hidden, container, and missing-bounds nodes", () => {
  expect(createSceneIndex(documentWithNonSelectableNodes).hitTestRect(rect)).toEqual([
    "editable",
  ])
})

it("exposes the source revision and has a safe dispose", () => {
  const index = createSceneIndex(document)
  expect(index.revision).toBe(document.revision)
  expect(() => index.dispose()).not.toThrow()
})
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing module or missing behavior**

Run: `pnpm vitest run src/lib/design/scene-index.test.ts --reporter=dot`

Expected: FAIL because `scene-index.ts` and `createSceneIndex` do not exist yet.

- [ ] **Step 3: Implement the minimal linear SceneIndex**

Implement these exact types and functions:

```ts
export interface SceneIndex {
  readonly revision: string
  queryViewport(viewport: DesignBounds): string[]
  hitTestPoint(point: { x: number; y: number }): string[]
  hitTestRect(rect: DesignBounds): string[]
  dispose(): void
}

export function createSceneIndex(document: DesignDocument): SceneIndex
```

Store only `{ id, bounds, nodeIndex, visible, selectable, zOrder }` records. Normalize all rectangles before comparing. Use `document.nodes` order for viewport/rect results and reverse record order for point-hit results. Keep `dispose()` idempotent and clear internal arrays/maps.

- [ ] **Step 4: Run focused tests and the existing selection tests**

Run: `pnpm vitest run src/lib/design/scene-index.test.ts src/lib/design/selection.test.ts --reporter=dot`

Expected: all tests pass; no existing selection semantics regress.

- [ ] **Step 5: Commit the query layer**

```powershell
git add src/lib/design/scene-index.ts src/lib/design/scene-index.test.ts src/lib/design/selection.ts src/lib/design/selection.test.ts
git commit -m "feat(DES-1A.3): 增加场景查询索引契约"
```

### Task 2: SVG 命中与视口裁剪接入

**Files:**
- Modify: `src/components/design/design-svg-canvas.tsx`
- Modify: `src/components/design/design-svg-canvas.test.tsx`
- Modify: `src/components/design/design-canvas-host.tsx`

**Interfaces:**
- Consumes: `createSceneIndex`, `SceneIndex` from Task 1; existing `CanvasViewport` conversion helpers.
- Produces: SVG rendering limited to viewport-intersecting nodes and selection gestures backed by `SceneIndex`.

- [ ] **Step 1: Add failing viewport-culling and point-hit tests**

Add a far-away editable node and assert it is absent from the SVG when outside the viewport, while the selected far-away node remains rendered for selection stability. Add overlapping nodes and assert a canvas point click resolves through `hitTestPoint` with the topmost node first.

```ts
it("renders only viewport nodes but keeps an offscreen selected node", () => {
  renderCanvas({
    selectedNodeIds: ["offscreen"],
    viewport: { centerX: 400, centerY: 300, width: 800, height: 600, zoom: 1 },
  })
  expect(screen.queryByTestId("design-node-far-away")).toBeTruthy()
  expect(screen.queryByTestId("design-node-offscreen-unselected")).toBeNull()
})
```

- [ ] **Step 2: Run the focused SVG test and verify the new assertions fail**

Run: `pnpm vitest run src/components/design/design-svg-canvas.test.tsx --reporter=dot`

Expected: FAIL because the canvas currently renders every document node and calls the old selection helper directly.

- [ ] **Step 3: Create and memoize the SceneIndex by document identity/revision**

Inside `DesignSvgCanvas`, create the index with `useMemo(() => createSceneIndex(document), [document])`. Use `index.queryViewport` with the current viewBox rectangle. Do not include viewport in the memo dependencies. If a parent keeps the same document object while changing its revision, include `document.revision` in the dependency list.

- [ ] **Step 4: Render only queried nodes plus selected/dragged exceptions**

Build `visibleNodeIds` from `queryViewport`. Render nodes whose IDs are in that set, plus selected visible nodes and the active drag node. Keep the original `document.nodes` order when mapping to JSX. Do not render hidden nodes even when selected.

- [ ] **Step 5: Route point and marquee queries through SceneIndex**

Replace `hitTestSelectionRect(document, rect)` with `index.hitTestRect(rect)`. For node click handling, use the event document point and `index.hitTestPoint(point)` before notifying selection; use the first ID as the default replacement selection and preserve modifier-click behavior. Keep locked nodes rendered but non-selectable.

- [ ] **Step 6: Run SVG, host, workspace and selection tests**

Run: `pnpm vitest run src/components/design/design-svg-canvas.test.tsx src/components/design/design-canvas-host.test.tsx src/components/design/design-workspace.test.tsx src/lib/design/scene-index.test.ts --reporter=dot`

Expected: all focused tests pass; zoom, pan, drag, modifier selection, marquee and property panel behavior remain unchanged.

- [ ] **Step 7: Commit SVG integration**

```powershell
git add src/components/design/design-svg-canvas.tsx src/components/design/design-svg-canvas.test.tsx src/components/design/design-canvas-host.tsx
git commit -m "feat(DES-1A.3): 接入场景命中与视口裁剪"
```

### Task 3: 固定场景性能与正确性基准

**Files:**
- Create: `src/lib/design/scene-index.benchmark.test.ts`
- Create: `src/lib/design/scene-index-fixtures.ts`
- Modify: `package.json` only if a dedicated benchmark script is needed; do not add a dependency.

**Interfaces:**
- Consumes: `createSceneIndex` from Task 1 and fixed `DesignDocument` fixtures.
- Produces: deterministic 100/1,000/10,000 node correctness and timing coverage.

- [ ] **Step 1: Write fixture and reference-query tests first**

Create `createGridDocument(count)` using deterministic row/column placement, fixed dimensions, and revision `grid-${count}`. Add a simple reference implementation in the test file that scans the document directly. Assert `queryViewport`, `hitTestPoint`, and `hitTestRect` match the reference for 100, 1,000, and 10,000 nodes.

- [ ] **Step 2: Run the benchmark tests before implementation changes**

Run: `pnpm vitest run src/lib/design/scene-index.benchmark.test.ts --reporter=dot`

Expected: the suite fails only if the fixture or index contract is absent; once Task 1 is present, correctness assertions pass.

- [ ] **Step 3: Add repeatable timing measurements without flaky hard limits**

For each count, run 25 identical queries after one warm-up. Record median and P95 with `performance.now()`. Assert all durations are finite and emit a warning when the 10,000-node P95 exceeds 16ms; keep result equality as the hard gate so slower CI machines do not produce false failures.

- [ ] **Step 4: Run the benchmark suite and inspect output**

Run: `pnpm vitest run src/lib/design/scene-index.benchmark.test.ts --reporter=verbose`

Expected: all three fixture sizes pass correctness; output includes build/query timing for viewport, point and rectangle queries.

- [ ] **Step 5: Commit the deterministic benchmark**

```powershell
git add src/lib/design/scene-index-fixtures.ts src/lib/design/scene-index.benchmark.test.ts
git commit -m "test(DES-1A.3): 增加场景查询性能基准"
```

### Task 4: 文档与 README 同步

**Files:**
- Modify: `README.md`
- Modify: `D:\工作相关\工作文件\工作资料\AI项目\docs\10-Prooflane原生AI设计工作台产品规划与分阶段路线图.md`
- Modify: `D:\工作相关\工作文件\工作资料\AI项目\docs\19-Prooflane-DES-1A七阶段实施路线图.md`
- Create: `D:\工作相关\工作文件\工作资料\AI项目\docs\24-Prooflane-DES-1A.3-场景查询与视口裁剪实施记录.md`

**Interfaces:**
- Consumes: delivered behavior and benchmark output from Tasks 1-3.
- Produces: synchronized product status, implementation record, and user-facing README capability description.

- [ ] **Step 1: Update product status accurately**

Record that the renderer-independent linear `SceneIndex`, point hit ordering, rectangle hit filtering, viewport culling, selected-node exception, and deterministic benchmark are delivered. Keep CanvasKit/WebGL main rendering, spatial-tree replacement, Worker rendering, export and 10,000-node P95 as future or measured-gate items unless the actual run proves them.

- [ ] **Step 2: Add an implementation record**

Document changed files, query contracts, visibility rules, lifecycle rules, benchmark counts and actual test commands. State explicitly that the first implementation is linear and replaceable.

- [ ] **Step 3: Update README without overstating scope**

Describe professional point hit ordering and viewport culling as delivered foundations. Keep “CanvasKit main renderer” and “final spatial index/performance gate” listed as future work.

- [ ] **Step 4: Run markdown diff validation and commit docs**

```powershell
git diff --check
git add README.md
git add "D:\工作相关\工作文件\工作资料\AI项目\docs\10-Prooflane原生AI设计工作台产品规划与分阶段路线图.md"
git add "D:\工作相关\工作文件\工作资料\AI项目\docs\19-Prooflane-DES-1A七阶段实施路线图.md"
git add "D:\工作相关\工作文件\工作资料\AI项目\docs\24-Prooflane-DES-1A.3-场景查询与视口裁剪实施记录.md"
git commit -m "docs(DES-1A.3): 记录场景查询与视口裁剪"
```

### Task 5: Final Verification Gate

**Files:**
- No source changes expected; only fix issues discovered by verification.

- [ ] **Step 1: Run all unit and component tests**

Run: `pnpm vitest run --reporter=basic *> .full-vitest-scene-query.log`

Expected: exit code `0`; all test files pass. The log may contain existing warning output, so the exit code and summary are authoritative.

- [ ] **Step 2: Run targeted ESLint**

Run: `pnpm eslint src/components/design src/lib/design/scene-index.ts src/lib/design/scene-index.test.ts src/lib/design/scene-index-fixtures.ts src/lib/design/scene-index.benchmark.test.ts`

Expected: exit code `0` with no lint errors.

- [ ] **Step 3: Validate production build**

Run: `pnpm build`

Expected: Next.js compilation, TypeScript checking and all 34 static pages complete successfully.

- [ ] **Step 4: Run whitespace and status checks**

Run: `git diff --check; git status --short`

Expected: no whitespace errors; only intentional untracked ignored logs or pre-existing `.superpowers/brainstorm/` remain.

- [ ] **Step 5: Record final result and stop before CanvasKit**

Do not begin CanvasKit/WebGL main-renderer work in this task. The next phase starts only after this SceneIndex contract and benchmark evidence are reviewed.

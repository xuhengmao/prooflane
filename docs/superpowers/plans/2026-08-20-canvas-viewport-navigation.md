# DES-1A.3 基础画布导航实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 SVG 设计画布上交付基于 `viewBox` 的平移、缩放、适配和重置视图，并保证节点编辑坐标在所有视口状态下稳定。

**Architecture:** 新增纯函数模块统一维护 `CanvasViewport`、锚点缩放、平移、适配和屏幕坐标转换。`DesignCanvasHost` 负责宿主尺寸观察与导航手势，`DesignSvgCanvas` 只负责使用计算后的 `viewBox` 渲染和复用坐标转换；`DesignWorkspaceContext` 继续保存已有 UI 级 `zoom/panX/panY`，但不把视口写入 DesignDocument 或 revision。

**Tech Stack:** Next.js 16、React 19、TypeScript、Tailwind CSS v4、Lucide、next-intl、Vitest、Testing Library、现有 Design AST/commands。

## Global Constraints

- 不启动共享用户数据的 `pnpm tauri dev`；验证使用 Vitest、ESLint、Next 生产构建和隔离环境。
- SVG `viewBox` 是画布视口事实来源；不得继续用 CSS `transform: scale(...)` 表达缩放。
- 视口操作只更新本地/UI 状态，不调用 `applyCommand`，不修改 DesignDocument 节点 bounds。
- 缩放范围固定为 `0.1～8`（显示 `10%～800%`）。
- 平移不设硬边界；“适配画布”始终可以回到根 Frame。
- 节点选择、拖拽和属性编辑必须复用统一屏幕坐标到文档坐标转换。
- 所有新增文案同步 `en`、`zh-CN` 以及其余现有语言包；禁止只更新单一语言。
- 手工编辑使用 `apply_patch`；PowerShell 命令前启用 Windows UTF-8。
- 不实现 CanvasKit、WebGL、框选、空间索引、导出、独立窗口、AI Composer 或原型执行。

---

### Task 1: 视口纯函数与数学契约

**Files:**
- Create: `src/lib/design/canvas-viewport.ts`
- Create: `src/lib/design/canvas-viewport.test.ts`

**Interfaces:**
- `CanvasViewport = { centerX: number; centerY: number; width: number; height: number; zoom: number }`
- `clampZoom(zoom: number): number`
- `zoomAroundPoint(viewport, nextZoom, anchor): CanvasViewport`
- `panViewport(viewport, delta): CanvasViewport`
- `fitViewport(bounds, host, padding): CanvasViewport`
- `clientPointToDocument(client, hostRect, viewport): { x: number; y: number }`
- `documentBounds(document: DesignDocument): DesignBounds`

- [ ] **Step 1: 写失败测试**

```ts
it("clamps zoom to 10% through 800%", () => {
  expect(clampZoom(0)).toBe(0.1)
  expect(clampZoom(99)).toBe(8)
})

it("keeps the document anchor stable while zooming", () => {
  const viewport = { centerX: 500, centerY: 300, width: 1000, height: 600, zoom: 1 }
  const next = zoomAroundPoint(viewport, 2, { x: 700, y: 350 })
  expect(next.centerX - next.width / 2).toBeCloseTo(600)
  expect(next.centerY - next.height / 2).toBeCloseTo(275)
})

it("converts client coordinates using the current viewBox", () => {
  const point = clientPointToDocument(
    { x: 250, y: 150 },
    { left: 50, top: 50, width: 400, height: 200 },
    { centerX: 500, centerY: 300, width: 800, height: 400, zoom: 1 }
  )
  expect(point).toEqual({ x: 500, y: 300 })
})
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm vitest run src/lib/design/canvas-viewport.test.ts`

预期：因 `canvas-viewport.ts` 尚不存在而失败。

- [ ] **Step 3: 实现最小纯函数**

使用有限数字保护和最小安全尺寸。`documentBounds` 从 root Frame 优先计算，否则包围所有可见有 bounds 节点；`zoomAroundPoint` 先按 `nextZoom / viewport.zoom` 调整 width/height，再根据锚点在旧视口中的相对比例计算新中心；`panViewport` 直接累加文档坐标 delta；`fitViewport` 使用 host 宽高比和 padding 生成完整覆盖 bounds 的视口；`clientPointToDocument` 使用 `hostRect` 与 viewBox 左上角换算文档坐标。

- [ ] **Step 4: 运行专项测试**

运行：`pnpm vitest run src/lib/design/canvas-viewport.test.ts`

预期：全部通过，覆盖非法 host 尺寸和非法输入的安全默认值。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/design/canvas-viewport.ts src/lib/design/canvas-viewport.test.ts
git commit -m "feat(DES-1A.3): 增加画布视口数学模型"
```

### Task 2: SVG viewBox 与节点坐标接入

**Files:**
- Modify: `src/components/design/design-svg-canvas.tsx`
- Modify: `src/components/design/design-svg-canvas.test.tsx`

**Interfaces:**
- `DesignSvgCanvas` 接收 `viewport: CanvasViewport`，移除 CSS `transform: scale(...)`。
- 节点拖拽内部统一调用 `clientPointToDocument`，不再维护独立的 `DesignBounds` 坐标转换实现。

- [ ] **Step 1: 写失败回归测试**

补充断言：传入 `{ centerX: 720, centerY: 450, width: 1440, height: 900, zoom: 1 }` 时 `viewBox` 为 `0 0 1440 900`；传入平移/缩放视口时 viewBox 左上角和尺寸正确；同一 client point 在不同视口下对应预期文档点；拖拽 pointer up 仍只提交一次节点移动。

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm vitest run src/components/design/design-svg-canvas.test.tsx`

预期：类型或 viewBox 断言失败，因为组件仍使用旧 `zoom` 和文档 bounds。

- [ ] **Step 3: 接入 `CanvasViewport`**

计算 `viewBox` 为 `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`；将 SVG class 保留为响应式尺寸，不再设置 `style.transform`。拖拽起点、预览和结束点全部调用共享 `clientPointToDocument`。

- [ ] **Step 4: 运行 SVG 专项测试**

运行：`pnpm vitest run src/components/design/design-svg-canvas.test.tsx`

预期：渲染、选择、锁定节点、平移/缩放坐标和拖拽回归全部通过。

- [ ] **Step 5: 提交**

```powershell
git add src/components/design/design-svg-canvas.tsx src/components/design/design-svg-canvas.test.tsx
git commit -m "feat(DES-1A.3): 使用 viewBox 接入画布坐标"
```

### Task 3: DesignCanvasHost 导航交互

**Files:**
- Modify: `src/components/design/design-canvas-host.tsx`
- Create: `src/components/design/design-canvas-host.test.tsx`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/zh-CN.json`
- Modify: `src/i18n/messages/ar.json`
- Modify: `src/i18n/messages/de.json`
- Modify: `src/i18n/messages/es.json`
- Modify: `src/i18n/messages/fr.json`
- Modify: `src/i18n/messages/ja.json`
- Modify: `src/i18n/messages/ko.json`
- Modify: `src/i18n/messages/pt.json`
- Modify: `src/i18n/messages/zh-TW.json`

**Interfaces:**
- `DesignCanvasHost` 接收现有 `document`、`zoom`、`panX`、`panY`、`onZoomChange` 和 `onPanChange`，继续接收节点选择/移动回调；宿主内部结合真实尺寸生成 `CanvasViewport`。
- 新增工具栏文案键：`canvas.fit`, `canvas.reset`, `canvas.pan`, `canvas.zoomReset`。

- [ ] **Step 1: 写失败交互测试**

使用测试宿主提供 `getBoundingClientRect`：

```ts
it("zooms around the wheel pointer", () => {
  render(<DesignCanvasHost {...props} />)
  fireEvent.wheel(screen.getByTestId("design-canvas-host"), { deltaY: -100, clientX: 300, clientY: 200 })
  expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ zoom: expect.any(Number) }))
})

it("pans with the middle button and exposes fit/reset buttons", () => {
  render(<DesignCanvasHost {...props} />)
  fireEvent.pointerDown(host, { button: 1, pointerId: 4, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(host, { pointerId: 4, clientX: 140, clientY: 120 })
  fireEvent.pointerUp(host, { pointerId: 4, clientX: 140, clientY: 120 })
  expect(onViewportChange).toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: /fit|适配/i }))
  fireEvent.click(screen.getByRole("button", { name: /reset|重置/i }))
})
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm vitest run src/components/design/design-canvas-host.test.tsx`

预期：找不到新导航按钮，且滚轮/平移没有触发视口回调。

- [ ] **Step 3: 实现宿主尺寸与状态**

使用 `ResizeObserver` 读取 `design-canvas-host` 内容区域尺寸；首次获得有效尺寸调用 `fitViewport(documentBounds(document), hostSize, 48)`，并将得到的 zoom/pan 映射到现有回调。容器尺寸变化时保留当前中心与 zoom，按新宽高比更新 width/height。

- [ ] **Step 4: 实现滚轮与平移**

滚轮调用共享 `clientPointToDocument` 和 `zoomAroundPoint`；中键或空格按下后的左键进入平移状态，pointer move 调用 `panViewport`，pointer up/cancel 清理状态。平移时阻止浏览器默认滚动，普通滚轮仍只作用于画布宿主。

- [ ] **Step 5: 实现键盘与工具栏**

画布宿主聚焦时处理 `+`、`=`、`-`、`0`；输入框、属性面板和 Composer 聚焦时直接返回。添加 `ScanSearch`/`Maximize2` 或同等 Lucide 图标按钮，并配置 Tooltip、aria-label 和百分比状态文本。

- [ ] **Step 6: 更新所有语言包并运行测试**

为十个语言包补齐新键；运行：`pnpm vitest run src/components/design/design-canvas-host.test.tsx src/i18n/messages.test.ts`

预期：宿主导航交互和消息结构测试全部通过。

- [ ] **Step 7: 提交**

```powershell
git add src/components/design/design-canvas-host.tsx src/components/design/design-canvas-host.test.tsx src/i18n/messages
git commit -m "feat(DES-1A.3): 增加画布缩放平移交互"
```

### Task 4: 工作台状态接入与回归保护

**Files:**
- Modify: `src/components/design/design-workspace.tsx`
- Modify: `src/components/design/design-workspace.test.tsx`
- Modify: `src/contexts/design-workspace-context.tsx` only if viewport callback wiring needs a typed helper
- Modify: `src/lib/design/workspace-session.test.ts` only if persisted pan/zoom semantics change

**Interfaces:**
- `DesignWorkspace` 将当前 `zoom`, `panX`, `panY` 直接传给宿主，并把导航回调映射到现有 `setZoom`/`setPan`。
- Artifact 切换时通过 `artifactId` 变化让宿主清理旧视口中心并重新适配新文档；保存文档只提交 `document`，不提交 viewport。

- [ ] **Step 1: 写失败集成测试**

断言：工作台渲染 SVG viewBox；修改视口不会调用 `saveRevision`；保存 payload 不包含 `zoom`、`panX`、`panY`；切换到 prototype/run 后节点仍不可编辑但可导航；已有 workspace session 的 zoom/pan 能恢复为 UI 状态。

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm vitest run src/components/design/design-workspace.test.tsx`

预期：当前工作台仍以旧 zoom prop 渲染，无法传递 viewport。

- [ ] **Step 3: 接入宿主 viewport**

将 `zoom`、`panX`、`panY` 传入宿主；宿主首次测量或 `artifactId` 改变时使用 `documentBounds` 重新适配，保留上下文的 UI 持久化但不把中心偏移写入设计文档；把视口更新与文档更新分离。

- [ ] **Step 4: 运行设计回归测试**

运行：`pnpm vitest run src/components/design/design-workspace.test.tsx src/components/design/design-svg-canvas.test.tsx src/components/design/design-properties-panel.test.tsx`

预期：工作台、画布、属性编辑和拖拽全部通过。

- [ ] **Step 5: 提交**

```powershell
git add src/components/design/design-workspace.tsx src/components/design/design-workspace.test.tsx src/contexts/design-workspace-context.tsx src/lib/design/workspace-session.test.ts
git commit -m "feat(DES-1A.3): 将画布导航接入设计工作台"
```

### Task 5: 文档、质量门禁与阶段记录

**Files:**
- Modify: `README.md`
- Modify: `D:\工作相关\工作文件\工作资料\AI项目\docs\10-Prooflane原生AI设计工作台产品规划与分阶段路线图.md`
- Modify: `D:\工作相关\工作文件\工作资料\AI项目\docs\19-Prooflane-DES-1A七阶段实施路线图.md`
- Create: `D:\工作相关\工作文件\工作资料\AI项目\docs\22-Prooflane-DES-1A.3-基础画布导航实施记录.md`

- [ ] **Step 1: 更新产品文档**

记录 `DES-1A.3` 基础导航已交付：viewBox、滚轮锚点缩放、空格/中键平移、适配/重置和坐标稳定性；明确 CanvasKit、框选、空间索引、导出和独立窗口仍未交付。

- [ ] **Step 2: 执行最终门禁**

```powershell
pnpm vitest run --reporter=dot
pnpm eslint src/components/design src/lib/design/canvas-viewport.ts src/lib/design/canvas-viewport.test.ts
pnpm build
git diff --check
```

预期：全量测试退出码 `0`，ESLint 退出码 `0`，Next.js 静态页面全部生成，diff check 无输出。

- [ ] **Step 3: 检查提交边界**

运行 `git status --short` 和 `git diff --stat HEAD~5..HEAD`；只保留本阶段代码、测试、README 和外部规划记录，不提交 `.superpowers/brainstorm/`、构建产物或用户运行数据。

- [ ] **Step 4: 提交文档**

```powershell
git add README.md
git commit -m "docs(DES-1A.3): 记录基础画布导航交付"
```

外部 `AI项目\docs` 文档不属于该 Git 工作树，直接更新但不加入仓库提交。

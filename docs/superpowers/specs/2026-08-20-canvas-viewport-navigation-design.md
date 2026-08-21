# DES-1A.3 基础画布导航设计规格

**状态：** 待用户审阅

**目标阶段：** `DES-1A.3` 渲染与导航的第一批基础交付

**目标：** 在现有 `DES-1A.2` SVG 真实画布基础闭环上增加稳定的画布视口导航，使用户可以在不改变 DesignDocument 节点坐标的情况下平移、缩放和恢复画布视图。

## 1. 范围

### 1.1 本阶段交付

- 使用 SVG `viewBox` 作为唯一视口事实来源，不再使用 CSS `transform: scale(...)` 表达画布缩放。
- 维护临时 `CanvasViewport` 状态：可视中心、视口尺寸和缩放比例。
- 初次打开设计时根据根 Frame 自动适配画布，保证画板完整可见并保留稳定边距。
- 鼠标滚轮以光标所在文档点为锚点缩放，缩放范围限制为 `10%～800%`。
- 使用空格 + 左键拖拽平移画布；支持中键拖拽平移。
- 使用键盘 `+`、`-` 和 `0` 控制缩放与重置视图。
- 工具栏增加“适配画布”和“重置视图”图标按钮，并提供可访问名称和 Tooltip。
- 原型/运行视图保持节点只读，但允许视口缩放和平移。
- 节点拖拽、选择命中和属性编辑继续使用 DesignDocument 坐标；在不同缩放和平移状态下结果保持一致。
- 视口状态属于工作台临时状态，不写入 `DesignDocument` 或 revision；可以复用现有 `workspace-session.v1` 保存缩放和平移等 UI 状态，但不得写入设计正文。

### 1.2 明确不在本阶段

- CanvasKit 或 WebGL 正式主渲染器替换。
- 框选、多选、空间索引、视口裁剪和万级节点性能门禁。
- 标尺、网格、参考线、吸附、旋转、自动布局和约束。
- 独立画布窗口、跨窗口同步和多画布编排。
- PNG、SVG、PDF、HTML 导出。
- AI Composer 真实模型调用、设计生成和 ChangeSet 应用。

## 2. 用户流程

### 2.1 初次打开与适配

1. 工作台加载并归一化 DesignDocument。
2. 视口以根 Frame 为目标调用 `fitViewport`，计算完整画板可见的中心、宽高和缩放比例。
3. 用户可以通过工具栏“适配画布”随时恢复该视图。
4. “重置视图”恢复根 Frame 的默认中心和 `100%` 缩放，不修改设计文档。

### 2.2 缩放

1. 用户在画布上滚动滚轮。
2. 系统读取鼠标对应的文档坐标。
3. 系统限制新缩放值到 `0.1～8`，并调整视口中心，使鼠标锚点下的文档点保持不变。
4. 工具栏百分比实时更新。
5. `+` / `-` 以当前视口中心缩放；`0` 执行重置视图。

### 2.3 平移

1. 用户按住空格并拖拽，或使用鼠标中键拖拽。
2. 系统按屏幕像素与当前缩放比例换算文档位移。
3. 视口中心随指针移动，DesignDocument 节点不发生变化。
4. 松开指针或取消拖拽后停止平移。

### 2.4 节点编辑回归

节点拖拽仍将客户端坐标转换为文档坐标，计算公式同时考虑 `viewBox`、SVG 元素边界和当前缩放。100%、200% 缩放以及任意平移后，节点最终位置与直接在文档坐标中移动相同。

## 3. 数据模型与纯函数

新增 `src/lib/design/canvas-viewport.ts`，定义：

```ts
interface CanvasViewport {
  centerX: number
  centerY: number
  width: number
  height: number
  zoom: number
}

const MIN_CANVAS_ZOOM = 0.1
const MAX_CANVAS_ZOOM = 8

function clampZoom(zoom: number): number
function zoomAroundPoint(
  viewport: CanvasViewport,
  nextZoom: number,
  anchor: { x: number; y: number }
): CanvasViewport
function panViewport(
  viewport: CanvasViewport,
  delta: { x: number; y: number }
): CanvasViewport
function fitViewport(
  bounds: { x: number; y: number; width: number; height: number },
  host: { width: number; height: number },
  padding: number
): CanvasViewport
function clientPointToDocument(
  client: { x: number; y: number },
  hostRect: { left: number; top: number; width: number; height: number },
  viewport: CanvasViewport
): { x: number; y: number }
```

`zoomAroundPoint`、`panViewport`、`fitViewport` 和 `clientPointToDocument` 必须是纯函数，不能读写 DOM 或 React 状态。`width` 和 `height` 表示当前缩放下的文档可视范围，并且始终保持宿主宽高比；缩放改变可视范围，不改变节点 bounds。

## 4. 组件边界

- `DesignWorkspace`：持有设计文档和选中状态；只在 Artifact 切换或文档尺寸改变时请求初始适配，不保存视口到 revision。
- `DesignCanvasHost`：持有 `CanvasViewport`，通过 `ResizeObserver` 获取宿主真实尺寸，处理滚轮、空格/中键平移、键盘快捷键和工具栏按钮。首次获得非零尺寸时执行自动适配；后续容器变化保持当前中心和缩放，只调整可视范围的宽高比。
- `DesignSvgCanvas`：接收 `viewport`，使用 `viewBox` 渲染；节点命中转换复用同一视口计算，不再通过 CSS scale。
- `canvas-viewport.ts`：提供可测试的坐标和视口计算函数。

视口拖拽期间只更新本地 React 状态，不触发 `applyCommand`、保存或节点重渲染命令。

## 5. 错误与可访问性

- 非有限尺寸、负 host 尺寸或非法缩放值使用安全默认值，不让 `viewBox` 产生 `NaN` 或负尺寸。
- 平移不设置硬边界，允许用户查看画板外区域；适配视图始终可以返回根 Frame。
- 导航按钮必须具有 `aria-label`；视口状态通过可读百分比文本同步。
- 画布键盘快捷键只在画布或其子节点聚焦时生效，不拦截输入框、属性面板和 Composer 的 `+`、`-`、`0` 文本输入。
- 遵循系统减少动态效果设置；本阶段不增加动画，仅更新静态视口。

## 6. 测试验收

- `canvas-viewport.test.ts`：覆盖缩放上下限、锚点不漂移、平移换算、适配画布和非法输入安全默认值。
- `design-svg-canvas.test.tsx`：覆盖 viewBox 导航、节点在平移/缩放后命中和拖拽坐标一致性。
- `design-canvas-host.test.tsx`：覆盖滚轮、中键/空格平移、键盘快捷键、适配和重置按钮。
- 运行全量 Vitest、设计专项 ESLint、`pnpm build` 和 `git diff --check`。

## 7. 退出门槛

用户可以在桌面工作台中稳定缩放、平移和恢复视图；节点选择和拖拽在不同视口状态下不产生坐标漂移；所有导航状态不会污染设计文档或 revision；自动化测试和生产构建通过。

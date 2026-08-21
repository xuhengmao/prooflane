# DES-1A.3 选择集与框选基础设计规格

**状态：** 待实施

**目标阶段：** `DES-1A.3` 渲染与导航的选择增强子阶段

**目标：** 在现有单节点选择基础上增加临时选择集、修饰键多选和文档坐标框选，为后续专业命中测试与空间索引保留稳定接口。

## 1. 范围

### 1.1 本阶段交付

- 工作台选择状态从单个 `selectedNodeId` 扩展为 `selectedNodeIds: string[]`。
- 普通点击节点替换选择集。
- `Shift`、`Ctrl` 或 `Cmd` 点击节点追加/移除该节点。
- 在空白画布拖拽绘制选择框，结束时选择与框相交的可见、未锁定节点。
- 选择框随当前 SVG `viewBox` 绘制，缩放和平移后仍按文档坐标命中。
- Escape 清空选择；点击空白清空选择。
- 锁定、隐藏、document、page 节点永远不进入选择集。
- 多选时显示统一选择包围框和“已选择 N 个”属性面板状态；本阶段不提供批量属性修改。
- 节点拖拽仍只允许单节点，多选节点不可拖拽，避免引入批量移动命令。
- 选择集、框选矩形和多选轮廓只存在于工作台临时状态，不写入 DesignDocument、revision 或 localStorage。
- 新增纯函数 `selectableNodes`、`rectIntersectsBounds` 和 `hitTestSelectionRect`，后续可以替换其内部实现为空间索引。

### 1.2 明确不在本阶段

- 批量移动、批量属性编辑、编组和对齐分布。
- 旋转控制点、缩放控制点、节点层级重排。
- CanvasKit/WebGL 替换、空间索引实际实现和万级节点性能门禁。
- 独立画布窗口、导出、AI Composer、组件、变量和原型执行。

## 2. 交互规则

1. 普通点击可编辑节点：`[id]`。
2. 修饰键点击可编辑节点：不存在则追加，已存在则移除；空集合不会产生空选择框。
3. 点击空白：清空选择；修饰键点击空白不改变当前选择集。
4. 空白左键拖拽超过 3 个文档像素后进入框选，拖拽过程显示半透明绿色矩形；小于阈值视为点击空白。
5. 框选使用矩形相交规则，节点任一部分进入框内即命中；不可选择节点过滤在命中函数内部完成。
6. 选中单节点时沿用现有单节点绿色轮廓和属性编辑器；选中多个节点时显示数量和范围摘要，不显示单节点字段。
7. prototype/run 视图可以清空或查看选择，但不能创建新选择或拖拽节点。
8. 节点拖拽只在 `selectedNodeIds.length === 1` 且按下节点就是唯一选中节点时启用。

## 3. 数据与组件边界

### 3.1 纯函数

新增 `src/lib/design/selection.ts`：

```ts
function selectableNodes(document: DesignDocument): DesignNode[]
function rectIntersectsBounds(rect: DesignBounds, bounds: DesignBounds): boolean
function hitTestSelectionRect(document: DesignDocument, rect: DesignBounds): string[]
```

函数必须纯、确定性排序，按 `document.nodes` 原始顺序返回 id；过滤 `visible === false`、`locked === true`、`document` 和 `page`。

### 3.2 工作台

- `DesignWorkspace` 持有 `selectedNodeIds`，保存和文档命令不读取该状态。
- 属性面板接收 `nodes: DesignNode[]`；0 个显示原有提示，1 个显示现有编辑器，多个显示数量和范围摘要。
- `DesignCanvasHost` 负责把选择集传给 SVG，并保持视口导航状态独立。
- `DesignSvgCanvas` 接收 `selectedNodeIds` 和 `onSelectionChange`，内部维护框选拖拽预览。

## 4. 测试验收

- `selection.test.ts`：过滤规则、边界相交、完全在外部、边界接触和确定性顺序。
- `design-svg-canvas.test.tsx`：普通点击、修饰键点击、空白清空、框选、锁定/隐藏过滤、多选轮廓、单节点拖拽回归。
- `design-properties-panel.test.tsx`：0/1/多选显示状态，多选不渲染可编辑字段。
- `design-workspace.test.tsx`：选择集变化不触发保存，保存 payload 不含选择状态，prototype/run 只读。
- 运行全量 Vitest、设计专项 ESLint、`pnpm build` 和 `git diff --check`。

## 5. 退出门槛

用户可以通过点击、修饰键和框选稳定建立选择集；选择在缩放和平移后命中一致；锁定/隐藏节点不会被选中；多选不会污染 DesignDocument 或 revision；现有单节点属性编辑和拖拽行为不回归。

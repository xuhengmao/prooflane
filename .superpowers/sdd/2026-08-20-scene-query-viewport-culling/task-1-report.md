# Task 1 报告：SceneIndex 契约与纯函数行为

## 改动文件

- `src/lib/design/scene-index.ts`：新增渲染器无关的线性 `SceneIndex` 实现。
- `src/lib/design/scene-index.test.ts`：新增契约与几何行为测试。
- `src/lib/design/selection.ts`：未修改；现有归一化矩形、边界接触规则已满足共享几何要求。
- `src/lib/design/selection.test.ts`：未修改；既有测试继续通过。

## 测试命令和结果

先按测试先行要求运行：

```powershell
pnpm vitest run src/lib/design/scene-index.test.ts --reporter=dot
```

结果：失败（模块 `./scene-index` 尚不存在），确认测试先于实现。

实现后运行：

```powershell
pnpm vitest run src/lib/design/scene-index.test.ts src/lib/design/selection.test.ts --reporter=dot
```

结果：通过，2 个测试文件、7 个测试全部通过。

目标 ESLint：

```powershell
pnpm exec eslint src/lib/design/scene-index.ts src/lib/design/scene-index.test.ts src/lib/design/selection.ts src/lib/design/selection.test.ts
```

结果：通过，无 error/warning。

## 设计取舍

- 索引只保存 `id`、节点类型、锁定标记和归一化后的 bounds，不复制或持有完整 `DesignDocument`。
- 视口查询包含所有可见且有 bounds 的可渲染节点，保持文档顺序；document/page 被排除。
- 点和矩形命中额外排除锁定节点，并将点命中结果反转为视觉层级从上到下。
- 矩形统一归一化，采用闭区间相交判断，因此支持负向矩形和边界接触。
- `dispose()` 将内部记录释放为 `undefined`，重复调用安全，释放后查询返回空数组；`revision` 在创建时捕获。

## 遗留问题

无。当前实现为线性扫描，符合本任务的渲染器无关纯函数契约；后续若需要大规模场景优化，可在不改变接口的前提下替换内部索引结构。

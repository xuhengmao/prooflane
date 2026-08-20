# Task 3 报告：固定场景性能与正确性基准

## 范围

本任务为 `SceneIndex` 建立不依赖浏览器、随机数或网络的固定网格场景基准，覆盖 `queryViewport`、`hitTestPoint` 和 `hitTestRect` 三类查询，并使用独立的线性参考实现验证返回结果。测试文件显式使用 Vitest Node 环境，不加载项目默认的 jsdom 环境。

## TDD 证据

- RED：首次运行 `scene-index.benchmark.test.ts` 时因缺少 `scene-index-fixtures` 模块失败，未执行测试用例。
- GREEN：补齐固定网格 fixture 后，6 个测试全部通过；随后通过目标 ESLint 和格式化检查。

## Fixture

- 节点规模：100、1,000、10,000。
- 布局：固定网格，节点间距为 `72 x 56`，节点尺寸为 `48 x 36`。
- 节点 ID：`node-0` 至 `node-${count - 1}`。
- 文档 revision：`grid-${count}`。
- 查询输入固定为 viewport `{ x: 0, y: 0, width: 420, height: 320 }`、点 `{ x: 24, y: 24 }` 和负向矩形 `{ x: 320, y: 240, width: -280, height: -200 }`。

## 正确性结果

三种规模下，`SceneIndex` 的三类查询结果均与测试内独立线性参考实现一致：

| 节点数 | viewport | point | rect |
| ---: | :---: | :---: | :---: |
| 100 | 通过 | 通过 | 通过 |
| 1,000 | 通过 | 通过 | 通过 |
| 10,000 | 通过 | 通过 | 通过 |

## 本次运行 timing

以下数据来自 `pnpm vitest run src/lib/design/scene-index.benchmark.test.ts --reporter=verbose`。每个规模先执行一次 warm-up，再执行 25 次组合查询，统计组合查询耗时的 median 和 P95。

| 节点数 | build | query median | query P95 |
| ---: | ---: | ---: | ---: |
| 100 | 0.010 ms | 0.004 ms | 0.009 ms |
| 1,000 | 0.035 ms | 0.021 ms | 0.028 ms |
| 10,000 | 0.240 ms | 0.178 ms | 0.182 ms |

10,000 节点 P95 未超过 16 ms，因此没有触发性能 warning。该阈值只作为提示，不作为跨机器的 flaky 硬失败条件；查询结果一致性是硬门槛。

## 验证命令

```powershell
pnpm vitest run src/lib/design/scene-index.benchmark.test.ts --reporter=verbose
pnpm eslint src/lib/design/scene-index-fixtures.ts src/lib/design/scene-index.benchmark.test.ts
```

## 遗留边界

第一版仍使用确定性的线性扫描，当前基准用于建立正确性和性能基线，不代表最终空间索引方案。CanvasKit/WebGL 主渲染器、R-tree/四叉树替换、Worker 渲染和导出能力不在本任务范围内。

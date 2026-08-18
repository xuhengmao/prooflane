# DES-0 许可证与供应链审查

## 范围

本审查覆盖 DES-0 新增的 Playwright、CanvasKit WASM 依赖和验证 fixture 使用的字体来源。

## 结论

- `@playwright/test` 和 `canvaskit-wasm` 已列入自动审查清单，发布前必须核对上游 LICENSE 和版本来源。
- fixture 只使用系统字体，不复制未授权字体文件。
- 依赖状态为 `review_required` 时不代表自动通过；最终 Go/No-Go 必须保留人工核对记录。

机器可读结果：`docs/design/des-0-license-audit.json`。

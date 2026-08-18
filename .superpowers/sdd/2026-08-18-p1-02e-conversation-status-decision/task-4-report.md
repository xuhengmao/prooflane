# Task 4 报告

## RED

- `cargo test --features test-utils parse_questions_accepts_free_text_but_rejects_one_option` 先暴露了测试本身的类型推断问题，修正断言后继续验证。
- `cargo test --no-default-features --features test-utils --lib parse_questions` 在旧实现下会把 `options: []` 拒掉。
- `cargo test --lib --no-default-features ask_user_question_schema_supports_structured_decisions_and_free_text` 在旧实现下会因为公开描述和 `options` schema 不符合要求而失败。

## GREEN

- `src-tauri/src/acp/question.rs`
  - `parse_questions` 现在接受 `options: []`，并拒绝 `1` 项与 `>4` 项。
  - `validate_specs` 现在和 `parse_questions` 对齐，手工 typed specs 也必须是 `0` 或 `2..=4`。
  - 新增解析边界测试和 typed spec 边界测试。
- `src-tauri/src/acp/delegation/tool_schema.json`
  - `ask_user_question` 描述改成明确的调用边界。
  - `options` 改成 `anyOf`：`maxItems: 0` 或 `minItems: 2 / maxItems: 4`。
- `src-tauri/src/acp/delegation/companion.rs`
  - 补充了 schema/边界注释。
  - 新增公开 `tools/list` schema 测试，覆盖描述与 `anyOf` 结构。

## 自审

- 公开 MCP 侧现在和 Rust 解析层一致：0 项是自由输入，1 项被拒绝，2..=4 项是结构化选项。
- `declined: true` 和现有题卡渲染链路没有改动。
- 没有触碰前端、README 或 `.superpowers/brainstorm`。

## 验证

- `cargo test --no-default-features --features test-utils --lib parse_questions`
- `cargo test --no-default-features --features test-utils --lib validate_specs`
- `cargo test --lib --no-default-features ask_user_question`
- `cargo check --no-default-features --bin codeg-mcp`

## 顾虑

- `cargo fmt --all -- --check` 失败，且失败点主要来自仓库里大量与本任务无关的既有格式差异；我没有为了通过它去改动无关文件。
- 默认特征下的某些测试二进制在这台 Windows 环境里曾出现 `STATUS_ENTRYPOINT_NOT_FOUND` / 页面文件压力问题，所以我把验证缩窄到真实的 no-default lib 目标。

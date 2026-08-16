# Prooflane 会话接力实机验收缺陷实施计划

## 目标

修复长标题横向滚动、内部协议式预览、右键继续静默失败及历史上下文接续不明确的问题，并生成新的 Windows NSIS 验收包。

## 步骤 1：选择器布局与单次选择

涉及文件：

- `src/components/conversations/relay/relay-conversation-picker.tsx`
- `src/components/conversations/relay/relay-conversation-picker.test.tsx`
- `src/components/conversations/relay/relay-dialog-controller.tsx`
- `src/components/conversations/relay/relay-dialog-controller.test.tsx`

先增加失败测试，要求长标题节点和列表具有最小宽度、截断、完整悬停文本与横向隐藏约束，并要求预览处理中不能再次触发来源选择。确认测试因现有行为失败后，增加 `busy` 状态和最小 CSS 约束。

## 步骤 2：结构化对话预览

涉及文件：

- `src/components/conversations/relay/relay-preview-drawer.tsx`
- `src/components/conversations/relay/relay-preview-drawer.test.tsx`
- `src/components/conversations/relay/relay-dialog-controller.tsx`

先创建快照夹具，断言“你 / AI”、摘要分组、工具折叠、文件、范围与 Token 预算可见，同时断言内部 `canonicalContext` 和 XML 标记不可见。确认 RED 后，以结构化快照字段渲染底部抽屉，不解析规范化字符串。

## 步骤 3：右键接力可靠状态链路

涉及文件：

- `src/components/conversations/sidebar-conversation-card.tsx`
- `src/components/conversations/sidebar-conversation-card.test.tsx`
- `src/components/conversations/sidebar-conversation-list.tsx`
- `src/lib/conversation-relay.ts`
- `src/lib/conversation-relay.test.ts`
- `src/components/conversations/conversation-detail-panel.tsx`
- `src/components/conversations/relay/relay-entry-status.tsx`
- `src/components/conversations/relay/relay-entry-status.test.tsx`

先增加失败测试，要求右键回调同时携带来源 ID 与行内文件夹 ID，主列表缺失时使用回退文件夹，并覆盖加载、失败、重试展示。实现时保留全局列表最新值优先级，以行内值解决子会话和延迟加载会话静默返回；自动预览使用 generation 防止旧请求覆盖新状态。

## 步骤 4：来源刷新与发送恢复

涉及文件：

- `src/hooks/use-relay-draft.ts`
- `src/hooks/use-relay-draft.test.tsx`
- `src/components/conversations/relay/relay-context-card.tsx`
- `src/components/conversations/relay/relay-context-card.test.tsx`

先增加失败测试，要求事件中的 `relay_rounds_changed` 保留为本地无效原因，并要求“刷新接力内容”通过新的 preview 替换旧快照。实现 `refresh` 方法和卡片操作，不能复用会因指纹变化而失败的 update 请求。

## 步骤 5：模型语义与隐藏标记清理

涉及文件：

- `src-tauri/src/conversation_relay/normalizer.rs`
- `src-tauri/src/conversation_relay/context.rs`
- `src-tauri/src/parsers/codex.rs`
- 相关 Rust 单元测试

先增加失败测试，要求规范化上下文包含固定接续语义；精确签名的接力前缀与当前用户文本合并时只移除前缀；Codex 标题使用真实用户文本。实现可验证的接力信封拆分，不对签名不匹配的普通文本做清理。

## 步骤 6：验证与交付

依次执行定向前端测试、定向 Rust 测试、前端全量测试、ESLint、生产构建、桌面核心 Rust 测试、双模式 `cargo check` 与严格 Clippy。不得运行会改写全仓的 `cargo fmt`；只对触及的 Rust 文件执行检查或定向格式化。最后构建带 updater 签名的 NSIS，验证 `.sig`、记录大小与 SHA-256，并提供实机复测步骤。

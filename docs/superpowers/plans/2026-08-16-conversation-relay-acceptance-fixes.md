# Prooflane 会话接力实机验收缺陷实施计划

## 实施状态（2026-08-17）

本计划的代码修复项、本地最终门禁和新签名 NSIS 打包均已完成。已完成内容：

- 选择器为长标题和元信息提供安全的宽度、截断与悬停全文，并在生成预览时阻止重复选择。
- 预览改为结构化、可读的对话视图，不显示内部协议、`canonicalContext` 或原始快照 JSON。
- 右键继续具备来源文件夹回退、加载、失败和重试状态；来源刷新使用新快照，并对前端并发与后端替换执行保护。
- 通用接力加载、草稿恢复、入口准备和无效卡片使用同一发送门禁；除非用户明确移除接力，否则不会静默降级为普通发送。
- 模型、预算、来源变化及 `uncertain` 发送结果会持久化为可恢复的无效状态；首次预算超限仍保留可调整范围的卡片，失败后完整恢复附件草稿。
- 启动时把中断的 `claimed` 尝试恢复为 `relay_send_uncertain`，保留全部数据库授权的隐藏上下文清理锚点且不自动重发；多窗口 CAS 冲突后前端重载数据库当前接力包。
- 初次预览、拖入预览、草稿恢复和右键入口错误持续阻止首次普通发送，并提供重试、移除或重新准备来源；范围编辑器在数据库包重载后同步当前值。
- 能力关闭、来源失效等 claim 前确定未派发的失败会按 pack 绑定执行 `InProgress -> Cancelled` CAS 回滚，但已有 `claimed`、`uncertain` 或 `consumed` 证据时不取消真实轮次；Codex 扫描和同步导入只通过数据库授权详情投影真实标题。
- 删除后撤销与重新准备接力会保持目标会话绑定。

2026-08-17 新验收包已完成 updater 公钥验签和 SHA-256 校验，并归档到 `D:\工作相关\工作文件\工作资料\AI项目\Prooflane测试包\Prooflane_0.24.1-rc.1_P1-02C_x64-setup.exe`。用户已确认长标题选择、结构化预览、右键继续、历史上下文实际使用和重启恢复等核心 Windows 实机路径通过；当前仅剩 PR 审查、跨平台 CI 和合并。不在本计划中扩展长期记忆、自动学习能力或 AI 原生设计工作台。

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

## 步骤 6：状态机与并发恢复加固

涉及文件：

- `src/hooks/use-relay-draft.ts`
- `src/components/conversations/relay-send-attempt.ts`
- `src-tauri/src/conversation_relay/context.rs`
- `src-tauri/src/db/service/relay_context_pack_service.rs`
- `src-tauri/src/db/migration/m20260816_000001_relay_uncertain_anchor.rs`
- 前后端相关测试

独立审查发送门禁、预算恢复、崩溃窗口、隐藏正文清理和多窗口并发。以失败测试复现每个问题：所有未就绪接力阻止发送；预算超限持久化为可缩小范围的无效包；遗留 `claimed` 启动后转为 `uncertain`；不同用户轮次中的多个数据库授权标记均被清理；范围更新发生 CAS 冲突后重载当前包；claim 前确定未派发的目标状态安全回滚；扫描和同步导入不传播 Codex 原始协议标题。

## 步骤 7：验证与交付

依次执行定向前端测试、定向 Rust 测试、前端全量测试、ESLint、生产构建、桌面核心 Rust 测试、双模式 `cargo check` 与严格 Clippy。不得运行会改写全仓的 `cargo fmt`；只对触及的 Rust 文件执行检查或定向格式化。最后构建带 updater 签名的 NSIS，验证 `.sig`、记录大小与 SHA-256，并提供实机复测步骤。

2026-08-17 交付结果：前端全量测试、ESLint、生产构建、桌面与无默认特性服务端的测试、`cargo check` 和严格 Clippy 均通过；触及文件的定向格式检查与 `git diff --check` 通过。新包大小为 `56,327,702` 字节，SHA-256 为 `F4C54C0F660EF67DDEB3E95DFD99E3E085436E40BA715E614F5D3490CBC82733`，项目内 `prooflane-verify-release` 验签通过。Windows Authenticode 状态仍为 `NotSigned`，只作为内部测试包，公开稳定分发前仍需代码签名证书。

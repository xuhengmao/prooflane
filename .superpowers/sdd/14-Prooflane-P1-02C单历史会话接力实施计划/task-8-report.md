# Task 8 实施报告

提交 SHA：`f8c49aa7`

## 改动摘要

- 新增确定性隐藏接力上下文块、标记哈希校验与展示投影剥离。
- 首次普通/Chat 会话创建使用同一 SeaORM 事务完成会话、Chat 文件夹与接力绑定。
- ACP 发送增加接力 claim、固定轮次重校验、隐藏块注入、明确本地失败释放及不确定态持久化；同一消息 ID 的重复请求不会再次入队。
- 前端仅对有接力的新会话透传 `relayId` 和 `targetDraftId`，绑定成功后清理输入区本地接力卡片；普通发送保持原参数。
- 来源会话软删除后使未消费接力包失效，已消费包不受影响。

## RED/GREEN 证据

1. `first_create_and_relay_bind_are_atomic` 与隐藏上下文测试：
   - RED：`cargo test --features test-utils --test conversation_relay first_create_and_relay_bind_are_atomic`
   - 结果：失败，缺少 `conversation_relay::context`、`RelayBindingInput` 与 `create_conversation_with_relay_core`。
   - GREEN：同一命令在实现后通过，1/1。
2. `hidden_context_round_trips_without_changing_user_blocks`：
   - RED：同一首次 RED 编译中因缺少 context 模块而失败。
   - GREEN：`cargo test --features test-utils --test conversation_relay hidden_context_round_trips_without_changing_user_blocks`，1/1 通过。
3. 前端发送失败回归：
   - 任务指定命令在实现前执行时已通过现有覆盖；扩展接口后复跑，确认失败恢复与普通发送未回归。

## 验证

- `pnpm test -- src/hooks/use-connection-lifecycle.send-failure.test.ts src/contexts/acp-connections-context.test.tsx src/components/conversations/conversation-detail-panel-layout.test.ts`：3 文件、82 测试通过。
- `cargo check --features test-utils`：通过。
- `cargo test --features test-utils --test conversation_relay`：32 测试通过。
- `cargo test --features test-utils commands::conversations`：链接阶段超过 180 秒超时，未取得结果。
- `pnpm exec tsc --noEmit`：仅有既有基线错误 `src/lib/release-secrets.test.ts:27` 与 `src/lib/release-version.test.ts:25`。
- `pnpm exec prettier --check ...`（5 个触及前端文件）：通过。
- `rustfmt --check --edition 2021`（触及 Rust 文件）：失败；当前 rustfmt 对既有大型文件输出大量基线格式差异，未做全文件重写以避免无关 churn。
- `git diff --check`：通过。

## 自审

- ACP manager 的 UI 预览与跨客户端 `UserMessage` 均使用带期望标记的剥离结果，wire blocks 保持完整传给 ACP。
- `send_prompt_linked_with_message_id` 的成功只表示本地队列接收；本轮已改为等待连接循环的 ACP RPC 回执后才写 `consumed`，不确定结果写 `uncertain`，本地明确失败释放 claim。
- 同一 `client_message_id` 的已 claim 请求仍不再次发送；已 consumed 的同 ID 重试返回幂等成功。

## 剩余顾虑

- `commands::conversations` 定向测试受 Windows 测试二进制链接耗时影响超时；其余编译和相关集成测试通过。

## 审查修复追加

- `ConnectionCommand::Prompt` 现在分别携带完整 ACP wire blocks 与经 marker 验证的 `persisted_blocks`。转录、prompt ledger 和 Cursor prompt hash 仅使用后者；ACP `session/prompt` 仍接收完整隐藏上下文。
- 接力发送等待连接循环的 `session/prompt` RPC 结果：明确响应后原子 `mark_consumed` 并写不可变 snapshot；RPC 传输失败、取消或回执丢失写 `uncertain` 并返回 `relay_send_uncertain`；入队前确定性拒绝释放 claim。已 consumed 且同 client message ID 的重试返回幂等成功。
- 消费前重新读取当前模型窗口、重算带 15% 余量的预算；窗口变化返回 `relay_model_changed`，超预算返回 `relay_budget_exceeded`。malformed snapshot、目标不匹配、来源/轮次变化均走显式 release 路径。
- 普通 prompt 恢复原 `TurnInProgress` 错误码映射，且普通 API payload 不包含 relay 字段。创建接口统一拒绝单边 relay 绑定字段。
- 删除会话与实际待失效 relay 包在同一事务内读取、失效和提交；提交后按实际集合广播 `conversation-relay://changed`，错误码固定为 `relay_source_not_found`。
- 前端仅在明确成功回调后清草稿和 relay 卡片；relay busy/失败不会进入自动队列，失败时恢复乐观消息前的草稿并重挂载当前 composer，使文字立即可见。

## 本轮验证

- RED：`cargo test --features test-utils --test conversation_relay relay_binding_rejects_single_sided_request_fields` 初次构建失败，原因是 `relay_binding_from_parts` 尚不存在。
- GREEN 尝试：同一命令完成链接后测试二进制以 Windows `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)` 异常退出，未能获得运行期断言结果。
- `CARGO_INCREMENTAL=0 cargo check --features test-utils`：通过。
- `CARGO_INCREMENTAL=0 cargo check --no-default-features`：通过。
- `pnpm exec vitest run src/hooks/use-connection-lifecycle.test.ts src/hooks/use-connection-lifecycle.send-failure.test.ts src/lib/api-popup-windows.test.ts`：3 文件、21 测试通过。
- `pnpm exec tsc --noEmit`：仍仅有既有基线错误 `src/lib/release-secrets.test.ts:27`、`src/lib/release-version.test.ts:25`。
- `git diff --check`：通过。
- `rustfmt --check --edition 2021`（触及 Rust 文件）：受既有全文件格式差异影响失败，未进行无关格式化。

## 修复轮次 1

### RED/GREEN

1. 面板 relay ACP 失败恢复：在既有 `conversation-detail-panel-layout.test.ts` 的结构契约套件中新增失败 callback 覆盖，断言清除 `relaySendPending`、使用当前会话草稿 key 保存输入、递增 `composerRestoreNonce`，并且 callback 不调用 `clearRelayRef.current()`；GREEN：对应 Vitest 通过。
2. 精确模型持久化：新增 SQLite migration 与 `migration_adds_the_preview_target_model_identity`、`relay_draft_persists_the_exact_preview_model_identity`；GREEN：真实 `conversation_relay` 测试二进制通过。
3. 同窗口模型切换：新增 `relay_model_identity_detects_a_switch_even_when_context_windows_match`，验证相同 context window 的 `gpt-4o` / `gpt-4o-mini` 仍返回 `relay_model_changed`；GREEN：ACP 定向测试通过。

### 验证

- Windows 测试环境初次出现 `STATUS_ENTRYPOINT_NOT_FOUND` 后，按 Common Controls v6 方案对生成的测试二进制嵌入 manifest；恢复后真实执行 `conversation_relay` 全量测试通过。
- `conversation_relay-f0b3d9e682e05d98.exe`：42/42 通过。
- `codeg_lib-1fdf2072ec4f359d.exe`：`commands::acp::tests::relay_model_identity_detects_a_switch_even_when_context_windows_match`、两个 `relay_outcome_finalizer_*`，3/3 通过。
- `pnpm exec vitest run src/components/conversations/conversation-detail-panel-layout.test.ts src/hooks/use-connection-lifecycle.send-failure.test.ts src/lib/acp-prompt.test.ts`：3 文件、41 测试通过。
- `CARGO_INCREMENTAL=0 cargo check --features test-utils`：通过。
- 本轮触及 Rust 文件逐个执行 `rustfmt --edition 2021 <file>`：通过。

### 控制端交叉复核修复

- 根因：首次接力发送失败后，正式会话已经创建并绑定接力包；用户手动重试会进入 `persistedId` 分支，但该分支未继续透传 `relayId` / `targetDraftId`，会退化为普通发送，并使接力按钮保持禁用。
- RED：新增 `retries a bound relay from the persisted conversation path` 后，`conversation-detail-panel-layout.test.ts` 为 32/33，通过项中仅该测试因既有会话分支缺少 relay 参数而失败。
- GREEN：既有会话分支在存在 `relayBindingForAttempt` 时继续发送接力元数据，并在明确成功后清除该会话恢复草稿、解除 pending 和清理卡片；定向 Vitest 3 文件 42/42 通过。
- 格式检查：两个前端文件通过 Prettier；`git diff --check` 通过。另还原了逐文件 `rustfmt` 递归误触的两个历史迁移文件。

## 修复轮次 2

### RED/GREEN

1. `relay_send_core_claims_splits_wire_content_and_persists_the_actor_outcome`：
   - RED：旧夹具只创建数据库来源会话且没有真实历史，直接运行测试二进制时在入队前返回 `relay_rounds_changed`。
   - GREEN：夹具改为唯一 `AgentType::Custom("relay-core-test-...")`，使用 `acp_transcript::record_header` / `record_entry` 写入 ACP-native transcript，更新来源 `external_id`，再通过 `get_folder_conversation_core` 和 `normalize_relay_rounds` 构建真实 scope、snapshot 与 fingerprint。定向测试通过，且 fixture 的 `Drop` 清理专属 transcript 目录。
2. `relay_send_core_releases_claim_and_cancels_target_when_actor_rejects_model_change`：新增真实 core 回归用例，向连接 actor 发送 `Rejected(ModelChanged)`，验证 claim 清空并恢复 `attached`、错误码为 `relay_model_changed`、目标会话状态回滚为 `Cancelled`。该用例在已有 actor 修复上直接通过。

### 验证

- Windows 测试二进制初次直接启动无测试输出并以退出码 `1` 结束；为生成的 executable 嵌入 Common Controls v6 manifest 后执行真实断言。
- `conversation_relay-f0b3d9e682e05d98.exe --nocapture`：45/45 通过。
- `codeg_lib-d4c17b9a89e6b336.exe relay_preflight`：2/2 通过。
- `codeg_lib-d4c17b9a89e6b336.exe relay_outcome_finalizer`：2/2 通过。
- `codeg_lib-d4c17b9a89e6b336.exe relay_model_identity_detects`：1/1 通过。
- `pnpm exec vitest run src/components/conversations/conversation-detail-panel-layout.test.ts src/components/conversations/relay-send-attempt.test.ts src/hooks/use-connection-lifecycle.send-failure.test.ts src/lib/acp-prompt.test.ts`：4 文件、41 测试通过。
- `CARGO_INCREMENTAL=0 cargo check --features test-utils`：通过。

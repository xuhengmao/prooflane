# 任务 5 恢复报告

## 架构与 API

- `conversation_relay::service` 是唯一业务入口；Tauri command、Axum POST 命令别名和规范 REST handler 均调用同一组 `_core`。
- 已覆盖 capabilities 读写、preview、按稳定 draft id 恢复、patch、soft remove 和 consumed provenance 读取。未注册 `consume` DTO、handler 或路由，保留给任务 8 的真实发送原子接入。
- 前端 `conversation-relay.ts` 通过现有 `Transport.call()` 发出 camelCase 参数，并从 `api.ts` 重新导出。

## 原子性与预算

- preview/patch 先完成启用状态、来源、scope、摘要、快照、序列化和预算校验，最后才调用 `create_or_replace_draft`；失败不会写入空包或覆盖有效 draft。
- 仅 `summary` scope 创建 `CodexRelaySummarizer`；recent/custom scope 不启动 runner。
- 模型窗口仅经后端 `infer_context_window_max_tokens(target_model)` 推断，安全转为 `Option<u32>`；未知或溢出为 `None`，预算回退 4,000，且上限 12,000。

## RED/GREEN 证据

- RED：原代理日志第 12357-12378 行显示前端 `conversation-relay.test.ts` 的 6 项测试因 `getConversationCapabilities is not a function` 失败；第 16717-16724 行显示 Rust 因 `conversation_relay::service` 不存在而 `E0432`。
- GREEN：本次 `pnpm test -- src/lib/conversation-relay.test.ts src/lib/api-custom-agent-patch.test.ts` 为 2 文件 11 通过；`api_integration conversation_relay` 为 3 通过；`conversation_relay` 为 19 通过。

## 最终验证

- `cargo check --no-default-features --bin codeg-server`：通过。
- `cargo clippy --features test-utils --test api_integration --test conversation_relay -- -D warnings`：通过。
- 前端 Prettier、ESLint：通过。
- 定向 `rustfmt --edition 2021 --check --config skip_children=true`：通过。
- `git diff --check 5d24fcb1feeda2c5242cd2a42bb92d761f9de961`：通过。
- 初次 Axum 用例启动命中 Windows `0xc0000139`；仅在忽略的 `src-tauri/target/` 内用既有 Common Controls v6 清单嵌入测试二进制，重跑后 3 项通过。

## 路径范围与自审

- 工作区仅包含裁定允许的 14 条源码/测试路径：brief 中 13 条加 `src-tauri/src/conversation_relay/mod.rs`。
- 已检查普通列表不产生 relay 记录、普通详情未接入 relay 路径；preview 为唯一解析/摘要入口；所有路由适配共用 core；未提前实现 task 8 consume。
- 顾虑：真实 Codex runner 的外部端到端执行依赖本机可用 agent，当前以 `CodexRelaySummarizer` 调用路径和摘要失败原子性测试覆盖；本任务未也不应引入 task 8 发送集成。

## 修复轮次 1：取消、代次与 runner 失败原子性

### 修复设计

- 前端公开签名保持 `previewRelayContext(input, signal?)`；wire 层用项目已有的 LAN HTTP 兼容 `randomUUID()` 生成内部 `requestId`。AbortSignal 或 preview transport 失败时，均以同一 `requestId` 调用 `cancel_relay_preview`。
- preview transport 上限为 1 小时，覆盖多分块摘要的串行 runner 调用；用户主动取消仍立即拒绝前端 Promise 并发送精确 cancel。
- 后端注册表同时维护 `requestId -> request` 与 `targetDraftId -> latest requestId`。注册新代次时旧代次立即失效，Tauri command、Axum command alias 与规范 REST 继续汇入同一 `_core`。
- summary、recent 和 custom 在持久化前都经过同一最终提交门。事务先构造替换内容，再在注册表锁内检查精确 requestId、draft、最新代次和取消 token；越过提交门后由独立任务完成不可中断 commit，并只在成功后标记 committed。
- `RelayPreviewGuard` 覆盖正常结束与 future 被丢弃两条路径：丢弃时立即取消 token，并异步清除精确注册项，避免活动槽位永久泄漏。
- 未增加稳定错误码，取消/过期继续使用 `relay_source_unavailable`；未记录正文、摘要、用户输入或敏感数据；未实现任务 8 consume。

### RED/GREEN

- 第一组 RED：前端 7 项中 2 项失败，证明缺少内部 requestId/精确 cancel；Axum cancel route 返回 501；Rust 测试因缺少 requestId、协调入口和可控 summarizer 注入而出现 `E0432/E0560`。
- 第二组 RED：前端 8 项中 3 项失败，证明 60 秒默认 timeout 与直接 `crypto.randomUUID()` 不满足服务器/LAN 合同；修复后改用兼容 UUID、显式长调用 timeout，并在 transport 失败时发送同 requestId cancel。
- 独立复核 RED：把合法多分块 timeout 期望提升到 1 小时后，前端 8 项中 2 项按预期收到 `125000` 而失败；连续丢弃 preview future 的 Rust 用例在 request 32 后因 32 个槽位泄漏而失败。实现最小修复后，前端 8/8、future-drop 聚焦用例 1/1 均 GREEN。
- runner 失败覆盖通过真实 `summarize_with_runner(&FailingRunner, rounds)` 映射 `RestrictedCodexError::Failed`；断言失败后原 pack 的 ID、`snapshot_json`、status 与 active pack 均不变。

### 并发与取消不变量

1. cancel 只匹配 requestId；旧 request 的迟到 cancel 不读取或取消新 request。
2. 同一 targetDraftId 只有注册表中的最新 request 可以越过提交门；旧 preview 即使后完成也只能回滚。
3. cancel 在提交线性化点前生效时，事务回滚且原活动 pack 不变；单独取消不会恢复已取消结果。
4. 提交线性化点后 commit 不可由外层 future 丢弃中断；迟到 cancel 返回 false，不会谎报已经阻止落库。
5. preview future 在任意正常提交前阶段被丢弃时，guard 立即取消 token 并释放活动槽位；累计丢弃不会耗尽全局 preview 容量。
6. 摘要、来源、scope、序列化或预算失败均发生在提交门前，不覆盖已有有效 pack。

### 最终命令与计数

- 最终提交门共 9 类命令：前端测试、Axum 集成测试、Rust 接力测试、server check、Clippy、Prettier、ESLint、定向 rustfmt、git diff check。
- 修改后最终测试计数：前端 13/13、Axum 3/3、Rust 接力 23/23，共 39 项通过；server check 与 `-D warnings` Clippy 通过。
- Prettier、ESLint、4 个本轮核心 Rust 文件的定向 rustfmt 通过；`lib.rs`、`router.rs`、`api_integration.rs` 的 rustfmt 输出仅包含基点既存无关格式差异，按范围约束未修改。
- Axum 重链后再次命中 Windows `0xc0000139`；仅重新嵌入忽略的 `src-tauri/target/` manifest，原命令重跑 3/3 通过。

## 修复轮次 2：取消先到的 tombstone 窗口

### 设计不变量

1. 前端允许 preview 运行 1 小时；后端对尚未注册的已取消 `requestId` 也必须至少保留完整窗口，不能在其内把迟到请求当作新代次。
2. 已取消的 `requestId` 无论何时抵达，都在注册后立即观察到已取消 token，不能越过提交门或替换同一 draft 的有效包。
3. tombstone 仍是有界内存：到完整允许窗口结束后由既有异步清理释放；未修改 active preview 限额、协议、数据库或任务 8 consume。

### RED/GREEN

- RED：在 `488aede0` 语义下运行 `cargo test --features test-utils --test conversation_relay cancelled_tombstone_rejects_a_late_preview_past_the_legacy_ttl`，结果 0 通过、1 失败。取消 A 后让 B 成功，虚拟推进到 3,599 秒，迟到 A 得到 `Ok(RelayContextPackView { id: 2, ... })`，触发 `unwrap_err()`，证明旧 125 秒 tombstone 已过期并替换 B。
- GREEN：将 tombstone 保留期改为 3,600 秒后，同一聚焦命令 1/1 通过；测试使用 current-thread Tokio runtime，在 A 取消与 B 成功后冻结时间并虚拟推进，不真实等待。

### 最终验证与范围

- `cargo test --features test-utils --test conversation_relay`：24/24 通过。
- `cargo test --features test-utils --test api_integration conversation_relay`：3/3 通过。重链首次命中已知 Windows `0xc0000139`，仅在忽略的 `target/` 内重新嵌入既有 Common Controls v6 manifest 后重跑。
- `cargo check --no-default-features --bin codeg-server`、严格 Clippy、定向 rustfmt check、`git diff --check 488aede096363e198d5ed2da1239a93dcc428930`：均通过。
- 本轮仅修改 `src-tauri/src/conversation_relay/service.rs` 和 `src-tauri/tests/conversation_relay.rs`；未触及 Transport、数据库 service/schema、依赖或 consume。

## 修复轮次 3：显式预约与有界注册表

### 设计不变量

1. 前端公开 API 仍为 `previewRelayContext(input, signal?)`，正式 preview 的 1 小时 timeout 保持不变；内部先用同一 `requestId/targetDraftId` 调用 `reserve_relay_preview`，预约成功后才发送正式 preview。
2. 正式 preview 只认注册表中已存在、未取消、尚未活动且与 `requestId/targetDraftId` 精确匹配的最新预约；缺失或不匹配时返回既有 `relay_source_unavailable`，绝不隐式建项。
3. 未知 `requestId` 的 cancel 固定返回 `false` 且不创建状态，因此 1,025 次未知 cancel 也不能消耗合法预约或活动 preview 容量。
4. 预约期间 signal 取消时，公开 Promise 立即以 `AbortError` 结束；独立续体继续等待底层预约，若其最终成功则发送精确 cancel 清理，且永不发送正式 preview。正式 preview 期间的 signal 或 transport 失败仍只取消同一 requestId。
5. 待认领预约最多 1,024 项，活动 preview 最多 32 项，`targetDraftId` 最多 512 字节，因此注册表的条目数和键内存都有明确上界。遗弃预约使用从预约线性化时刻计算的 30 秒绝对截止时间清理；清理后迟到正式 preview 因无预约而拒绝，不能自行重新注册。
6. 每次预约分配单调 generation，清理必须同时匹配 generation、requestId 和 targetDraftId，旧定时任务不能误删同 ID 的新预约。同一 draft 的新预约在注册表锁内成为最新代次并取消旧代次；旧活动 preview 即使迟到完成也无法通过提交门。
7. 未修改 Transport、数据库 service/schema、依赖或任务 8 consume；未增加稳定业务错误码，也未记录正文、摘要、用户输入或敏感数据。

### RED/GREEN

- 边界 RED：`cargo test --features test-utils --test conversation_relay cancelled_request_cannot_reenter_after_tombstone_cleanup_boundary -- --exact` 为 0/1 通过、24 项过滤；在虚拟推进到 3,601 秒并运行清理后，迟到已取消请求返回 `Ok(RelayContextPackView { id: 2, ... })`，证明旧实现会自行注册并覆盖新草稿。
- 容量 RED：`cargo test --features test-utils --test conversation_relay unknown_cancel_storm_does_not_block_a_valid_preview -- --exact` 为 0/1 通过、24 项过滤；1,025 个未知 cancel 后合法 preview 收到 `relay_source_unavailable`，证明未知 cancel 耗尽共享 1,024 项注册表。
- 前端 RED：`pnpm test -- src/lib/conversation-relay.test.ts` 为 7/9 通过；2 项失败分别证明当前实现未先预约，以及预约阶段取消时已经发送正式 preview。
- 预约清理补充 RED：首次完整 Rust 运行是 25/26；遗弃预约用例在推进 31 秒后未观察到清理，说明旧写法在 spawned future 首次调度时才开始计时。改为预约成功时计算绝对 `Instant`、后台 `sleep_until` 后，聚焦用例 1/1 GREEN。
- 独立复审 RED：前端挂起预约取消为 8/9，通过 `still-pending` 证明公开 Promise 未立即 abort；同 ID 复用 ABA 用例为 0/1、27 项过滤，旧清理误删新预约；513 字节 draft ID 用例为 0/1、27 项过滤，证明键内存未受约束。加入后台清理续体、预约 generation 和 512 字节上限后，三个聚焦用例均 GREEN。
- 最终 GREEN：前端 2 文件 14/14、Rust 接力 28/28、Axum 接力 3/3，共 45 项通过。

### 最终命令与计数

- `pnpm test -- src/lib/conversation-relay.test.ts src/lib/api-custom-agent-patch.test.ts`：14/14 通过。
- `cargo test --features test-utils --test conversation_relay`：28/28 通过。
- `cargo test --features test-utils --test api_integration conversation_relay`：3/3 通过。
- `cargo check --no-default-features --bin codeg-server`：通过。
- `cargo clippy --features test-utils --test api_integration --test conversation_relay -- -D warnings`：通过。
- `pnpm prettier --check src/lib/conversation-relay.ts src/lib/conversation-relay.test.ts` 与定向 ESLint：通过。
- `rustfmt --edition 2021 --check --config skip_children=true` 对 `service.rs`、command、handler 和接力 Rust 测试：通过；`router.rs`、`lib.rs`、`api_integration.rs` 的全文件输出仅剩基点既存无关格式差异，本轮新增行已按 rustfmt 输出手工对齐。
- `git diff --check`：通过。
- Axum 测试重链后再次命中 Windows `0xc0000139`；仅在忽略的 `src-tauri/target/` 内重新嵌入既有 Common Controls v6 manifest，原命令重跑 3/3 通过。

### 范围与自审

- 代码和测试修改严格限于允许的 9 条接力路径，另追加本报告；未修改 Transport、数据库 service/schema、依赖和其他业务路径。
- Tauri command、Axum command alias 和共享 core 使用同一预约契约；正式 REST preview 同样不能绕过预约。
- 资源上限可解释且有自动化覆盖：未知 cancel 风暴不占容量，遗弃预约 30 秒释放，超长 draft ID 不建项，preview future 丢弃继续释放活动槽位。
- 顾虑：真实 Codex runner 的外部端到端依赖仍与前两轮相同，不属于本轮预约协调修复；本轮未发现新的正确性顾虑。

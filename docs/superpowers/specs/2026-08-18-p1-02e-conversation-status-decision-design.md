# Prooflane P1-02E 会话状态与决策交互增强设计

> 文档版本：1.0
>
> 更新日期：2026-08-18
>
> 状态：已实现，自动化验收完成；Windows NSIS 已生成，updater 签名待配置
>
> 优先级：P1，先于 `P1-03/04A`
>
> 产品基线：Prooflane `0.24.1-rc.1`，基于 Codeg `0.24.0`

## 1. 背景

现有统一运行状态条会把活动工具块的 `info.title` 直接插入状态文案。部分 Agent 把完整 PowerShell 命令或较长参数写入标题，导致输入框顶部换行、挤压和视觉错乱，也可能把不适合常驻展示的执行细节暴露在高频状态区。

现有 `usage_update` 只有上下文窗口的 `used` 和 `size`，不能代表实时输出速度。不同 Agent 对输出 Token 增量的支持不一致，必须把真实数据和估算数据明确区分，不能用字符速度冒充精确 Token 速度。

项目已经具备 `AskQuestionCard`、`PendingQuestionState`、Codex `request_user_input`、Grok 原生提问和 `codeg-mcp ask_user_question` 的完整链路，但普通会话中的 Agent 仍可能输出“请回复 A/B/C”。本阶段需要加固结构化提问触发规则，复用既有卡片，而不是再造一套问答 UI 或解析任意 Markdown。

## 2. 目标

1. 输入框状态条只显示通用工具状态，不显示工具名、命令或参数。
2. 状态条增加稳定、紧凑的实时输出速度，界面格式为 `T 96/s` 或 `T ≈96/s`。
3. 普通会话只有在缺少必要选择、无法安全继续时才显示结构化选择卡片。
4. 用户通过单选、多选或“其他”输入完成选择，再统一点击“确认”提交。
5. 原生提问与 Prooflane MCP 提问统一进入同一个状态、组件和恢复链路。
6. 保留现有工具审计、输入队列、停止、重试、重连和历史记录能力。

## 3. 非目标

- 不隐藏消息时间线中可折叠的工具调用详情。
- 不解析普通 Markdown、编号列表或任意 `A/B/C` 文本来猜测选择题。
- 不把实时速度作为计费、配额或精确总 Token 用量。
- 不新增数据库表，也不改变基础模型训练或长期记忆行为。
- 不在本阶段实现 `P1-02D`、Delivery 或原生 AI 设计工作台。
- 不为无法加载原生提问或 Prooflane MCP 的第三方自定义 Agent 伪造结构化能力。

## 4. 当前基线与复用边界

### 4.1 运行状态

- `src/components/chat/composer/composer-status.ts` 已归一化 `generating`、`tool_running`、`waiting_for_user`、`failed` 和 `stopped`。
- `src/components/chat/composer/composer-runtime-bar.tsx` 已展示 Agent、阶段、状态、耗时、文件变更和工具次数。
- `src/components/chat/message-input.tsx` 当前通过 `statusToolRunning` 把 `activeToolTitle` 拼入可见状态，是本次状态错乱的直接来源。

### 4.2 Token 数据

- `SessionUsageUpdateInfo` 当前只有 `{ used, size }`，语义是上下文占用。
- `ComposerContextUsage` 继续负责上下文比例和累计用量，不承担实时输出速度。
- 会话运行时已经保存当前 `liveMessage`，可作为可见流式正文估算输入。

### 4.3 结构化提问

- `AskQuestionCard` 已支持单选、多选、推荐项、多问题标签、确认提交、失败重试、“其他”输入和无选项自由输入。
- Rust 已支持 Codex elicitation、Grok 原生提问、通用 MCP 表单和 `codeg-mcp ask_user_question`。
- `question_id`、待回答状态、断线恢复、答案提交和只读历史卡片均可复用。

## 5. 交互设计

### 5.1 状态条

工具运行中的常规布局为：

```text
[Agent] 正在调用工具…  12.4s  [T] ≈96/s  2F +36/-8  工具 3
```

规则：

1. 可见状态固定使用“正在调用工具…”，不插入任何工具标题。
2. `activeToolTitle` 仅用于判断是否存在活动工具，不进入运行状态条 props、DOM、无障碍名称或 tooltip。
3. 状态、耗时和速度属于第一优先级；文件变更与工具次数属于第二优先级。
4. 窄窗口先压缩第二优先级统计，可合并为紧凑图标摘要；不得改变输入框宽高或覆盖操作按钮。
5. 错误状态长文本使用省略和可访问的完整说明，不让状态条被长词撑开。
6. 消息时间线中的工具卡片保持原样，用户仍可展开查看命令、输入和输出。

### 5.2 实时输出速度

可见格式：

- 真实输出增量：`T 96/s`
- 估算输出增量：`T ≈96/s`
- 尚无有效样本：`T --/s`
- 活跃运行但窗口内无新增输出：`T 0/s`

界面不显示单词 `token`。图标使用项目现有 Lucide 图标，视觉权重与耗时一致，不使用绿色徽标或独立底色。无障碍名称仍完整朗读“实时输出速度”或“估算输出速度”。

当前 ACP 基线没有跨 Agent 统一的实时输出 Token 字段，因此首版多数 Agent 预计显示带 `≈` 的估算值；只有后续适配器能够证明样本是当前 run 的可靠输出增量时，才去掉 `≈`。上下文窗口占用始终不能作为真实速度来源。

### 5.3 选择卡片

触发条件：

- AI 缺少用户偏好、授权或必要信息，无法安全继续当前任务。
- 问题存在少量离散选项，或需要用户自由补充一项信息。

不触发条件：

- 普通方案介绍、建议列表、步骤说明和可由代码或上下文推断的决定。
- 仅为了询问“是否继续”或重复确认明显默认值。

卡片行为：

1. 单选和多选都只改变本地选择，不立即提交。
2. 用户点击“确认”后一次性提交全部问题答案。
3. 每个有选项的问题由宿主自动提供“其他”输入，Agent 不重复生成“其他”选项。
4. 无明确选项的问题直接展示自由输入框。
5. 提交中锁定控件；失败后保留选择并允许重试。
6. “暂不回答”返回明确拒绝结果，不伪造成空答案。
7. 回答完成后卡片进入只读历史记录，Agent 从原阻塞点继续。

## 6. 架构设计

```text
Agent 输出/工具事件
  ├─ 原生提问：Codex request_user_input / Grok ask_user_question
  └─ Prooflane MCP：codeg-mcp ask_user_question
                    │
                    ▼
           Rust Question Normalizer
                    │ QuestionRequest
                    ▼
            PendingQuestionState
                    │
                    ▼
              AskQuestionCard
                    │ QuestionAnswer
                    ▼
       原生 responder / MCP blocking call
```

运行速度独立于上下文用量：

```text
provider output-token samples ─┐
                               ├─ LiveTokenRateSampler ── ComposerRuntimeBar
visible live text snapshots ───┘
```

### 6.1 前端职责

- `composer-status.ts`：只派生主状态，不生成包含工具标题的用户文案。
- `composer-runtime-bar.tsx`：渲染紧凑状态和速度，不读取原始工具数据。
- 新增纯计算模块 `live-token-rate.ts`：维护样本、真实/估算来源、滑动窗口和重置规则。
- 新增轻量 Hook 或运行时选择器：把当前会话的 `liveMessage` 和可用 provider 样本送入计算模块。
- `AskQuestionCard`：继续作为唯一交互组件，仅补充必要的可访问性和回归测试。

### 6.2 Rust 职责

- 保持原生提问、MCP 提问和通用 elicitation 的现有标准化边界。
- 强化 `ask_user_question` 工具说明：离散决策必须调用工具，不得要求用户回复字母；只有真正阻塞时调用。
- 对非法问题载荷返回明确错误，不广播半成品 `QuestionRequest`。
- 保持 `question_id` 幂等、阻塞调用、拒绝、断线回收和重连恢复行为。
- 只有 Agent 提供可靠的实时输出 Token 增量时才扩展可选事件字段；不得把上下文 `used` 当作输出增量。

## 7. Token 速度算法

### 7.1 数据优先级

1. 可靠的 provider 累计输出 Token 及单调时间戳。
2. 当前可见 AI 流式正文的本地估算。
3. 无有效输入时显示未就绪或零速度，不复用上一轮数据。

真实样本必须满足计数单调不减、时间单调递增且属于当前 `run_id`。计数倒退、时间无效、样本跨轮次或超过有效期时立即放弃真实模式，回退到估算。

### 7.2 估算规则

估算只读取用户可见的 AI 正文，包括 Markdown 和代码正文；排除工具输入输出、命令日志、用户消息和隐藏协议块。对累计正文计算估算总量，再取相邻样本差值，避免小流式分片反复向上取整：

```text
estimated_tokens = CJK_codepoints + ceil(non_whitespace_non_CJK_codepoints / 4)
```

该公式不承诺与任一模型 tokenizer 完全一致，所以界面必须显示 `≈`。

### 7.3 平滑与生命周期

- 样本窗口：最近 3 秒。
- 可见数值刷新：每 500ms 最多一次。
- 分母使用窗口内首尾单调时间差，输出取最接近的非负整数。
- 发送新一轮、切换会话、停止、失败、完成或 run id 变化时清空全部样本。
- 等待权限或问题时停止采样，不保留上一轮速度作为当前值。
- 计算结果必须过滤负数、`NaN`、`Infinity` 和异常大时间差。

## 8. 状态与数据流

### 8.1 工具运行

1. 现有工具块仍决定 `tool_running`。
2. `MessageInput` 选择通用本地化文案，不传入标题插值。
3. 状态条同时读取耗时、速度、文件变更和工具次数。
4. 工具结束后按现有优先级进入生成、等待、失败、停止或空闲状态。

### 8.2 用户决策

1. Agent 识别真正阻塞的决策点。
2. 支持原生协议时走原生桥；其余可加载 Prooflane MCP 的 Agent 调用 `ask_user_question`。
3. Rust 校验 1 至 4 个问题、选项数量、文本长度和稳定 ID。
4. `QuestionRequest` 进入当前连接的 `pendingAskQuestion`，运行状态变为 `waiting_for_user`。
5. 用户选择并确认，前端提交 `QuestionAnswer`。
6. 后端只解析当前 `question_id`，解除阻塞并记录只读结果卡片。
7. Agent 在同一轮调用链中继续任务。

## 9. 错误与恢复

| 场景 | 行为 |
| --- | --- |
| 工具标题超长或包含命令 | 不进入状态条；消息工具卡片仍可展开 |
| provider Token 计数倒退 | 丢弃真实样本并使用估算 |
| 流式正文被替换或缩短 | 重置当前估算窗口，不产生负速度 |
| 切换会话或新 run 开始 | 清空旧样本和定时器 |
| 问题载荷非法 | 返回结构化错误，不显示半张卡片 |
| 重复 `question_id` | 幂等复用当前待回答状态 |
| 提交失败 | 保留选择、恢复按钮、显示可重试错误 |
| 连接中断 | 恢复同一待回答问题或明确取消阻塞调用 |
| Agent 不支持两种提问通道 | 保留普通文本，不猜测转换 Markdown |

## 10. 国际化与无障碍

- 十种现有语言统一新增通用工具状态、真实/估算速度和未就绪标签。
- 可见速度不出现 `token`，无障碍文本可使用目标语言完整描述 Token/秒。
- 速度数值不设置高频 `aria-live`，主状态仍使用礼貌播报。
- 卡片支持键盘选择、Tab 顺序、焦点可见、确认和失败重试。
- reduced-motion 不影响数值更新，但关闭状态脉冲和非必要动效。
- RTL 语言保持图标、数值和 `/s` 的可读顺序。

## 11. 测试设计

### 11.1 前端单元测试

- 工具运行状态不包含原始标题、命令或参数。
- 真实样本无 `≈`，估算样本有 `≈`，可见文本不出现 `token`。
- 3 秒窗口、500ms 刷新、零速度、未就绪、重置和异常值处理。
- 中文、英文、代码和混合文本的累计估算不会因分片边界重复计数。
- 切换会话、run id 变化、停止和失败后不串值。

### 11.2 组件测试

- 状态、耗时、速度、文件变更和工具次数保持稳定层级。
- 常规与窄宽度下状态不遮挡、输入框不改变尺寸、次要统计可访问。
- 单选、多选、“其他”、纯自由输入、确认、拒绝和失败重试。
- 普通 Markdown 方案列表不会生成 `AskQuestionCard`。

### 11.3 Rust 测试

- Codex、Grok、通用 elicitation 和 MCP 输入标准化到相同问题模型。
- 非法载荷、重复问题、答案 ID 不匹配、拒绝和断线恢复。
- 工具 schema 明确要求离散阻塞决策使用卡片且不手工回复字母。
- 如果新增真实输出 Token 字段，验证缺失、倒退、跨 run 和旧客户端兼容。

### 11.4 集成与实机

- 普通会话遇到必要选择时显示卡片，确认后 Agent 继续同一任务。
- 普通建议列表仍作为正文显示。
- 深浅主题、常规/窄窗口、中文/英文和 reduced-motion 无溢出或重叠。
- 执行前端测试、ESLint、Next 构建、相关 Rust 测试、严格 Clippy 和 Windows 桌面打包。

## 12. 验收标准

1. 状态条任何情况下都不显示完整工具标题、命令或参数。
2. 消息时间线仍可展开查看工具详情。
3. 真实速度显示 `T 96/s`，估算速度显示 `T ≈96/s`，可见文本没有 `token`。
4. Token 速度不会跨会话、跨轮次或跨重连复用。
5. 状态条在窄窗口不换行错乱、不遮挡按钮、不改变输入框尺寸。
6. 必须由用户决定时，支持结构化能力的内置 Agent 显示可点击卡片。
7. 选择后必须点击“确认”才提交，用户可在提交前修改。
8. “其他”和无选项自由输入均可提交并被 Agent 正确接收。
9. 普通 Markdown 列表不被误判，消息不会要求用户手工回复 `A/B/C` 作为正常结构化路径。
10. 提交失败、断线和重连不会丢失待回答状态或用户已选内容。

## 13. 分期与周期

| 子阶段 | 单人估算 | 交付内容 | 完成门槛 |
| --- | --- | --- | --- |
| `P1-02E.1` | 0.5～1 日 | 状态条工具详情净化、布局约束、十种语言 | 定向组件测试与视觉验收通过 |
| `P1-02E.2` | 1.5～2.5 日 | 真实/估算速度采样、格式化、重置和异常保护 | 算法单测及跨会话回归通过 |
| `P1-02E.3` | 2～3 日 | 提问 schema 加固、能力路由、卡片和恢复回归 | 原生/MCP/自由输入集成测试通过 |
| `P1-02E.4` | 1～1.5 日 | 深浅主题、窄屏、全量门禁、Windows 打包和实机验收 | 全部验收项有证据 |

单人全职预计 `5～8` 个工作日。`P1-02D` 保持暂缓，不阻塞本阶段；`P1-02E` 完成并验收后进入 `P1-03/04A Delivery 任务合同 MVP`。

## 14. 文档与发布同步

- 设计阶段同步外部总体路线图、功能规格和会话状态设计。
- 实现完成后在 README 的核心会话能力中新增“结构化选择卡片”介绍，明确必要决策才触发、支持单选/多选/“其他”输入、用户确认后 Agent 从阻塞点继续；代码完成前不把规划写成现成功能。
- PR 描述必须区分真实 Token 速度和估算速度，并附窄窗口与选择卡片截图。
- 本阶段不需要数据库回滚；代码回滚后旧客户端忽略新增可选运行时字段。

## 15. 实施与验收记录（2026-08-18）

### 15.1 前端门禁

- `pnpm test`：335 个测试文件、4169 个测试全部通过。
- `pnpm lint`：退出码 0。
- `pnpm build`：退出码 0，Next.js 生成 33 个静态页面。
- `pnpm exec tsc --noEmit`：仅保留仓库既有基线错误
  `src/lib/release-secrets.test.ts:27` 和 `src/lib/release-version.test.ts:25`，本阶段未新增类型错误。
- 速度采样器新增的缩短检测回归为 12/12 通过；提交失败、结构化提问和结果卡相关回归已纳入前述全量测试。

### 15.2 Rust 门禁与 Windows 限制

- `cargo clippy --all-targets --features test-utils -- -D warnings`：通过。
- `cargo clippy --no-default-features --bin codeg-mcp -- -D warnings`：通过。
- `cargo test --lib --no-default-features ask_user_question`：4/4 通过。
- P1-02E 问题模块在临时注入 Common Controls v6 manifest 的测试副本中为 37/37 通过。
- 默认 Windows 测试二进制缺少 Common Controls v6 manifest 时会加载系统 `comctl32.dll` 5.82，触发
  `STATUS_ENTRYPOINT_NOT_FOUND`；这属于测试宿主 manifest 限制，不是问题协议断言失败。
- `cargo fmt --all -- --check` 仍报告仓库范围既有格式差异，未对未参与本阶段的文件做全仓格式化。

### 15.3 Windows NSIS 产物

使用 `pnpm tauri build --bundles nsis` 生成：

```text
src-tauri/target/release/bundle/nsis/Prooflane_0.24.1-rc.1_x64-setup.exe
```

记录：

- 构建时间：`2026-08-18 13:48:26 +08:00`
- 文件大小：`56,529,868` 字节
- SHA256：`0D4FE883667FB49A1215CBE321EB011B17CD51016F2ADE4882AD47256D6615EE`
- 文件头：`MZ`（Windows PE）

默认 `pnpm tauri build` 会在 MSI 打包阶段拒绝 `0.24.1-rc.1` 的非纯数字预发布标识，因此本阶段只生成 NSIS。NSIS 文件已经生成，但由于环境未提供 `TAURI_SIGNING_PRIVATE_KEY`，updater 签名步骤返回退出码 1；当前 `.sig` 文件不是本次构建生成的签名，不能用于发布更新。

### 15.4 证据边界

`docs/screenshots/structured-decision-card.png` 是浏览器中真实 `AskQuestionCard` 组件的实机 UI 预览，展示多选、“其他”输入和提交失败重试状态；当前环境没有完成可重复的外部第三方 Agent 阻塞会话录制。Agent 协议、问题校验、确认、失败重试和恢复链路由前端/Rust 自动化测试覆盖，安装包启动后的人工主路径复测及 updater 私钥配置仍是发布前工作。

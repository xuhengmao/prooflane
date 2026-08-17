# Prooflane P1-02E 会话状态与决策交互增强实施计划

> **面向执行 Agent：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行；所有步骤使用复选框追踪，且严格遵循 TDD。

**目标：** 在不泄露工具调用详情、不误报 Token 精度的前提下，为会话输入区增加稳定的运行状态和实时输出速度，并让真正阻塞任务的用户决策统一通过可确认、可重试的结构化选择卡片完成。

**架构：** 前端把“工具是否运行”与“工具标题”彻底分离；独立的纯计算采样器只从可靠 provider 累计输出量或当前可见 AI 正文计算 3 秒滑动速度，React Hook 负责 500ms 生命周期采样，运行状态条只负责展示。结构化提问继续复用现有 `QuestionSpec -> PendingQuestionState -> AskQuestionCard -> QuestionAnswer` 链路，只扩展 `codeg-mcp` Schema/校验对纯自由输入的支持并强化 Agent 调用边界，不解析普通 Markdown。

**技术栈：** Next.js 16、React 19、TypeScript 5.8 strict、Vitest、Testing Library、next-intl、Tailwind CSS v4、Tauri 2、Rust 2021、serde_json、Cargo。

## 全局约束

- 产品基线固定为 Prooflane `0.24.1-rc.1`，上游基线为 Codeg `0.24.0`。
- 所有功能代码、测试、README 和提交说明均使用 UTF-8；提交说明正文使用简体中文。
- 输入框状态条不得渲染工具标题、命令、参数或工具详情；消息时间线中的可折叠工具详情保持不变。
- 实时输出速度只显示 `96/s`、`≈96/s`、`--/s` 或 `0/s`；可见文本不得出现单词 `token`。
- `{ used, size }` 是上下文窗口占用，不得作为实时输出速度来源。
- 估算公式固定为 `CJK codepoints + ceil(non-whitespace non-CJK codepoints / 4)`，窗口固定为 3 秒，可见值最多每 500ms 更新一次。
- 新 run、切换会话、停止、失败、完成、等待用户或正文缩短时必须清空旧速度样本。
- 选择卡片只在 Agent 缺少必要选择或信息、无法安全继续时触发；普通建议列表和 Markdown `A/B/C` 不做猜测解析。
- 单选、多选均先本地选择，再点击“确认”一次性提交；有选项时自动提供“其他”，无选项时直接显示自由输入。
- `codeg-mcp` 的 `options` 只允许 `0` 项或 `2..=4` 项，`1` 项必须返回结构化校验错误。
- 提交失败必须保留选择并允许重试；拒绝必须返回 `declined: true`，不能伪造成空答案。
- 十种现有语言保持相同键集合；无障碍名称必须完整表达真实/估算输出速度，速度数值不得设为高频 `aria-live`。
- 实现完成前不得在 README 中把规划能力写成已交付；README 仅在全部功能和回归测试通过后更新。
- 不新增数据库表，不修改长期记忆、会话接力、Delivery 或 AI 设计工作台范围。

---

## 文件职责映射

- `src/components/chat/message-input.tsx`：选择通用运行状态文案，把会话状态和计时数据交给状态条。
- `src/components/chat/composer/composer-status.ts`：继续只归一化状态；`activeToolTitle` 仅用于判断是否处于 `tool_running`。
- `src/components/chat/composer/live-token-rate.ts`：新增纯函数和有状态采样器，负责正文提取、Token 估算、真实/估算源选择、窗口、节流与重置。
- `src/components/chat/composer/use-live-token-rate.ts`：新增 React 生命周期适配，按当前 `LiveMessage`/run 周期驱动采样器。
- `src/components/chat/composer/composer-runtime-bar.tsx`：展示紧凑主状态、耗时、输出速度和次要统计，不接触原始工具标题。
- `src/app/globals.css`：保证状态条单行、主状态可截断、次要统计可压缩且不改变输入框尺寸。
- `src/i18n/messages/*.json`、`src/i18n/messages.test.ts`：十种语言的通用工具状态和输出速度无障碍文案。
- `src-tauri/src/acp/question.rs`：允许 MCP 提问使用 0 项自由输入，同时继续拒绝 1 项伪选择和超限载荷。
- `src-tauri/src/acp/delegation/tool_schema.json`：向 Agent 明确结构化决策的触发边界、禁止手工要求回复字母，并声明 `options = 0 或 2..4`。
- `src-tauri/src/acp/delegation/companion.rs`：验证公开 Schema 和 companion 同步拒绝非法调用。
- `src/components/chat/ask-question-card.test.tsx`：证明纯自由输入、确认和失败重试不会丢失用户内容。
- `README.md`：功能完成后新增“结构化决策卡片”竞争力说明。

---

### 任务 1：净化工具运行状态并稳定单行布局

**文件：**
- 修改：`src/components/chat/message-input.tsx:893`
- 修改：`src/components/chat/message-input.test.tsx:405`
- 修改：`src/components/chat/composer/composer-runtime-bar.tsx`
- 修改：`src/components/chat/composer/composer-runtime-bar.test.tsx`
- 修改：`src/app/globals.css:2242`
- 修改：`src/i18n/messages/en.json`
- 修改：`src/i18n/messages/zh-CN.json`
- 修改：`src/i18n/messages/zh-TW.json`
- 修改：`src/i18n/messages/ja.json`
- 修改：`src/i18n/messages/ko.json`
- 修改：`src/i18n/messages/es.json`
- 修改：`src/i18n/messages/de.json`
- 修改：`src/i18n/messages/fr.json`
- 修改：`src/i18n/messages/pt.json`
- 修改：`src/i18n/messages/ar.json`
- 修改：`src/i18n/messages.test.ts:150`

**接口：**
- 消费：`resolveComposerStatus()` 仍接收 `activeToolTitle: string | null` 判断运行状态。
- 产出：`statusToolRunning` 变为无 ICU 参数的通用文案；`ComposerRuntimeBarContent` 的状态标签始终可截断，原始标题不会进入 DOM、tooltip 或无障碍名称。

- [ ] **步骤 1：先写会失败的状态净化测试**

在 `message-input.test.tsx` 的运行状态用例中使用类似命令的长标题，并断言通用文案存在、原始标题在整个状态条中不存在：

```tsx
activeToolTitle={'powershell -Command "Get-ChildItem -Recurse -Force"'}

const bar = screen.getByTestId("composer-runtime-bar")
expect(screen.getByRole("status")).toHaveTextContent(
  enMessages.Folder.chat.messageInput.statusToolRunning
)
expect(bar).not.toHaveTextContent("Get-ChildItem")
expect(screen.queryByTitle(/Get-ChildItem/)).toBeNull()
```

把 `messages.test.ts` 的占位符断言改为十种语言均不含 `{tool}`：

```ts
expect(messages.Folder.chat.messageInput.statusToolRunning).not.toContain(
  "{tool}"
)
```

- [ ] **步骤 2：运行测试并确认红灯原因正确**

运行：

```powershell
pnpm test -- src/components/chat/message-input.test.tsx src/i18n/messages.test.ts
```

预期：失败；当前状态包含 `Get-ChildItem`，且十种语言仍含 `{tool}`。

- [ ] **步骤 3：实现通用状态文案**

将 `message-input.tsx` 的工具分支改为无插值调用：

```tsx
case "tool_running":
  return t("statusToolRunning")
```

十种语言使用以下文案，不保留 `{tool}`：

| locale | `statusToolRunning` |
| --- | --- |
| en | `Calling tool...` |
| zh-CN | `正在调用工具...` |
| zh-TW | `正在呼叫工具...` |
| ja | `ツールを呼び出しています...` |
| ko | `도구를 호출하는 중...` |
| es | `Llamando a una herramienta...` |
| de | `Tool wird aufgerufen...` |
| fr | `Appel d’un outil...` |
| pt | `Chamando uma ferramenta...` |
| ar | `جارٍ استدعاء أداة...` |

- [ ] **步骤 4：添加单行、截断和次要统计布局测试**

在 `composer-runtime-bar.test.tsx` 中断言状态条不再使用 `flex-wrap`，错误长文本仍通过 `title` 完整可访问，文件和工具统计仍在 DOM：

```tsx
expect(bar).toHaveClass("min-w-0")
expect(bar).not.toHaveClass("flex-wrap")
expect(screen.getByTestId("composer-runtime-primary")).toHaveClass("min-w-0")
expect(screen.getByTestId("composer-runtime-secondary")).toHaveTextContent(
  "2F +5/-1"
)
expect(screen.getByTestId("composer-runtime-secondary")).toHaveTextContent(
  "2 tool uses"
)
```

- [ ] **步骤 5：实现稳定布局**

把状态条拆成 `composer-runtime-primary` 和 `composer-runtime-secondary` 两个同层分组；外层使用单行 `flex-nowrap`/`overflow-hidden`，状态标签使用 `truncate` 和 `title`，次要统计 `shrink-0`。在 `globals.css` 中禁止运行条换行，并使用容器查询仅压缩次要文字，不隐藏 Agent、主状态、耗时或后续速度元素。

- [ ] **步骤 6：运行定向测试并提交**

运行：

```powershell
pnpm test -- src/components/chat/message-input.test.tsx src/components/chat/composer/composer-runtime-bar.test.tsx src/i18n/messages.test.ts
```

预期：全部通过，状态条 DOM 中不存在原始工具标题。

提交：

```powershell
git add src/components/chat/message-input.tsx src/components/chat/message-input.test.tsx src/components/chat/composer/composer-runtime-bar.tsx src/components/chat/composer/composer-runtime-bar.test.tsx src/app/globals.css src/i18n/messages src/i18n/messages.test.ts
git commit -m "fix(P1-02E): 净化工具运行状态并稳定布局"
```

---

### 任务 2：实现可验证的实时输出速度采样核心

**文件：**
- 新建：`src/components/chat/composer/live-token-rate.ts`
- 新建：`src/components/chat/composer/live-token-rate.test.ts`

**接口：**
- 消费：`LiveMessage` 与 `LiveContentBlock`，只提取 `role === "assistant"` 的 `type === "text"` 正文。
- 产出：

```ts
export type LiveTokenRateSource = "provider" | "estimated"

export interface ProviderOutputTokenSample {
  runId: string
  outputTokens: number
}

export interface LiveTokenRateSnapshot {
  tokensPerSecond: number | null
  source: LiveTokenRateSource
}

export interface LiveTokenRateInput {
  active: boolean
  runId: string | null
  visibleText: string
  providerSample?: ProviderOutputTokenSample | null
  now: number
}

export function extractVisibleAssistantText(
  message: LiveMessage | null
): string

export function estimateVisibleTokens(text: string): number

export class LiveTokenRateSampler {
  update(input: LiveTokenRateInput): LiveTokenRateSnapshot
  reset(): void
}
```

- [ ] **步骤 1：写估算与正文过滤失败测试**

覆盖中文、英文、代码、空白、混合分片以及工具/思考块排除：

```ts
expect(estimateVisibleTokens("你好 world"))
  .toBe(2 + Math.ceil(5 / 4))
expect(estimateVisibleTokens("const x = 1"))
  .toBe(Math.ceil("constx=1".length / 4))
expect(
  extractVisibleAssistantText({
    id: "m1",
    role: "assistant",
    startedAt: 1,
    content: [
      { type: "text", text: "visible" },
      { type: "thinking", text: "hidden" },
    ],
  })
).toBe("visible")
expect(
  extractVisibleAssistantText({
    id: "tool-1",
    role: "tool",
    startedAt: 1,
    content: [{ type: "text", text: "tool output" }],
  })
).toBe("")
```

- [ ] **步骤 2：写窗口、来源和重置失败测试**

测试必须覆盖：3 秒窗口、500ms 发布节流、provider 真实样本、正文估算、零速度、未就绪、run 切换、active 结束、文本缩短、provider 计数倒退、`NaN`、`Infinity` 和时间倒退。真实样本期望 `source: "provider"`，正文样本期望 `source: "estimated"`。

- [ ] **步骤 3：运行测试确认模块尚不存在**

运行：

```powershell
pnpm test -- src/components/chat/composer/live-token-rate.test.ts
```

预期：失败，提示无法解析 `./live-token-rate`。

- [ ] **步骤 4：实现正文提取与累计估算**

按 Unicode code point 遍历；Han、Hiragana、Katakana、Hangul 各计 1，其他非空白字符累计后统一除以 4 并向上取整。不得逐流式分片取整，以免相同文本因分片边界得到不同结果。

- [ ] **步骤 5：实现采样器状态机**

采样器必须：

1. 优先使用同一 `runId` 下单调递增且有限的 provider 累计输出量。
2. provider 缺失、倒退或无效时回退到累计可见正文估算，并把来源标记为 `estimated`。
3. 保存最近 3 秒样本，使用首尾单调时间差计算 `round(deltaTokens / deltaSeconds)`。
4. 两个有效样本前返回 `null`；活跃但窗口内无增量返回 `0`。
5. 500ms 内可收样但不发布新数值；不得返回负数、`NaN` 或 `Infinity`。
6. run 变化、inactive、文本缩短、时间倒退或异常长间隔时清空样本。

- [ ] **步骤 6：运行测试、类型检查并提交**

运行：

```powershell
pnpm test -- src/components/chat/composer/live-token-rate.test.ts
pnpm exec tsc --noEmit
```

预期：全部通过，无未使用类型或不安全断言。

提交：

```powershell
git add src/components/chat/composer/live-token-rate.ts src/components/chat/composer/live-token-rate.test.ts
git commit -m "feat(P1-02E): 增加实时输出速度采样核心"
```

---

### 任务 3：接入 React 生命周期并展示紧凑速度

**文件：**
- 新建：`src/components/chat/composer/use-live-token-rate.ts`
- 新建：`src/components/chat/composer/use-live-token-rate.test.tsx`
- 修改：`src/components/chat/composer/composer-runtime-bar.tsx`
- 修改：`src/components/chat/composer/composer-runtime-bar.test.tsx`
- 修改：`src/app/globals.css`
- 修改：`src/i18n/messages/en.json`
- 修改：`src/i18n/messages/zh-CN.json`
- 修改：其余八个 `src/i18n/messages/*.json`
- 修改：`src/i18n/messages.test.ts`

**接口：**
- 消费：任务 2 的 `LiveTokenRateSampler`、当前会话 `liveMessage` 和 `activeRun`。
- 产出：

```ts
export interface UseLiveTokenRateInput {
  active: boolean
  liveMessage: LiveMessage | null
  providerSample?: ProviderOutputTokenSample | null
}

export function useLiveTokenRate(
  input: UseLiveTokenRateInput
): LiveTokenRateSnapshot
```

`ComposerRuntimeBarContentProps` 新增：

```ts
tokenRate: LiveTokenRateSnapshot
```

- [ ] **步骤 1：先写 Hook 生命周期失败测试**

使用 `renderHook`、`vi.useFakeTimers()` 和 `rerender()` 证明：正文增长 500ms 后显示估算速度；同一消息继续增长使用同一窗口；消息 `id/startedAt` 变化立即回到未就绪；`active=false` 清空；卸载后不存在遗留 interval。

- [ ] **步骤 2：写展示失败测试**

在状态条测试中覆盖四种可见格式，并确认没有可见单词 `token`：

```tsx
expect(rate).toHaveTextContent("≈96/s")
expect(rate).not.toHaveTextContent(/token/i)
expect(rate).toHaveAccessibleName("Estimated output speed: 96 tokens per second")
expect(rate).not.toHaveAttribute("aria-live")
```

同时测试 `{ tokensPerSecond: null, source: "estimated" }` 显示 `--/s`，真实来源显示 `96/s`，零值显示 `0/s`。

- [ ] **步骤 3：运行测试确认失败**

运行：

```powershell
pnpm test -- src/components/chat/composer/use-live-token-rate.test.tsx src/components/chat/composer/composer-runtime-bar.test.tsx
```

预期：Hook 文件不存在，状态条也没有速度元素。

- [ ] **步骤 4：实现 Hook**

Hook 以 `${liveMessage.id}:${liveMessage.startedAt}` 作为 run 标识，使用 500ms interval 让无新分片时的速度自然降到 `0/s`；每次正文变化可立即喂入采样器，但发布频率仍由采样器限制。effect 清理 interval，inactive 或没有当前 assistant run 时调用 `reset()`。

- [ ] **步骤 5：实现状态条速度元素和国际化**

使用 Lucide `Gauge` 图标，图标与可见值同层、无徽标底色：

```tsx
<span data-testid="composer-token-rate" className="inline-flex shrink-0 items-center gap-1">
  <Gauge aria-hidden="true" className="h-3 w-3" />
  <span aria-hidden="true" dir="ltr">{visibleRate}</span>
  <span className="sr-only">{accessibleRateLabel}</span>
</span>
```

新增三类无障碍文案键：`outputRatePending`、`outputRateEstimated`、`outputRateMeasured`。可见值由组件直接生成，十种语言只负责完整朗读文案，因此可见区域始终不出现 `token`。

- [ ] **步骤 6：把 Hook 接到当前会话 liveMessage**

`ComposerRuntimeBar` 已按 `conversationId` 订阅 `useConversationRuntimeStore`；在同一组件中调用 `useLiveTokenRate({ active: activeRun, liveMessage })` 并传入 `ComposerRuntimeBarContent`。首版不传 provider 样本，所以多数 Agent 显示 `≈`；接口保留可靠 provider 数据接入点，但不得读取 `session.usage`。

- [ ] **步骤 7：运行定向回归并提交**

运行：

```powershell
pnpm test -- src/components/chat/composer/live-token-rate.test.ts src/components/chat/composer/use-live-token-rate.test.tsx src/components/chat/composer/composer-runtime-bar.test.tsx src/components/chat/message-input.test.tsx src/i18n/messages.test.ts
pnpm exec tsc --noEmit
```

预期：全部通过；状态、耗时和速度保持第一优先级，文件/工具统计仍存在。

提交：

```powershell
git add src/components/chat/composer src/app/globals.css src/i18n/messages src/i18n/messages.test.ts src/components/chat/message-input.test.tsx
git commit -m "feat(P1-02E): 在会话状态条展示实时输出速度"
```

---

### 任务 4：允许结构化纯自由输入并强化 Agent 调用规则

**文件：**
- 修改：`src-tauri/src/acp/question.rs:42`
- 修改：`src-tauri/src/acp/delegation/tool_schema.json:82`
- 修改：`src-tauri/src/acp/delegation/companion.rs:2248`

**接口：**
- 消费：既有 `parse_questions(arguments: &Value)` 和 `QuestionSpec`。
- 产出：`options=[]` 形成合法纯自由输入问题；`options.len()==1` 和 `>4` 返回明确错误；公开 MCP Schema 与 Rust 校验完全一致。

- [ ] **步骤 1：先写 Rust 解析失败测试**

在 `question.rs` 中新增：

```rust
#[test]
fn parse_questions_accepts_free_text_but_rejects_one_option() {
    let free = json!({
        "questions": [{
            "question": "Which path should I use?",
            "header": "Path",
            "multiSelect": false,
            "options": []
        }]
    });
    assert!(parse_questions(&free).unwrap()[0].options.is_empty());

    let one = json!({
        "questions": [{
            "question": "Choose",
            "header": "Choice",
            "multiSelect": false,
            "options": [{"label": "Only", "description": ""}]
        }]
    });
    assert!(parse_questions(&one).unwrap_err().contains("0 or between 2 and 4"));
}
```

- [ ] **步骤 2：写公开 Schema 失败测试**

在 `companion.rs` 新增 `ask_user_question_schema_supports_structured_decisions_and_free_text`：读取 `tools/list` 返回的 `ask_user_question`，断言描述包含“不得要求用户回复 A/B/C”的英文规则，并断言 `options.anyOf` 同时包含 `maxItems: 0` 和 `minItems: 2, maxItems: 4`。

- [ ] **步骤 3：运行测试确认当前 0 项被拒绝**

运行：

```powershell
Set-Location src-tauri
cargo test --features test-utils parse_questions_accepts_free_text_but_rejects_one_option
cargo test --lib --no-default-features ask_user_question_schema_supports_structured_decisions_and_free_text
```

预期：第一条因 `MIN_OPTIONS = 2` 失败；第二条因当前 Schema 只有 `minItems: 2` 且描述未禁止手工字母回复而失败。

- [ ] **步骤 4：修改 Rust 校验**

保留 `MIN_OPTIONS = 2` 作为离散选择下限，但把条件改为：

```rust
if opts.len() == 1 || opts.len() > MAX_OPTIONS {
    return Err(format!(
        "questions[{qi}] must have either 0 or between {MIN_OPTIONS} and {MAX_OPTIONS} options"
    ));
}
```

同步更新 `QuestionSpec`、`parse_questions` 和 companion 的注释，明确 0 项是必要自由输入，1 项不是有效选择。

- [ ] **步骤 5：修改工具描述与 JSON Schema**

工具描述必须明确：

1. 仅在缺少用户决定/信息且无法安全继续时调用。
2. 离散决策必须调用工具，不得在正文中要求用户回复 `A/B/C`。
3. 无明确选项但必要的自由输入使用 `options: []`。
4. 普通建议、方案对比、是否继续和可合理默认的内容不得调用。
5. 有选项时宿主自动提供“其他”，Agent 不重复造“Other”。

`options` Schema 使用：

```json
"anyOf": [
  { "maxItems": 0 },
  { "minItems": 2, "maxItems": 4 }
]
```

- [ ] **步骤 6：运行 Rust 定向测试并提交**

运行：

```powershell
Set-Location src-tauri
cargo fmt --all -- --check
cargo test --features test-utils parse_questions
cargo test --lib --no-default-features ask_user_question
```

预期：0 项自由输入通过，1 项和超限继续失败，原有多选/拒绝/渲染测试不回归。

提交：

```powershell
git add src-tauri/src/acp/question.rs src-tauri/src/acp/delegation/tool_schema.json src-tauri/src/acp/delegation/companion.rs
git commit -m "feat(P1-02E): 加固结构化决策提问协议"
```

---

### 任务 5：加固选择卡片确认、自由输入与失败重试回归

**文件：**
- 修改：`src/components/chat/ask-question-card.test.tsx`
- 按测试结果修改：`src/components/chat/ask-question-card.tsx`

**接口：**
- 消费：0 项 `QuestionSpec`、现有 `AskQuestionCard`、`onAnswer(questionId, answer)`。
- 产出：自由输入与选项卡片遵循同一确认/重试语义；如果现有实现已满足，生产组件不做无意义重构。

- [ ] **步骤 1：写自由输入失败重试测试**

构造第一次 reject、第二次 resolve 的 `onAnswer`；输入 `D:\\workspace\\demo` 后点击确认，断言失败提示出现且输入值保留，再次确认提交完全相同的答案：

```tsx
expect(screen.getByRole("textbox")).toHaveValue("D:\\workspace\\demo")
expect(onAnswer).toHaveBeenLastCalledWith("q-free", {
  answers: [{ questionId: "free-1", labels: ["D:\\workspace\\demo"] }],
  declined: false,
})
expect(onAnswer).toHaveBeenCalledTimes(2)
```

- [ ] **步骤 2：写“选择后仍需确认”测试**

对单选和多选分别点击选项，断言点击过程中 `onAnswer` 调用次数仍为 0；只有点击确认后才一次性提交全部问题答案。

- [ ] **步骤 3：运行卡片测试**

运行：

```powershell
pnpm test -- src/components/chat/ask-question-card.test.tsx src/lib/ask-question.test.ts src/components/chat/conversation-shell.test.tsx
```

预期：新增测试若暴露状态丢失则失败；其他现有单选、多选、“其他”、拒绝、只读结果测试保持通过。

- [ ] **步骤 4：仅在红灯要求时修复最小实现**

若失败，修复范围仅限 `AskQuestionCard.run()` 的失败分支和问题集重置条件：失败只清 `submitting/inFlight/error`，不得重建 `state`；只有 `question.question_id` 真正变化时才重置选择。不得改变成功后等待后端 `question_resolved` 卸载卡片的现有行为。

- [ ] **步骤 5：复跑并提交**

运行：

```powershell
pnpm test -- src/components/chat/ask-question-card.test.tsx src/lib/ask-question.test.ts src/components/chat/conversation-shell.test.tsx
```

提交：

```powershell
git add src/components/chat/ask-question-card.test.tsx src/components/chat/ask-question-card.tsx
git commit -m "test(P1-02E): 加固选择卡片确认与重试行为"
```

如果生产组件无需修改，只提交测试文件，并在提交正文说明现有实现已满足行为、此次新增的是防回归证据。

---

### 任务 6：同步 README 的结构化选择卡片能力

**文件：**
- 修改：`README.md:43`
- 新建：`docs/screenshots/structured-decision-card.png`

**接口：**
- 消费：任务 1 至 5 已通过的实际功能。
- 产出：README 对外准确介绍触发边界、单选/多选、“其他”输入、纯自由输入、确认后 Agent 继续以及失败重试，不夸大不支持 Agent 的能力。

- [ ] **步骤 1：在本地运行真实结构化提问场景**

用支持 Codex `request_user_input`、Grok 原生提问或已启用 Prooflane `ask_user_question` 的 Agent 发起一个真正阻塞的 2～3 项决策；确认卡片出现在输入框上方，并验证普通建议列表仍作为正文显示。

- [ ] **步骤 2：完成一组实机交互**

依次验证：单选后未自动提交、多选可修改、“其他”可填写、0 选项自由输入可确认、提交失败后内容保留、确认后 Agent 从原阻塞点继续。

- [ ] **步骤 3：保存 README 截图**

截图只保留会话正文、结构化选择卡片和输入区，使用浅色主题、中文界面、常规桌面宽度；不得包含本机绝对路径、密钥、账号或私密会话。保存为 `docs/screenshots/structured-decision-card.png`。

- [ ] **步骤 4：新增 README 小节**

在“Prooflane 已新增能力”中加入：

```markdown
### 结构化决策卡片

当 Agent 缺少必须由用户决定的选项或信息、无法安全继续时，Prooflane 会把支持的原生提问或 `ask_user_question` 转为输入框上方的结构化卡片，而不是要求用户手工回复 A/B/C。普通建议、方案列表和可合理推断的决定仍保持为正文，不会被误判成选择题。

卡片支持单选、多选、自动“其他”输入和无预设选项的自由填写。所有答案都可在提交前修改，点击“确认”后才一次性发送；提交失败会保留已选内容并允许重试，成功后 Agent 从原阻塞点继续任务。

![Prooflane 结构化决策卡片支持选择、补充和确认后继续](docs/screenshots/structured-decision-card.png)
```

- [ ] **步骤 5：检查 README 表述并提交**

运行：

```powershell
rg -n "结构化决策卡片|单选|多选|其他|确认|A/B/C" README.md
git diff --check
```

预期：六类关键信息均可检索，README 没有宣称所有第三方自定义 Agent 都必然支持卡片。

提交：

```powershell
git add README.md docs/screenshots/structured-decision-card.png
git commit -m "docs(P1-02E): 介绍结构化选择卡片能力"
```

---

### 任务 7：全量门禁、视觉验收、外部文档同步和 Windows 打包

**文件：**
- 修改：`docs/superpowers/specs/2026-08-18-p1-02e-conversation-status-decision-design.md`
- 修改：`D:\工作相关\工作文件\工作资料\AI项目\docs\15-Prooflane-P1-02E会话状态与决策交互增强设计规格.md`
- 新建：`D:\工作相关\工作文件\工作资料\AI项目\docs\16-Prooflane-P1-02E会话状态与决策交互增强实施计划.md`

**接口：**
- 消费：任务 1 至 6 的提交。
- 产出：前后端门禁结果、深浅主题和窄宽度证据、可安装的 Windows NSIS 包、仓库/外部文档一致状态。

- [ ] **步骤 1：运行前端完整门禁**

```powershell
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

预期：命令全部以 0 退出；不允许通过跳过测试或降低 lint 规则获得绿灯。

- [ ] **步骤 2：运行 Rust 完整门禁**

```powershell
Set-Location src-tauri
cargo fmt --all -- --check
cargo test --features test-utils
cargo clippy --all-targets --features test-utils -- -D warnings
cargo test --lib --no-default-features
cargo clippy --no-default-features --bin codeg-mcp -- -D warnings
```

预期：全部通过；若出现与本分支无关的既有失败，记录准确命令、测试名和日志，不得笼统写“环境问题”。

- [ ] **步骤 3：完成视觉与无障碍验收**

至少检查：浅色/深色、中文/英文、常规宽度/窄窗口、生成中/工具中/等待/失败/停止、`prefers-reduced-motion`。确认状态条单行不遮挡按钮，长错误可截断且 `title` 可读，速度没有 `aria-live` 高频播报，工具详情只在时间线折叠卡片中可查看。

- [ ] **步骤 4：更新规格状态并同步外部文档**

把仓库规格状态从“等待实施计划”改为“已实现，等待/完成验收”（按实际门禁结果选择），补充实际测试和安装包路径。将仓库专项规格与外部 `15-...设计规格.md` 保持内容一致，并把本计划原样同步为外部 `16-...实施计划.md`。

使用哈希核对：

```powershell
Get-FileHash -Algorithm SHA256 docs/superpowers/specs/2026-08-18-p1-02e-conversation-status-decision-design.md
Get-FileHash -Algorithm SHA256 'D:\工作相关\工作文件\工作资料\AI项目\docs\15-Prooflane-P1-02E会话状态与决策交互增强设计规格.md'
Get-FileHash -Algorithm SHA256 docs/superpowers/plans/2026-08-18-p1-02e-conversation-status-decision.md
Get-FileHash -Algorithm SHA256 'D:\工作相关\工作文件\工作资料\AI项目\docs\16-Prooflane-P1-02E会话状态与决策交互增强实施计划.md'
```

预期：每一对 SHA256 相同。

- [ ] **步骤 5：构建 Windows 安装包**

回到仓库根目录运行：

```powershell
pnpm tauri build
```

预期产物：

```text
src-tauri/target/release/bundle/nsis/Prooflane_0.24.1-rc.1_x64-setup.exe
```

记录文件大小、SHA256 和构建时间；启动安装包后复测工具状态、速度和选择卡片主路径。

- [ ] **步骤 6：检查变更范围并提交文档状态**

```powershell
git status --short
git diff --check
git diff --stat origin/main...HEAD
```

不得提交 `.superpowers/brainstorm/` 临时内容、`node_modules`、`.next`、`out`、`target` 或安装包二进制。

提交：

```powershell
git add docs/superpowers/specs/2026-08-18-p1-02e-conversation-status-decision-design.md
git commit -m "docs(P1-02E): 同步实现与验收状态"
```

---

## 最终验收清单

- [ ] 工具状态始终是通用文案，原始标题/命令/参数不在状态条 DOM、tooltip 或无障碍名称中。
- [ ] 时间线工具卡片仍可展开，审计信息没有被删除。
- [ ] 真实输出速度无 `≈`，正文估算速度有 `≈`，未就绪和零速度格式正确。
- [ ] 速度不会跨会话、run、停止、失败、等待或重连串值。
- [ ] 状态条窄窗口不换行、不增高输入框、不覆盖操作按钮。
- [ ] 0 项问题显示自由输入，1 项问题被后端明确拒绝，2～4 项问题正常显示选择。
- [ ] 单选、多选、“其他”和自由输入都必须点击确认才提交。
- [ ] 提交失败保留用户选择，重试不会重复或丢失答案。
- [ ] 普通 Markdown 建议列表不生成卡片；支持结构化通道的 Agent 不再把手工 `A/B/C` 作为正常路径。
- [ ] README 已准确介绍结构化选择卡片的触发边界与完整交互。
- [ ] 前端、Rust、lint、类型、构建、Clippy 和 Windows 打包均有实际运行证据。

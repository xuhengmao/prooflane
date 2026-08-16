# Prooflane

<p align="center">
  <img src="./public/icon-128x128.png" alt="Prooflane" width="112" height="112" />
</p>

<p align="center"><strong>VERIFY THE DELIVERY</strong></p>

[![Release](https://img.shields.io/github/v/release/xuhengmao/prooflane)](https://github.com/xuhengmao/prooflane/releases)
[![License](https://img.shields.io/github/license/xuhengmao/prooflane)](./LICENSE)

Prooflane 是证据驱动的 AI 工程交付工作台。项目基于
[Codeg](https://github.com/xintaofei/codeg) `0.24.0` 演进，在保留多智能体编码工作区能力的同时，逐步加入任务合同、验收标准、验证证据、质量门禁和可审计交付流程。

Prooflane 当前版本为 `0.24.1-rc.1`。下文将 Codeg `0.24.0` 的继承能力与 Prooflane 已实现能力分开说明。

## 产品方向

Prooflane 不把“智能体回复结束”当作“任务完成”。目标流程是：

```text
需求 -> 规格 -> 实现 -> 验证 -> 审查 -> 有证据的交付
```

核心方向：

- 多智能体统一接入和协作。
- 目标、范围、约束和验收标准结构化。
- 测试、构建、代码审查、截图和日志自动形成证据。
- 高风险操作人工审批，阶段转换受质量门禁约束。
- 工作流、上下文包和团队最佳实践可复用。

## Codeg 继承能力

从 Codeg `0.24.0` 继承的主要能力包括：

- Claude Code、Codex CLI、OpenCode、Gemini CLI、OpenClaw、Cline 等智能体接入。
- 多智能体委托、会话聚合、工作区、终端、Git 和 Worktree。
- Tauri 桌面应用、Rust/Axum 服务端和 Docker 部署。
- 自动化、技能包、远程工作区、备份恢复和多语言界面。
- Next.js 16 + React 19 前端，SeaORM + SQLite 数据层。

## Prooflane 已新增能力

### 可控会话连续性

会话接力让新草稿或新会话在明确授权后接入一个历史会话的必要上下文。它是**主动接力**：普通新会话默认不会读取全部历史会话，也默认不会写入长期记忆。接力可跨智能体使用，并提供范围预览、Token 预算和来源追溯。

使用流程：

1. 选择来源：从当前项目或全部项目选择一个历史会话。
2. 检查范围与预算：选择最近轮次、自定义轮次或摘要，并在发送前检查范围预览与 Token 预算。
3. 发送后查看来源：新会话会显示来源追溯，可检查接入范围与快照元数据。

## 路线图

- 长期记忆：计划在后续阶段设计为可审计、可控制的独立能力；当前尚未作为现有能力提供。
- AI 设计工作台：计划提供用于设计、评审和复用 AI 工作流的工作台；当前尚未作为现有能力提供。

## 开发环境

- Node.js 20+
- pnpm `11.9.0`
- Rust stable
- Windows：Visual Studio C++ Build Tools、WebView2

安装依赖：

```powershell
pnpm install --frozen-lockfile
```

启动 Web 开发模式：

```powershell
pnpm dev
```

启动桌面开发模式：

```powershell
pnpm tauri dev
```

## 检查与构建

```powershell
pnpm lint
pnpm test
pnpm build

cd src-tauri
cargo check --locked
cd ..

pnpm tauri build --bundles nsis
```

服务端仍保留兼容二进制名：

```powershell
pnpm server:build
```

## 发布与更新

桌面和服务端更新从以下仓库发布：

```text
https://github.com/xuhengmao/prooflane/releases
```

GitHub Actions 需要以下仓库 Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

私钥和密码不得提交到 Git。Tauri 配置中只允许保存公钥。

## 兼容说明

首阶段仅迁移产品品牌和发布身份。为避免破坏已有数据、协议和备份，以下内部名称暂时保留：

- `codeg-server`、`codeg-mcp`、`codeg_lib`
- `CODEG_*` 环境变量
- `~/.codeg` 数据目录
- `codeg://` 内部引用协议

后续迁移必须采用双读、数据迁移和明确废弃周期，不能全局替换。

## 上游与许可

Prooflane 基于 Codeg `0.24.0` 二次开发。感谢 Codeg 作者和贡献者提供的基础工程。

本仓库遵循 [Apache License 2.0](./LICENSE)。二次分发和商业使用时仍需遵守原许可证中的版权、许可和 NOTICE 要求。

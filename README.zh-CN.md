# Inori

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

基于 **任意 OpenAI 兼容大模型端点** 的 GitHub Pull Request 自动化代码评审 Action。

Inori 会分析 PR 的代码变更（diff），并将评审意见以**精准锚定到真实代码行的新增行行号（Inline Comment）**和汇总报告的形式发布。整个流程完全运行在你自己的 GitHub Actions 工作流中，直接调用你配置的大模型 API —— 无需经过任何第三方 SaaS 服务，数据完全自主可控。

## 为什么选择 Inori

- **模型配置自动识别（精选 22 个主流提供商预设）**：无需手动查询并复制繁琐易错的 API Endpoint！直接传入 `provider: deepseek` / `qwen` / `glm` / `kimi` / `openai` / `google` / `xai`，或者仅传入 `llm_model: glm-4.7-flash` / `gpt-4o`，Inori 即可自动补全对应端点与推荐模型。同时 100% 允许自定义 `llm_endpoint`。
- **落地可执行的修复计划（Coding Plan）**：审查发现问题时，自动生成结构化、步骤清晰的修复计划与代码重构建议，在 PR 中优雅高亮展示，开发者可直接参考采纳。
- **精准锚定真实变更行**：每条 Inline 评论在发布前都会比对 PR 实际 diff 中的新增行（`+` 行），行号不合法的意见自动降级放入总结报告，杜绝悬空评论。
- **收口纪律与防发散机制**：内置严格的评审纪律（够格标准、明确排除防御性穷举与教程化建议、逐字核对引文、客观校准严重度），彻底解决多轮 Re-review 模型陷入低价值挑刺和防御性穷举的问题。
- **保留可信评审记录**：每轮评审关联固定提交并新增汇总；新结果完整发布后再按 `on_update` 清理旧行内评论。失败或覆盖不完整时保留旧意见。
- **可见的评审范围**：按文件执行严格 Diff 字符预算，披露省略文件、不可用 patch 和 API 文件缺口；通过 Action outputs 与运行摘要区分完成、部分覆盖、跳过、过期和失败。
- **可信仓库配置（`.github/inori.yml`）**：从 PR 事件的固定 base SHA 读取团队规范、提供商偏好与评审设置，无需 checkout PR 代码。

## 快速开始

> **尚未发布：** 本轮改动尚未包含在已发布的 `@v0` 中。无需 checkout、可信 base SHA 配置和新 outputs 将在后续 Release 更新 `@v0` 后生效。在此之前，使用当前已发布版且需要仓库配置时，请保留 `actions/checkout` 步骤；以下示例描述的是即将发布的行为。

1. 在仓库的 **Settings → Secrets and variables → Actions** 中添加你的大模型 API 密钥（如 `DEEPSEEK_API_KEY`）。

2. 在仓库中创建 `.github/workflows/inori.yml`：

```yaml
name: Inori Review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

# 当 PR 有新 push 时自动取消旧运行，避免重复评审
concurrency:
  group: inori-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write   # 需要发布评审评论权限

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: VOD-Studio/inori@v0
        id: review
        with:
          provider: deepseek             # 自动识别端点与模型；也可传 `llm_model: gpt-4o` 等
          llm_api_key: ${{ secrets.DEEPSEEK_API_KEY }}
```

3. 提交 PR，Inori 将会自动执行代码审查并发表意见。

无需 `actions/checkout`：Inori 通过 GitHub API 读取 diff 和 base SHA 上的配置，因此仍需 `contents: read`。普通 fork PR 通常拿不到仓库 secrets，工作流 token 也没有评论写权限；以上示例适用于拥有这些权限和凭据的 PR 运行环境，不包含 fork 的特权评审方案。

> **切换大模型服务商极简** —— 无需手动查填 URL：
> - **DeepSeek**：`provider: deepseek`（或 `llm_model: deepseek-v4-flash`）
> - **GLM**：`provider: zhipu`（或 `llm_model: glm-4.7-flash`）
> - **Qwen**：`provider: qwen`（或 `llm_model: qwen-plus`, `qwen3-coder-plus`）
> - **SiliconFlow**：`provider: siliconflow`
> - **Kimi**：`provider: kimi`（或 `llm_model: kimi-k2.6`）
> - **Gemini**：`provider: google`（或 `llm_model: gemini-3.7-flash`）
> - **Grok**：`provider: xai`（或 `llm_model: grok-4.6`）
> - **Claude**：`provider: anthropic`（或 `llm_model: claude-sonnet-4`）
> - **Doubao / Groq / OpenRouter / Mistral / Ollama / MiniMax ...** —— 完整预设表见[下方](#支持的提供商)（共 22 个）
>
> **订阅套餐**（固定月费额度）使用**独立的端点与 key 体系**，与按量计费凭据**不互通**：
> - `provider: qwen-coding` → `https://coding.dashscope.aliyuncs.com/v1`，需 `sk-sp-` 套餐 key（模型：`qwen3-coder-plus`、`kimi-k2.5`、`glm-5`、`MiniMax-M2.5` 等）
> - `provider: glm-coding` → `https://open.bigmodel.cn/api/coding/paas/v4`（模型：`glm-5.3`）
> - `provider: doubao-coding` → `https://ark.cn-beijing.volces.com/api/coding/v3`（模型：`ark-code-latest`，白名单含豆包/GLM/Kimi）
> - `provider: minimax-token` → `https://api.minimaxi.com/v1`，需 `sk-cp-` 订阅 key（模型：`MiniMax-M2.7`；与按量计费共用端点，仅 key 不同）
> DeepSeek 与 Kimi（Moonshot）官方无订阅套餐（纯按量计费）；`kimi-k2.5` 等是阿里/火山套餐白名单里聚合的第三方模型。
> ⚠️ 注意：各平台 ToS 限制套餐 key 仅用于指定编程工具、禁止自动化 API 调用。在 CI 评审中使用可能违反条款、有封 key 风险，请自行评估。
> - **自建代理 / 本地部署**：显式指定 `llm_endpoint: https://your-gateway/v1` 始终享有最高优先级。

## 支持的提供商

以下 22 个预设均已对照官方文档核验（2026-08-18）。传入 `provider` 值即自动补全端点；`llm_model` 可选（默认值见下表）。也可以只传 `llm_model`，Inori 会按模型名特征自动推断提供商。

| 提供商 | `provider` 值 | 默认模型 |
|---|---|---|
| DeepSeek | `deepseek` | `deepseek-v4-flash` |
| OpenAI | `openai` | `gpt-4o-mini` |
| Gemini | `google` | `gemini-3.7-flash` |
| Grok | `xai` | `grok-4.6` |
| GLM | `zhipu`（别名 `glm`） | `glm-4.7-flash` |
| Qwen | `dashscope`（别名 `qwen`） | `qwen-plus` |
| Kimi | `moonshot`（别名 `kimi`） | `kimi-k2.6` |
| Doubao | `volcengine`（别名 `doubao`） | `doubao-seed-2-0-lite-260428` |
| MiniMax | `minimax` | `MiniMax-M2` |
| Claude | `anthropic` | `claude-sonnet-4-20250514` |
| SiliconFlow | `siliconflow` | `deepseek-ai/DeepSeek-V3` |
| OpenRouter | `openrouter` | `deepseek/deepseek-chat-v3.1` |
| Groq | `groq` | `openai/gpt-oss-120b` |
| GitHub Models | `github-models` | `openai/gpt-4o-mini` |
| Mistral | `mistral` | `codestral-latest` |
| Perplexity | `perplexity` | `sonar` |
| Ollama（本地） | `ollama` | `llama3` |
| vLLM / LM Studio（本地） | `local` | `default` |

订阅套餐预设（`glm-coding`、`qwen-coding`、`doubao-coding`、`minimax-token`）的端点、key 与 ToS 风险见上方警示块。

其他任意 OpenAI 兼容端点可通过显式 `llm_endpoint` 接入（始终享有最高优先级）。

## 仓库配置（`.github/inori.yml`）

除了在 Workflow 中通过 `with:` 传参外，你也可以在仓库根目录创建 `.github/inori.yml`（或 `.github/inori.yaml`）来统一管理评审设置与团队代码规范：

```yaml
# .github/inori.yml
provider: qwen               # 自动识别端点与推荐编程模型 (deepseek | zhipu | qwen | openai | ...)
coding_plan: true            # 评审意见中是否附带具体的修复计划与代码建议 (默认: true)
language: zh
on_update: resolve          # replace | resolve | keep (默认: replace)
skip_draft: true            # 草稿 PR 是否跳过评审 (默认: true)
ignore_bots: true           # 机器人 PR 是否跳过评审 (默认: true)
ignore_patterns:            # 额外忽略的文件 glob 模式（与内置忽略规则合并）
  - "*.generated.ts"
  - "fixtures/**"
paths_ignore:               # 全部变更文件命中时整体跳过评审
  - ".github/**"
  - "docs/**"
ignore_commit_prefixes:    # 全部 commit 标识命中时整体跳过评审
  - "ci:"
  - "docs:"
  - "chore:"
custom_instructions: |
  1. 所有前端组件禁止内联样式，统一使用 Tailwind CSS。
  2. 新增导出函数与接口必须附带完整 TSDoc 注释。
  3. 涉及金额与数量的计算必须使用 Decimal 库，严禁使用原生浮点数。
```

**配置优先级**：Action Workflow 输入参数（`with:`） > `.github/inori.yml` > 内置默认值。

配置从 PR 事件记录的 `base.sha` 读取，优先 `.github/inori.yml`，不存在时才尝试 `.github/inori.yaml`。不读取 checkout 工作区：PR 中修改的配置需要合并后，才能由包含该提交的后续 base SHA 使用。两个文件都不存在时使用默认值；空文件或仅注释文件也允许使用默认值。读取失败、非法 YAML、错误字段类型或非法枚举会使运行失败，不静默回退。字符预算必须为正整数，`max_body_chars` 不能超过 `65536`。

密钥来源依次为 `llm_api_key`、已确定 provider 的专属环境变量、`LLM_API_KEY`。只有默认 DeepSeek 路由可使用默认 `DEEPSEEK_API_KEY`；未确定 provider 的自定义端点需要显式 `llm_api_key` 或 `LLM_API_KEY`，不会把其他 provider 的密钥作为兜底发送。指定 provider 的自定义代理仍可使用该 provider 专属环境密钥。

### 默认内置忽略文件

Inori 默认自动忽略以下常见非评审文件（无需在 `ignore_patterns` 中重复配置）：

- **包管理锁文件**：`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `go.sum`, `Cargo.lock`, `poetry.lock`, `composer.lock`
- **压缩产物与 SourceMap**：`*.min.js`, `*.min.css`, `*.map`
- **矢量资源**：`*.svg`
- **发版清单与 Changelog**：`CHANGELOG.md`, `.release-please-manifest.json`

## 参数说明 (Inputs)

| 参数 | 说明 | 必填 | 默认值 |
|---|---|:---:|---|
| `provider` | 模型提供商预设（`deepseek`, `zhipu`, `qwen`, `siliconflow`, `openai`, `kimi`, `anthropic`, `groq` 等），自动补全端点与模型 | — | `deepseek` |
| `llm_model` | 模型名称（可选，不传则按 provider 预设或模型名特征自动推断，如 `gpt-4o`, `glm-4.7-flash`） | — | 自动推断 |
| `llm_endpoint` | 自定义 OpenAI 兼容接口 Base URL（可选，不传则自动推断） | — | 自动推断 |
| `llm_api_key` | 大模型 API 密钥 | ✅ | — |
| `coding_plan` | 是否在评审中生成具体的代码修复计划 (Coding Plan) 与实施步骤 | — | `true` |
| `github_token` | 具有 `contents:read` 和 `pull-requests:write` 权限的 GitHub Token；使用 `resolve` 时还需要 `contents:write`（GitHub GraphQL 权限映射限制）。默认使用 Workflow Token。 | — | `${{ github.token }}` |
| `language` | 评审意见输出语言：`zh` \| `en` | — | `zh` |
| `ignore_patterns` | 逗号分隔的额外忽略 glob 规则（与内置规则合并） | — | — |
| `paths_ignore` | 全部变更文件命中时**整体跳过**评审（纯 CI/文档类变更无代码语义）。与 `ignore_patterns`（仅从评审上下文剔除文件）语义正交。 | — | — |
| `ignore_commit_prefixes` | 全部 commit 标识（subject 前缀）命中时**整体跳过**评审（Conventional Commits 语义：无代码变更）。混合任一非命中 commit 的 PR 照常评审。 | — | — |
| `max_diff_chars` | 整轮 Diff 总字符预算，含文件头与跨批次分隔符 | — | `40000` |
| `batch_diff_chars` | 单批 Diff 字符预算，不超过总预算；不拆分文件或 hunk | — | `40000` |
| `max_requests` | 整轮显式 LLM HTTP 请求数上限，含重试和 response-format 兼容回退 | — | `4` |
| `review_concurrency` | 并发批次 worker 数，必须为 1 至 3 的整数 | — | `1` |
| `max_body_chars` | 评审正文硬字符上限，含覆盖说明和标记；超限失败，不截断意见（最大 65536） | — | `60000` |
| `custom_instructions` | 附加评审规则（团队规范、禁止调用的 API 等） | — | — |
| `on_update` | Re-review 时旧评论处理方式：`replace`（删除旧评论） \| `resolve`（GraphQL 标记解决） \| `keep`（保留） | — | `replace` |
| `skip_draft` | 草稿 PR 是否跳过评审 | — | `true` |
| `ignore_bots` | 是否跳过 Bot 创建的 PR（官方 Bot 账号：登录名带 `*[bot]` 后缀或 `type: Bot`；其他自动化账号请用 `ignore_authors`） | — | `true` |
| `ignore_authors` | 逗号分隔的跳过评审的作者用户名列表 | — | — |
| `keep_previous_comments` | 兼容旧版开关：设为 true 保留旧评论（等同于 `on_update: keep`） | — | `false` |

## 输出与运行状态

所有运行都会尝试写入以下 Action outputs 和 GitHub Actions 运行摘要。`completed` 表示流程完成，**不表示没有发现问题**；Inori 继续发布 COMMENT 评审，不自动批准、拒绝合并或按严重度设置门禁。

| Output | 含义 |
|---|---|
| `status` | `completed` / `partial` / `skipped` / `stale` / `failed`，定义见下表 |
| `head_sha` | 本轮对应的 PR head SHA |
| `findings_count` | 已通过结构校验的发现数量；不等同于已发布数量 |
| `reviewed_files` | 模型有效完成评审的文件数量；发布仍可能失败 |
| `omitted_files` | 因 Diff/请求预算、不可用 patch、API 限制或批次失败遗漏的文件数量，不含按规则忽略的文件 |
| `reason` | 运行状态的原因说明 |
| `requests_used` | 已启动的显式 LLM HTTP 请求数，含重试和 response-format 回退，不计 fetch 内部跟随的重定向 |
| `batches_completed` | 模型有效完成评审的批次数 |
| `batches_failed` | 已启动但未获得有效评审的批次数 |
| `batches_unstarted` | 因请求预算耗尽而未启动的批次数 |
| `duration_ms` | 批次处理的实际耗时，含 worker 等待、重试与解析，不含 PR 拉取和发布 |
| `prompt_tokens` | 端点报告的输入 token 累计；无可用 usage 时为空串 |
| `completion_tokens` | 端点报告的输出 token 累计；无可用 usage 时为空串 |
| `total_tokens` | 端点报告的总 token 累计；无可用 usage 时为空串 |
| `usage_complete` | 至少启动一次请求且每次请求均报告有效 usage 时才为 `true`，否则为 `false` |

| Status | 含义 |
|---|---|
| `completed` | 配置允许范围内的可用变更已评审，结果完整发布；检查 `findings_count` 判断是否有发现 |
| `partial` | 有覆盖缺口、部分批次失败或未启动，或 inline 发布失败但内容已保存在汇总；无任何可用 diff 时也可能没有发布评论 |
| `skipped` | 命中草稿、作者、提交前缀、路径规则，或全部文件按规则忽略；不调用模型 |
| `stale` | PR head 或 base 已变化，本轮停止发布 |
| `failed` | 配置、API、所有已启动批次、聚合正文预算或发布失败；Action 标记失败，保留历史评论；发布过程中失败时可能已留下部分新评论 |

Token 数只累计 usage 三个 token 字段均为有效非负整数的请求。缺失表示未知，不能当作零；部分请求报告用量时，累计值可能非空而 `usage_complete: false`。请求数与字符预算限制工作量，不等于 token 账单或金额上限；Inori 不估算价格，也不执行费用硬上限。

### 分批评审预算

默认 `max_diff_chars` 和 `batch_diff_chars` 均为 `40000`，保留原有单批评审范围。要分请求审查更多文件，可以在可信仓库配置中增大总预算，例如：

```yaml
max_diff_chars: 120000
batch_diff_chars: 40000
max_requests: 6
review_concurrency: 2
```

两个字符预算均计实际 Diff 文本与文件头，总预算还预留跨批次分隔符。超出单批或剩余总预算的文件会被省略，继续考虑后续较小文件；不拆分文件或 hunk。重试、每批最多一次的 `response_format` 兼容回退和首次请求共用同一请求池。耗尽后等待中的批次记为未启动；已发过请求但无法完成的批次记为失败，正在执行的请求仍可完成。

成功结果按批次顺序合并，每条汇总结论只适用于该批列出的文件。仅对完全相同的 inline `(path, line, body)` 和相同汇总条目去重，不再调用模型汇总，也不做语义去重。部分批次成功时可以发布 `partial` 结果并保留历史；计划批次全部失败时不发布，运行失败。聚合汇总仍须满足 `max_body_chars`。

例如，在上面 `id: review` 的步骤后读取状态；`if: always()` 使失败后的步骤也能运行：

```yaml
      - name: Inspect review outcome
        if: always()
        env:
          REVIEW_STATUS: ${{ steps.review.outputs.status }}
          REVIEW_FINDINGS: ${{ steps.review.outputs.findings_count }}
          REVIEW_OMITTED: ${{ steps.review.outputs.omitted_files }}
        run: printf 'status=%s findings=%s omitted=%s\n' "$REVIEW_STATUS" "$REVIEW_FINDINGS" "$REVIEW_OMITTED"
```

## 工作原理

1. **可信快照与配置**：校验事件中的 head/base SHA，从固定 base SHA 读取配置；拉取 diff 前后和发布前再次核对快照。检测到变化就停止，避免把当前 diff 结果发布到旧提交。
2. **规则与预算**：草稿、机器人、指定作者和可配置的提交/路径规则可以跳过评审。请在触发事件中保留 `ready_for_review`。Diff 以完整文件块纳入总预算 `max_diff_chars` 和单批预算 `batch_diff_chars`；放不下的文件略过，继续尝试后续较小文件，不拆分 hunk。汇总披露已评审、忽略、预算省略、无可用 patch、API 未返回、批次失败和未启动的文件数量，以及省略文件清单。GitHub 文件列表最多返回 3000 个文件，超过时按 PR 文件总数记录缺口；“无 patch”不等于“没有问题”。
3. **响应校验**：Prompt 要求只报告真实缺陷、准确引用代码，并把 diff 中的指令视为不可信数据；这些约束不能保证模型完全抵抗提示注入。空响应、非法 JSON、错误字段类型、明确未完成的模型响应均失败，不会产生“未发现问题”。HTTP 请求有超时、有限重试和整轮共享请求数上限；兼容端点省略 `finish_reason` 时仍会校验正文结构。
4. **发布完整性**：合法新增行上的发现发布为 inline，其他发现进入汇总。聚合正文超过 `max_body_chars` 直接失败，保留历史，不裁剪意见。inline 失败时将完整发现补入汇总；过长的发布兜底内容分成多条汇总，只有全部汇总发布成功后才考虑清理旧评论。
5. **多轮评审（`on_update`）**：每轮都创建关联当前 SHA 的新汇总，旧汇总保留，不再就地修改。只有本轮覆盖完整、inline 和汇总都发布成功，才处理发布前快照中属于同一发布者的旧行内评论。`replace` 删除未回复的旧评论；`resolve` 解决未回复的旧线程；`keep` 保留。覆盖不完整或 inline 降级时强制保留历史；人工回复过的讨论不清理。清理失败只记录警告，不抹去已发布的新结果。

### Re-review 清理所需的 GitHub 权限

读取可信配置和发布评审需要：

```yaml
permissions:
  contents: read
  pull-requests: write
```

`on_update: resolve` 会额外调用 GitHub GraphQL 的 `resolveReviewThread` mutation。GitHub 当前会拒绝仅有 `pull-requests: write` 的 Token，必须同时授予 `contents: write`，尽管解决评审线程只修改 PR 对话元数据，不修改仓库文件：

```yaml
permissions:
  contents: write
  pull-requests: write
```

`contents: write` 允许 Workflow Token 向仓库推送内容。只有确实需要保留 Resolved 线程历史时才建议使用 `resolve`；否则优先使用默认的 `replace`。`replace` 的删除操作只需要 `pull-requests: write`，但读取可信配置仍需 `contents: read`。必须使用 `resolve` 时，优先使用限定到目标仓库的 GitHub App Token，而不是权限宽泛的个人 Token。清理发生在新评审发布之后；清理失败时记录 Warning，Job 仍可能成功。

该 GitHub 权限行为见 [GitHub Community Discussion #204269](https://github.com/orgs/community/discussions/204269)。

## 开发与发布

CI 复用 `verify.yml` 执行 lint、类型检查、测试、构建和 dist 一致性检查。发布前验证已合并 release PR 的固定 SHA；历史 Release 的 major 标签恢复使用独立验证链路，其失败不阻止新候选发布。release PR 维护独立运行。三条链路均限制在 main，按 job 所需授予写权限。

major 标签只推进到相应链路已验证的 SHA；其他目标（包括并发新出现的 Release）会跳过并告警，留待后续运行。分支保护、必需检查和仅允许 squash 仍需管理员配置，工作流不会设置这些远端规则。设计取舍与后续计划见 [项目路线图](docs/ROADMAP.md)。

## 数据与隐私

PR 的代码 Diff 将**直接发送**至你所配置的大模型服务商端点。除你自行指定的模型提供商外，任何第三方均无法接触你的代码。在私有仓库启用前，请确认所选模型服务商的数据与隐私条款。

## 开源协议

[MIT](LICENSE)

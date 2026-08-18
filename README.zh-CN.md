# Inori

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

基于 **任意 OpenAI 兼容大模型端点** 的 GitHub Pull Request 自动化代码评审 Action。

Inori 会分析 PR 的代码变更（diff），并将评审意见以**精准锚定到真实代码行的新增行行号（Inline Comment）**和汇总报告的形式发布。整个流程完全运行在你自己的 GitHub Actions 工作流中，直接调用你配置的大模型 API —— 无需经过任何第三方 SaaS 服务，数据完全自主可控。

## 为什么选择 Inori

- **模型配置自动识别（内置 24+ 主流提供商预设）**：无需手动查询并复制繁琐易错的 API Endpoint！直接传入 `provider: zhipu` / `qwen` / `openai` / `deepseek` / `siliconflow` / `kimi` / `anthropic`，或者仅传入 `llm_model: glm-4-flash` / `gpt-4o`，Inori 即可自动补全对应端点与推荐编程模型。同时 100% 允许自定义 `llm_endpoint`。
- **落地可执行的修复计划（Coding Plan）**：审查发现问题时，自动生成结构化、步骤清晰的修复计划与代码重构建议，在 PR 中优雅高亮展示，开发者可直接参考采纳。
- **精准锚定真实变更行**：每条 Inline 评论在发布前都会比对 PR 实际 diff 中的新增行（`+` 行），行号不合法的意见自动降级放入总结报告，杜绝悬空评论。
- **收口纪律与防发散机制**：内置严格的评审纪律（够格标准、明确排除防御性穷举与教程化建议、逐字核对引文、客观校准严重度），彻底解决多轮 Re-review 模型陷入低价值挑刺和防御性穷举的问题。
- **智能 Re-review 生命周期管理（`on_update`）**：支持灵活配置旧评审的处理方式 —— `replace`（清理旧评论重新发布）、`resolve`（通过 GraphQL 将旧评审线程标记为 Resolved 已解决）、`keep`（保留历史记录），告别红点堆叠。
- **智能早退与安全截断**：自动识别并跳过草稿 PR（`skip_draft`）、机器人 PR（`ignore_bots`，官方 Bot 账号即登录名带 `*[bot]` 后缀或账号类型为 `type: Bot`，如 `dependabot[bot]`、`renovate[bot]`）及空变更，节省 API 预算；超长 Diff 按文件块边界安全截断，防止半截代码引发语法幻觉。
- **支持仓库级配置文件（`.github/inori.yml`）**：支持在仓库中通过 YAML 文件对团队编码规范、提供商偏好和评审要求进行版本化管理，保持 Workflow 极简。

## 快速开始

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
      - uses: actions/checkout@v4
        with:
          provider: deepseek             # 自动识别端点与模型；也可传 `llm_model: gpt-4o` 等
          llm_api_key: ${{ secrets.DEEPSEEK_API_KEY }}
```

3. 提交 PR，Inori 将会自动执行代码审查并发表意见。

> **切换大模型服务商极简** —— 无需手动查填 URL：
> - **DeepSeek**：`provider: deepseek`（或 `llm_model: deepseek-chat`）
> - **GLM**：`provider: zhipu`（或 `llm_model: glm-4.7-flash`）
> - **Qwen**：`provider: qwen`（或 `llm_model: qwen-plus`, `qwen3-coder-plus`）
> - **SiliconFlow**：`provider: siliconflow`
> - **Kimi**：`provider: kimi`（或 `llm_model: kimi-k2.6`）
> - **Gemini**：`provider: google`（或 `llm_model: gemini-3.7-flash`）
> - **Grok**：`provider: xai`（或 `llm_model: grok-4.6`）
> - **Claude**：`provider: anthropic`（或 `llm_model: claude-sonnet-4`）
> - **Doubao / ERNIE / Hunyuan / Yi / Groq / OpenRouter / Mistral / Ollama / MiniMax ...**（内置 26+ 主流预设）
>
> **订阅套餐**（固定月费额度）使用**独立的端点与 key 体系**，与按量计费凭据**不互通**：
> - `provider: qwen-coding` → `https://coding.dashscope.aliyuncs.com/v1`，需 `sk-sp-` 套餐 key（模型：`qwen3-coder-plus`、`kimi-k2.5`、`glm-5`、`MiniMax-M2.5` 等）
> - `provider: glm-coding` → `https://open.bigmodel.cn/api/coding/paas/v4`（模型：`glm-5.3`）
> - `provider: doubao-coding` → `https://ark.cn-beijing.volces.com/api/coding/v3`（模型：`ark-code-latest`，白名单含豆包/GLM/Kimi）
> - `provider: minimax-token` → `https://api.minimaxi.com/v1`，需 `sk-cp-` 订阅 key（模型：`MiniMax-M2.7`；与按量计费共用端点，仅 key 不同）
> DeepSeek 与 Kimi（Moonshot）官方无订阅套餐（纯按量计费）；`kimi-k2.5` 等是阿里/火山套餐白名单里聚合的第三方模型。
> ⚠️ 注意：各平台 ToS 限制套餐 key 仅用于指定编程工具、禁止自动化 API 调用。在 CI 评审中使用可能违反条款、有封 key 风险，请自行评估。
> - **自建代理 / 本地部署**：显式指定 `llm_endpoint: https://your-gateway/v1` 始终享有最高优先级。

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
custom_instructions: |
  1. 所有前端组件禁止内联样式，统一使用 Tailwind CSS。
  2. 新增导出函数与接口必须附带完整 TSDoc 注释。
  3. 涉及金额与数量的计算必须使用 Decimal 库，严禁使用原生浮点数。
```

**配置优先级**：Action Workflow 输入参数（`with:`） > `.github/inori.yml` > 内置默认值。

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
| `llm_model` | 模型名称（可选，不传则按 provider 预设或模型名特征自动推断，如 `gpt-4o`, `glm-4-flash`） | — | 自动推断 |
| `llm_endpoint` | 自定义 OpenAI 兼容接口 Base URL（可选，不传则自动推断） | — | 自动推断 |
| `llm_api_key` | 大模型 API 密钥 | ✅ | — |
| `coding_plan` | 是否在评审中生成具体的代码修复计划 (Coding Plan) 与实施步骤 | — | `true` |
| `github_token` | 具有 `pull-requests:write` 权限的 GitHub Token | — | `${{ github.token }}` |
| `language` | 评审意见输出语言：`zh` \| `en` | — | `zh` |
| `ignore_patterns` | 逗号分隔的额外忽略 glob 规则（与内置规则合并） | — | — |
| `max_diff_chars` | Diff 字符数上限，超出将在文件块边界安全截断 | — | `40000` |
| `max_body_chars` | 评审 Summary 字符数上限（GitHub API 单条上限 65536） | — | `60000` |
| `custom_instructions` | 附加评审规则（团队规范、禁止调用的 API 等） | — | — |
| `on_update` | Re-review 时旧评论处理方式：`replace`（删除旧评论） \| `resolve`（GraphQL 标记解决） \| `keep`（保留） | — | `replace` |
| `skip_draft` | 草稿 PR 是否跳过评审 | — | `true` |
| `ignore_bots` | 是否跳过 Bot 创建的 PR（官方 Bot 账号：登录名带 `*[bot]` 后缀或 `type: Bot`；其他自动化账号请用 `ignore_authors`） | — | `true` |
| `ignore_authors` | 逗号分隔的跳过评审的作者用户名列表 | — | — |
| `keep_previous_comments` | 兼容旧版开关：设为 true 保留旧评论（等同于 `on_update: keep`） | — | `false` |

## 工作原理

1. **智能早退判定**：在执行前检查 PR 状态，若命中草稿 PR（`skip_draft`）、机器人 PR（`ignore_bots`）或指定作者名单（`ignore_authors`），直接早退不消耗 Token。请在触发事件的 `types` 中包含 `ready_for_review`，使草稿 PR 标记「准备好评」后自动触发评审。
2. **Diff 预处理与安全截断**：获取 PR 变更文件并应用内置与自定义忽略规则。当 Diff 总长度超出 `max_diff_chars` 时，回退到上一个完整文件块边界截断，保证每个送审文件的语法结构完整，杜绝半截括号等导致的幻觉。若过滤后无有效变更，则正常退出。
3. **结构化 Prompt 与纪律约束**：Prompt 内置系统防注入保护，并施加四条严格纪律（够格标准、明确排除防御性补全、引文逐字核对、严重度客观校准），引导模型聚焦高价值缺陷。
4. **行号合法性校验**：模型输出的评审意见如果对应目标文件真实的新增行（`+` 行），则发布为行内评论（Inline Comment）；行号无法匹配的意见自动汇总到 Summary。
5. **多轮评审生命周期（`on_update`）**：
   - `replace`（默认）：清理上一轮 inori 的未回复行内评论，并在原评审上就地更新 Summary。
   - `resolve`：通过 GitHub GraphQL API 将上一轮未回复的评审线程标记为 **Resolved**（已解决），GitHub 会折叠隐藏旧意见，保持页面清爽同时保留修复轨迹。
   - `keep`：不作处理，保留全部历史行内评论（Summary 仍在原评审上就地更新）。

## 数据与隐私

PR 的代码 Diff 将**直接发送**至你所配置的大模型服务商端点。除你自行指定的模型提供商外，任何第三方均无法接触你的代码。在私有仓库启用前，请确认所选模型服务商的数据与隐私条款。

## 开源协议

[MIT](LICENSE)

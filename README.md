# Inori

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

AI code review for pull requests — works with **any OpenAI-compatible LLM endpoint**.

Inori reviews your PR diff and posts findings as **inline comments anchored to real diff lines** (plus a summary comment). It runs entirely inside your GitHub Actions on the LLM provider you configure — no third-party SaaS sees your code, and you bring your own API key.

## Why Inori

- **22 Curated Provider Presets.** No need to look up or copy API endpoints. Simply specify `provider: deepseek` / `qwen` / `glm` / `kimi` / `openai` / `google` / `xai`, or just specify `llm_model: glm-4.7-flash` / `gpt-4o`, and Inori auto-detects the matching endpoint and model. Full custom `llm_endpoint` is always supported.
- **Actionable Coding Plan.** Generates clear, step-by-step fix recommendations and code replacement snippets whenever a defect is found, rendered cleanly in PR comments.
- **Inline comments on real lines.** Every comment's line number is validated against the actual diff before posting; comments that don't land on a real added line fall back to the summary instead of dangling.
- **Review discipline & convergence.** Built-in strict review constraints prevent LLMs from degenerating into "defensive exhaustion" during multi-round re-reviews — focuses on real defects, bans unprompted defensive boilerplate suggestions, mandates verbatim quoting, and calibrates severities objectively.
- **Smart re-reviews (`on_update`).** Configurable handling of previous review comments (`replace` to delete stale ones, `resolve` to automatically resolve threads via GraphQL, or `keep` to retain history) without messy duplicate stacking.
- **Smart early exit & safety.** Automatically skips draft PRs, bot PRs (accounts with the official `*[bot]` login suffix or `type: Bot`, e.g. `dependabot[bot]`, `renovate[bot]`), and empty diffs to eliminate wasted API calls. Diffs are safely truncated on file boundaries to prevent LLM hallucinations from split code blocks.
- **Repository configuration (`.github/inori.yml`).** Manage review settings, ignore rules, provider preferences, and team coding guidelines directly in your codebase with version control.
## Quick start

1. Add your LLM API key as a repository secret (e.g. `DEEPSEEK_API_KEY`) under **Settings → Secrets and variables → Actions**.

2. Create `.github/workflows/inori.yml` in your repo:

```yaml
name: Inori Review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

# Cancel stale reviews when a PR is updated to avoid duplicate comments
concurrency:
  group: inori-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write   # post review comments

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: VOD-Studio/inori@v0
        with:
          provider: deepseek             # Auto-detects endpoint & model; or pass `llm_model: gpt-4o`, etc.
          llm_api_key: ${{ secrets.DEEPSEEK_API_KEY }}
```

3. Open a PR. Inori reviews it automatically.

> **Switching providers is effortless** — no endpoint URL lookup needed:
> - **DeepSeek**: `provider: deepseek` (or `llm_model: deepseek-v4-flash`)
> - **GLM**: `provider: zhipu` (or `llm_model: glm-4.7-flash`)
> - **Qwen**: `provider: qwen` (or `llm_model: qwen-plus`, `qwen3-coder-plus`)
> - **SiliconFlow**: `provider: siliconflow`
> - **Kimi**: `provider: kimi` (or `llm_model: kimi-k2.6`)
> - **Gemini**: `provider: google` (or `llm_model: gemini-3.7-flash`)
> - **Grok**: `provider: xai` (or `llm_model: grok-4.6`)
> - **Claude**: `provider: anthropic` (or `llm_model: claude-sonnet-4`)
> - **Doubao / Groq / OpenRouter / Mistral / Ollama / MiniMax ...** — see the [full preset table](#supported-providers) below (22 presets)
>
> **Subscription plans** (fixed monthly quota) use a **separate endpoint & key system** — NOT interchangeable with pay-as-you-go credentials:
> - `provider: qwen-coding` → `https://coding.dashscope.aliyuncs.com/v1` with a `sk-sp-` key (models: `qwen3-coder-plus`, `kimi-k2.5`, `glm-5`, `MiniMax-M2.5`, ...)
> - `provider: glm-coding` → `https://open.bigmodel.cn/api/coding/paas/v4` (model: `glm-5.3`)
> - `provider: doubao-coding` → `https://ark.cn-beijing.volces.com/api/coding/v3` (model: `ark-code-latest`, Doubao/GLM/Kimi whitelisted)
> - `provider: minimax-token` → `https://api.minimaxi.com/v1` with a `sk-cp-` key (model: `MiniMax-M2.7`; same endpoint as pay-as-you-go — only the key differs)
> DeepSeek and Kimi (Moonshot) offer no subscription plans (pure pay-as-you-go); `kimi-k2.5` etc. appear inside Ali/Volcengine plan whitelists as aggregated third-party models.
> ⚠️ Note: provider ToS restrict plan keys to designated coding tools and prohibit automated API usage. Using them in CI review may violate the terms and risk key suspension — evaluate before use.
> - **Custom Proxy / Self-hosted**: Explicit `llm_endpoint: https://your-gateway/v1` always takes highest precedence.

## Supported providers

All 22 presets below are verified against official docs (2026-08-18). Pass the `provider` value and Inori auto-fills the endpoint; `llm_model` is optional (defaults shown). You can also pass just `llm_model` — Inori infers the provider from the model name.

| Provider | `provider` value | Default model |
|---|---|---|
| DeepSeek | `deepseek` | `deepseek-v4-flash` |
| OpenAI | `openai` | `gpt-4o-mini` |
| Gemini | `google` | `gemini-3.7-flash` |
| Grok | `xai` | `grok-4.6` |
| GLM | `zhipu` (alias `glm`) | `glm-4.7-flash` |
| Qwen | `dashscope` (alias `qwen`) | `qwen-plus` |
| Kimi | `moonshot` (alias `kimi`) | `kimi-k2.6` |
| Doubao | `volcengine` (alias `doubao`) | `doubao-seed-2-0-lite-260428` |
| MiniMax | `minimax` | `MiniMax-M2` |
| Claude | `anthropic` | `claude-sonnet-4-20250514` |
| SiliconFlow | `siliconflow` | `deepseek-ai/DeepSeek-V3` |
| OpenRouter | `openrouter` | `deepseek/deepseek-chat-v3.1` |
| Groq | `groq` | `openai/gpt-oss-120b` |
| GitHub Models | `github-models` | `openai/gpt-4o-mini` |
| Mistral | `mistral` | `codestral-latest` |
| Perplexity | `perplexity` | `sonar` |
| Ollama (local) | `ollama` | `llama3` |
| vLLM / LM Studio (local) | `local` | `default` |

Subscription-plan presets (`glm-coding`, `qwen-coding`, `doubao-coding`, `minimax-token`) — see the warning block above for their endpoints, keys and ToS risks.

Any other OpenAI-compatible endpoint works via explicit `llm_endpoint` (always takes highest precedence).

## Configuration (`.github/inori.yml`)

In addition to Action workflow inputs, you can manage review settings, ignored paths, and team coding guidelines in `.github/inori.yml` (or `.github/inori.yaml`) in your repository:

```yaml
# .github/inori.yml
provider: qwen               # Auto-configures endpoint & coding model (deepseek | zhipu | qwen | openai | ...)
coding_plan: true            # Include step-by-step fix code snippets in findings (default: true)
language: zh
on_update: resolve          # replace | resolve | keep (default: replace)
skip_draft: true            # skip review when PR is a draft (default: true)
ignore_bots: true           # skip review for bot-created PRs (default: true)
ignore_patterns:            # additional glob patterns (merged with built-in ignores)
  - "*.generated.ts"
  - "fixtures/**"
paths_ignore:               # skip the WHOLE review when ALL changed files match
  - ".github/**"
  - "docs/**"
custom_instructions: |
  1. 所有前端组件禁止内联样式，统一使用 Tailwind CSS。
  2. 新增导出函数与接口必须附带完整 TSDoc 注释。
  3. 涉及金额与数量的计算必须使用 Decimal 库，严禁使用原生浮点数。
```

**Precedence**: Action workflow inputs (`with:`) > `.github/inori.yml` > Built-in defaults.

### Built-in Ignored Files

Inori automatically ignores common non-reviewable files by default (no need to repeat them in `ignore_patterns`):
- **Lockfiles**: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `go.sum`, `Cargo.lock`, `poetry.lock`, `composer.lock`
- **Minified code & maps**: `*.min.js`, `*.min.css`, `*.map`
- **Vector assets**: `*.svg`
- **Release manifests & changelogs**: `CHANGELOG.md`, `.release-please-manifest.json`

## Inputs

| Input | Description | Required | Default |
|-------|-------------|:--------:|---------|
| `provider` | Provider preset name (`deepseek`, `zhipu`, `qwen`, `siliconflow`, `openai`, `kimi`, `anthropic`, `groq`, etc.). Auto-fills endpoint & model. | — | `deepseek` |
| `llm_model` | Model name (optional, auto-inferred from provider preset or model name pattern, e.g. `gpt-4o`, `glm-4.7-flash`) | — | Auto-inferred |
| `llm_endpoint` | Custom OpenAI-compatible API base URL (optional, auto-inferred when omitted) | — | Auto-inferred |
| `llm_api_key` | API key for the LLM provider | ✅ | — |
| `coding_plan` | Whether to generate actionable fix steps and code suggestions for issues | — | `true` |
| `github_token` | GitHub token with `pull-requests:write`. Defaults to the workflow token. | — | `${{ github.token }}` |
| `language` | Output language for review comments: `zh` \| `en` | — | `zh` |
| `ignore_patterns` | Comma-separated globs of extra files to skip (in addition to built-in ignore rules) | — | — |
| `paths_ignore` | Globs; when **all** changed files in a push match, the review is skipped entirely (pure CI/docs-only changes). Unlike `ignore_patterns`, which only removes files from the review context. | — | — |
| `max_diff_chars` | Character limit before diff is safely truncated at file boundaries | — | `40000` |
| `max_body_chars` | Character limit for the review body (GitHub caps at 65536) | — | `60000` |
| `custom_instructions` | Extra review rules appended to the prompt (team conventions, banned APIs, etc.) | — | — |
| `on_update` | How to handle previous comments on re-review: `replace` (delete old), `resolve` (resolve threads via GraphQL), `keep` | — | `replace` |
| `skip_draft` | Skip review when PR is in draft status | — | `true` |
| `ignore_bots` | Skip review for bot-created PRs (official bot accounts: `*[bot]` login suffix or `type: Bot`; other automation accounts → `ignore_authors`) | — | `true` |
| `ignore_authors` | Comma-separated PR author usernames to skip | — | — |
| `keep_previous_comments` | Legacy switch: whether to keep previous comments (alias for `on_update: keep`) | — | `false` |
## How it works

1. **Smart early exits**: Evaluates PR metadata to skip execution for drafts (`skip_draft: true`), bot PRs (`ignore_bots: true`), or designated authors (`ignore_authors`), saving API budget. Add `ready_for_review` to your `pull_request` trigger types so draft PRs get reviewed once marked ready.
2. **Safe diff preprocessing**: Changed files are filtered against built-in and custom ignore patterns. When the total diff exceeds `max_diff_chars`, truncation cuts at clean per-file boundaries to preserve syntactic integrity and prevent LLM syntax hallucinations. If all changes are ignored (diff is empty), the action exits cleanly.
3. **Prompt discipline & injection safety**: The prompt enforces four strict review disciplines (strict bar for reporting, explicit exclusion of defensive over-engineering, verbatim quoting verification, and objective severity calibration) alongside anti-injection defenses.
4. **Inline validation**: Findings with valid line numbers matching `+` added diff lines are posted as inline comments; invalid anchors safely fall back to the summary.
5. **Re-review lifecycle (`on_update`)**:
   - `replace` (default): Stale Inori inline comments are deleted (threads with user replies are always preserved) and summary is updated in place.
   - `resolve`: Stale Inori review threads are marked as **Resolved** via the GitHub GraphQL API, keeping a clean view while preserving audit history.
   - `keep`: Stale inline comments are left intact on the diff (the summary review is still updated in place).

## Data privacy

The PR diff is sent **as-is** to the LLM endpoint you configure. No third party beyond your chosen LLM provider sees your code. Review the data-handling practices of your provider before enabling Inori on private repositories.
## License

[MIT](LICENSE)

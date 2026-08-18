# Inori

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

AI code review for pull requests — works with **any OpenAI-compatible LLM endpoint**.

Inori reviews your PR diff and posts findings as **inline comments anchored to real diff lines** (plus a summary comment). It runs entirely inside your GitHub Actions on the LLM provider you configure — no third-party SaaS sees your code, and you bring your own API key.

## Why Inori

- **Any OpenAI-compatible endpoint.** DeepSeek, Moonshot (Kimi), GLM, Qwen, local Ollama, or OpenAI itself — if it speaks the `/chat/completions` API, Inori works with it.
- **Inline comments on real lines.** Every comment's line number is validated against the actual diff before posting; comments that don't land on a real added line fall back to the summary instead of dangling.
- **Review discipline & convergence.** Built-in strict review constraints prevent LLMs from degenerating into "defensive exhaustion" during multi-round re-reviews — focuses on real defects, bans unprompted defensive boilerplate suggestions, mandates verbatim quoting, and calibrates severities objectively.
- **Smart re-reviews (`on_update`).** Configurable handling of previous review comments (`replace` to delete stale ones, `resolve` to automatically resolve threads via GraphQL, or `keep` to retain history) without messy duplicate stacking.
- **Smart early exit & safety.** Automatically skips draft PRs, bot PRs (`dependabot`, `renovate`, `release-please`), and empty diffs to eliminate wasted API calls. Diffs are safely truncated on file boundaries (`diff --git`) to prevent LLM hallucinations from split code blocks.
- **Repository configuration (`.github/inori.yml`).** Manage review settings, ignore rules, and team coding guidelines directly in your codebase with version control.

## Quick start

1. Add your LLM API key as a repository secret (e.g. `DEEPSEEK_API_KEY`) under **Settings → Secrets and variables → Actions**.

2. Create `.github/workflows/inori.yml` in your repo:

```yaml
name: Inori Review

on:
  pull_request:
    types: [opened, reopened, synchronize]

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
      - uses: VOD-Studio/inori@v0.1.0
        with:
          llm_endpoint: https://api.deepseek.com/v1
          llm_model: deepseek-chat
          llm_api_key: ${{ secrets.DEEPSEEK_API_KEY }}
```

3. Open a PR. Inori reviews it automatically.

> Using a different provider? Just change `llm_endpoint` and `llm_model`:
> - Moonshot (Kimi): `https://api.moonshot.cn/v1` / `moonshot-v1-8k`
> - GLM: `https://open.bigmodel.cn/api/paas/v4` / `glm-4-flash`
> - OpenAI: `https://api.openai.com/v1` / `gpt-4o-mini`
> - Local Ollama: `http://host:11434/v1` / `llama3`

## Configuration (`.github/inori.yml`)

In addition to Action workflow inputs, you can manage review settings, ignored paths, and team coding guidelines in `.github/inori.yml` (or `.github/inori.yaml`) in your repository:

```yaml
# .github/inori.yml
language: zh
on_update: resolve          # replace | resolve | keep (default: replace)
skip_draft: true            # skip review when PR is a draft (default: true)
ignore_bots: true           # skip review for bot-created PRs (default: true)
ignore_authors:             # skip specific usernames
  - "release-bot"
ignore_patterns:            # additional glob patterns (merged with built-in ignores)
  - "*.generated.ts"
  - "fixtures/**"
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
| `llm_endpoint` | OpenAI-compatible API base URL | ✅ | — |
| `llm_model` | Model name (used for the API call and shown in the review title) | ✅ | — |
| `llm_api_key` | API key for the LLM endpoint | ✅ | — |
| `github_token` | GitHub token with `pull-requests:write`. Defaults to the workflow token. | — | `${{ github.token }}` |
| `language` | Output language for review comments: `zh` \| `en` | — | `zh` |
| `ignore_patterns` | Comma-separated globs of extra files to skip (in addition to built-in ignore rules) | — | — |
| `max_diff_chars` | Character limit before diff is safely truncated at file boundaries | — | `40000` |
| `max_body_chars` | Character limit for the review body (GitHub caps at 65536) | — | `60000` |
| `custom_instructions` | Extra review rules appended to the prompt (team conventions, banned APIs, etc.) | — | — |
| `on_update` | How to handle previous comments on re-review: `replace` (delete old), `resolve` (resolve threads via GraphQL), `keep` | — | `replace` |
| `skip_draft` | Skip review when PR is in draft status | — | `true` |
| `ignore_bots` | Skip review for bot-created PRs (e.g. dependabot, renovate, release-please) | — | `true` |
| `ignore_authors` | Comma-separated PR author usernames to skip | — | — |
| `keep_previous_comments` | Legacy switch: whether to keep previous comments (alias for `on_update: keep`) | — | `false` |

## How it works

1. **Smart early exits**: Evaluates PR metadata to skip execution for drafts (`skip_draft: true`), bot PRs (`ignore_bots: true`), or designated authors (`ignore_authors`), saving API budget.
2. **Safe diff preprocessing**: Changed files are filtered against built-in and custom ignore patterns. When the total diff exceeds `max_diff_chars`, truncation cuts at clean file boundaries to preserve syntactic integrity and prevent LLM syntax hallucinations. If all changes are ignored (diff is empty), the action exits cleanly.
3. **Prompt discipline & injection safety**: The prompt enforces four strict review disciplines (strict bar for reporting, explicit exclusion of defensive over-engineering, verbatim quoting verification, and objective severity calibration) alongside anti-injection defenses.
4. **Inline validation**: Findings with valid line numbers matching `+` added diff lines are posted as inline comments; invalid anchors safely fall back to the summary.
5. **Re-review lifecycle (`on_update`)**:
   - `replace` (default): Stale Inori inline comments are deleted (threads with user replies are always preserved) and summary is updated in place.
   - `resolve`: Stale Inori review threads are marked as **Resolved** via the GitHub GraphQL API, keeping a clean view while preserving audit history.
   - `keep`: Stale comments are left intact on the diff.

## Data privacy

The PR diff is sent **as-is** to the LLM endpoint you configure. No third party beyond your chosen LLM provider sees your code. Review the data-handling practices of your provider before enabling Inori on private repositories.
## License

[MIT](LICENSE)

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
- **Preserved review records.** Each run creates a summary tied to its commit. Previous inline comments are cleaned up according to `on_update` only after complete delivery; failed or incomplete reviews preserve earlier findings.
- **Visible coverage.** A strict diff character budget includes whole files and reports omissions, unavailable patches, and API file gaps. Action outputs and the job summary distinguish completed, partial, skipped, stale, and failed runs.
- **Trusted repository configuration (`.github/inori.yml`).** Review settings, provider preferences, and team rules are read from the event’s fixed base SHA, without checking out PR code.

## Quick start

> **Pending release:** The changes described here are not yet available through the published `@v0`. Checkout-free execution, trusted base-SHA configuration, and the new outputs take effect after a later Release updates `@v0`. Until then, retain an `actions/checkout` step when using repository configuration with the currently published version; the example below describes the upcoming behavior.

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
      - uses: VOD-Studio/inori@v0
        id: review
        with:
          provider: deepseek             # Auto-detects endpoint & model; or pass `llm_model: gpt-4o`, etc.
          llm_api_key: ${{ secrets.DEEPSEEK_API_KEY }}
```

3. Open a PR. Inori reviews it automatically.

No `actions/checkout` is needed: Inori reads the diff and base-SHA configuration through the GitHub API, so `contents: read` is still required. Ordinary fork PRs generally cannot access repository secrets and have a read-only workflow token. This example assumes a PR execution context with the required credentials and write permission; it does not implement privileged fork reviews.

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
ignore_commit_prefixes:    # skip when ALL commit subjects match (Conventional Commits)
  - "ci:"
  - "docs:"
  - "chore:"
custom_instructions: |
  1. 所有前端组件禁止内联样式，统一使用 Tailwind CSS。
  2. 新增导出函数与接口必须附带完整 TSDoc 注释。
  3. 涉及金额与数量的计算必须使用 Decimal 库，严禁使用原生浮点数。
```

**Precedence**: Action workflow inputs (`with:`) > `.github/inori.yml` > Built-in defaults.

Configuration is read from the PR event’s `base.sha`, trying `.github/inori.yml` first and `.github/inori.yaml` only when the former is absent. The checked-out workspace is never read: PR configuration changes take effect after merging, when a later base SHA includes them. If neither file exists, defaults apply; empty or comment-only files also allow defaults. Read errors, malformed YAML, invalid field types, and invalid enum values fail the run instead of silently falling back. Character budgets must be positive integers, and `max_body_chars` must not exceed `65536`.

Keys are selected from `llm_api_key`, the resolved provider’s environment variable, then `LLM_API_KEY`. Only the default DeepSeek route may use the default `DEEPSEEK_API_KEY`; custom endpoints without a resolved provider require explicit `llm_api_key` or `LLM_API_KEY`, with no fallback to another provider’s credentials. A custom proxy with a specified provider may still use that provider’s environment key.

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
| `github_token` | GitHub token with `contents:read` and `pull-requests:write`; `resolve` additionally requires `contents:write` due to GitHub GraphQL permission mapping. Defaults to the workflow token. | — | `${{ github.token }}` |
| `language` | Output language for review comments: `zh` \| `en` | — | `zh` |
| `ignore_patterns` | Comma-separated globs of extra files to skip (in addition to built-in ignore rules) | — | — |
| `paths_ignore` | Globs; when **all** changed files in a push match, the review is skipped entirely (pure CI/docs-only changes). Unlike `ignore_patterns`, which only removes files from the review context. | — | — |
| `ignore_commit_prefixes` | Commit subject prefixes; when **all** commits in the PR match, skip the review (Conventional Commits semantics: no code change). Mixed PRs are still reviewed. | — | — |
| `max_diff_chars` | Hard diff character budget; omit whole files that do not fit and try subsequent files | — | `40000` |
| `max_body_chars` | Hard review-body character limit including coverage and marker; exceeding it fails instead of truncating findings (maximum 65536) | — | `60000` |
| `custom_instructions` | Extra review rules appended to the prompt (team conventions, banned APIs, etc.) | — | — |
| `on_update` | How to handle previous comments on re-review: `replace` (delete old), `resolve` (resolve threads via GraphQL), `keep` | — | `replace` |
| `skip_draft` | Skip review when PR is in draft status | — | `true` |
| `ignore_bots` | Skip review for bot-created PRs (official bot accounts: `*[bot]` login suffix or `type: Bot`; other automation accounts → `ignore_authors`) | — | `true` |
| `ignore_authors` | Comma-separated PR author usernames to skip | — | — |
| `keep_previous_comments` | Legacy switch: whether to keep previous comments (alias for `on_update: keep`) | — | `false` |

## Outputs and run status

Every run attempts to write the following Action outputs and a GitHub Actions job summary. `completed` means the process completed, **not that there were no findings**. Inori continues to submit COMMENT reviews; it does not approve PRs, request changes, or enforce a severity gate.

| Output | Meaning |
|---|---|
| `status` | `completed` / `partial` / `skipped` / `stale` / `failed`, defined below |
| `head_sha` | PR head SHA associated with this run |
| `findings_count` | Number of structurally validated findings, not necessarily the number published |
| `reviewed_files` | Number of files covered by a valid completed model response; publication can still fail |
| `omitted_files` | Files omitted by budget, unavailable patches, or API limits; excludes files ignored by rules |
| `reason` | Explanation of the run status |

| Status | Meaning |
|---|---|
| `completed` | Available changes within the configured scope were reviewed and delivered completely; inspect `findings_count` for findings |
| `partial` | Coverage is incomplete, or inline delivery fell back to the summary; when no diff is available, no review comment may have been published |
| `skipped` | Draft, author, commit-prefix, or path rules matched, or all files were ignored; no model call |
| `stale` | PR head or base changed and publication stopped |
| `failed` | Configuration, API, model response, body budget, or publication failed; the Action fails and retains previous comments; publication failures may leave some new comments |

For example, read the result after the `id: review` step above. `if: always()` also runs this step after failures:

```yaml
      - name: Inspect review outcome
        if: always()
        env:
          REVIEW_STATUS: ${{ steps.review.outputs.status }}
          REVIEW_FINDINGS: ${{ steps.review.outputs.findings_count }}
          REVIEW_OMITTED: ${{ steps.review.outputs.omitted_files }}
        run: printf 'status=%s findings=%s omitted=%s\n' "$REVIEW_STATUS" "$REVIEW_FINDINGS" "$REVIEW_OMITTED"
```

## How it works

1. **Trusted snapshot and configuration**: Validate the event’s head/base SHA and load configuration from the fixed base SHA. Check the snapshot before and after fetching the diff and again before publishing. A changed snapshot stops the run, avoiding publication of current diff findings against an old commit.
2. **Rules and budget**: Drafts, bots, specified authors, and configurable commit/path rules can skip review. Keep `ready_for_review` in your trigger types. The `max_diff_chars` budget admits complete file blocks; files that do not fit are omitted while later smaller files are still considered, without splitting hunks. The summary reports reviewed, ignored, budget-omitted, unavailable-patch, and API-missing file counts plus omission lists. GitHub’s file list returns at most 3000 files; differences from the PR’s total file count are reported as missing coverage. An unavailable patch is not a clean bill of health.
3. **Response validation**: The prompt asks for real defects and accurate quotes and treats instructions inside diffs as untrusted data; these rules cannot guarantee resistance to prompt injection. Empty responses, invalid JSON, invalid field types, and explicitly unfinished responses fail instead of producing “no issues.” HTTP calls have timeouts and bounded retries; compatible endpoints that omit `finish_reason` still undergo body validation.
4. **Complete delivery**: Findings on valid added lines become inline comments; others go into the summary. A body exceeding `max_body_chars` fails and preserves history instead of truncating findings. Failed inline findings are included in full in the summary; long delivery fallback content is split across summary reviews. Cleanup is considered only after every summary is published.
5. **Re-reviews (`on_update`)**: Every run creates a new summary tied to its SHA and retains earlier summaries instead of updating them in place. Only complete coverage with successful inline and summary delivery permits cleanup of comments captured before publication and owned by the same publisher. `replace` deletes unreplied old comments; `resolve` resolves unreplied old threads; `keep` retains them. Incomplete coverage or inline fallback forces history preservation; discussions with human replies remain untouched. Cleanup failures produce warnings without discarding the new review.

### GitHub permissions for re-review cleanup

Reading trusted configuration and publishing reviews requires:

```yaml
permissions:
  contents: read
  pull-requests: write
```

`on_update: resolve` additionally calls GitHub's GraphQL `resolveReviewThread` mutation. GitHub currently rejects that mutation unless the token also has `contents: write`, even though resolving a thread changes PR conversation metadata rather than repository files:

```yaml
permissions:
  contents: write
  pull-requests: write
```

`contents: write` allows the workflow token to push repository contents. Use `resolve` only when retaining Resolved thread history is important. Otherwise, prefer the default `replace`, whose deletion operation only needs `pull-requests: write`; reading trusted configuration still requires `contents: read`. Use a repository-scoped GitHub App token rather than a broad personal token when `resolve` is required. Cleanup happens after publishing the new review; failures produce warnings and the job can still succeed.

This GitHub permission behavior is documented in [GitHub Community Discussion #204269](https://github.com/orgs/community/discussions/204269).

## Development and releases

CI reuses `verify.yml` for lint, type checking, tests, build, and dist consistency. Release candidates are verified at the merged release PR’s fixed SHA before publication. Existing-release major-tag recovery has a separate verification path; a historical recovery failure does not block new candidate publication. Release PR maintenance runs independently. All three paths are restricted to main, with write permissions scoped to each job.

Major tags only advance to a SHA verified by the relevant path; other targets, including concurrent new releases, are skipped with a warning for a later run. Repository branch protection, required checks, and squash-only merging still require administrator configuration; these workflows do not set them. See the [project roadmap](docs/ROADMAP.md) for design decisions and future work.

## Data privacy

The PR diff is sent **as-is** to the LLM endpoint you configure. No third party beyond your chosen LLM provider sees your code. Review the data-handling practices of your provider before enabling Inori on private repositories.

## License

[MIT](LICENSE)

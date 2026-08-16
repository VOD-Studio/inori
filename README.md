# Inori

AI code review for pull requests — works with **any OpenAI-compatible LLM endpoint**.

Inori reviews your PR diff and posts findings as **inline comments anchored to real diff lines** (plus a summary comment). It runs entirely inside your GitHub Actions on the LLM provider you configure — no third-party SaaS sees your code, and you bring your own API key.

## Why Inori

- **Any OpenAI-compatible endpoint.** DeepSeek, Moonshot (Kimi), GLM, Qwen, local Ollama, or OpenAI itself — if it speaks the `/chat/completions` API, Inori works with it.
- **Inline comments on real lines.** Every comment's line number is validated against the actual diff before posting; comments that don't land on a real added line fall back to the summary instead of dangling.
- **Idempotent re-reviews.** Each push re-reviews the PR and replaces Inori's previous feedback — stale inline comments are deleted and the summary review is updated in place — instead of stacking duplicates.
- **Native GitHub Action.** Built on Node 24 with the official `@actions/*` SDK — a single self-contained `dist/index.js`, no runtime install step on the runner.
- **Bring your own key.** No per-seat subscription; you pay your LLM provider directly.

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

## Inputs

| Input | Description | Required | Default |
|-------|-------------|:--------:|---------|
| `llm_endpoint` | OpenAI-compatible API base URL | ✅ | — |
| `llm_model` | Model name (used for the API call and shown in the review title) | ✅ | — |
| `llm_api_key` | API key for the LLM endpoint | ✅ | — |
| `github_token` | GitHub token with `pull-requests:write` | — | `${{ github.token }}` |
| `language` | Output language for review comments: `zh` \| `en` | — | `zh` |
| `ignore_patterns` | Comma-separated globs of files to skip | — | `pnpm-lock.yaml,go.sum,package-lock.json,yarn.lock,CHANGELOG.md` |
| `max_diff_chars` | Character limit before the diff is truncated | — | `40000` |
| `max_body_chars` | Character limit for the review body (GitHub caps at 65536) | — | `60000` |
| `custom_instructions` | Extra review rules appended to the prompt (team conventions, banned APIs, etc.) | — | — |

## How it works

1. Fetches the PR's changed files via the GitHub API (paginated — handles PRs with 100+ files).
2. Builds a diff, skipping files matching `ignore_patterns`. Large diffs are truncated to `max_diff_chars`.
3. Sends the diff to your LLM with a structured prompt that asks for strict JSON output and includes a prompt-injection guard (diff content is treated as untrusted data).
4. Parses the JSON response. Findings with a valid line number (one that matches a real `+` added line in the diff) become inline comments; the rest go into the summary.
5. Replaces the previous Inori feedback: stale inline comments (identified by a hidden marker embedded in each body) are deleted — except threads someone has replied to — and the summary review body is updated in place. GitHub's REST API can't delete submitted reviews, so Inori reuses a single review per PR instead of stacking new ones.

When the diff is truncated, inline anchoring is disabled entirely — all findings go into the summary to avoid comments landing on lines the model never saw.

## Data privacy

The PR diff is sent **as-is** to the LLM endpoint you configure. No third party beyond your chosen LLM provider sees your code. Review the data-handling practices of your provider before enabling Inori on private repositories.

## License

[MIT](LICENSE)

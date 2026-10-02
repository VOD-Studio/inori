# inori

AI PR 代码评审 GitHub Action：任意 OpenAI 兼容端点，评审意见锚定真实 diff 行。
TypeScript 单包项目，`@vercel/ncc` 打包为自包含的 `dist/index.js`。

## 架构

- **`src/config/`** 输入解析与配置合并（action input > `.github/inori.yml` > 默认值）。
- **`src/core/`** 纯逻辑：diff 处理、prompt 构造、评审解析、跳过判定。零 `@actions/core` 依赖，可被 vitest 直接 import。
- **`src/github/`** GitHub API 适配：diff 拉取、分页、评审发布。
- **`src/llm/`** provider 预设（`providers.ts`）与 LLM 调用。
- **`src/index.ts`** 仅启动入口；**`src/run.ts`** 编排可信配置、快照校验、评审发布与运行状态，业务逻辑下沉到上述模块。

原则：**纯逻辑不 import `@actions/core`**——测试必须 import 真实源码而非复制逻辑，
复制时偷偷加的守护会让真实代码失去保护（历史上 null 元素崩溃 bug 因此潜伏）。

## 开发命令

使用 **`pnpm`**（切勿 npm/yarn）。Node **24**（与 action.yml `using: node24`、
`@types/node` major 三处保持一致，升级时三处同步改）。

- `pnpm lint` — biome check（lint + format + import 排序）
- `pnpm typecheck` — tsc --noEmit
- `pnpm test` — vitest
- `pnpm build` — ncc 打包到 dist/

## 铁律

1. **dist/ 必须与 src/ 同步提交**。runner 直接执行仓库里的 `dist/index.js`（不跑
   install/build），改了 src 忘记 `pnpm build` 并提交 dist 是本项目头号 bug 来源。
   CI 会校验，本地提交前自查：`pnpm build && git status --porcelain dist` 应为空。
2. **node 版本三处一致**：action.yml `using:`、CI `node-version:`、`@types/node`
   major。改任意一处，检查另外两处。
3. **模型返回的 JSON 字段类型不可信**。解析模型输出时，`r.field.method()` 形式
   的访问必须有 `typeof === 'string'` 守护——类型漂移（对象/数字）和 null 一样
   是崩溃源（已两次踩坑）。
4. **provider 预设值必须官方文档实证**，禁止照单接受 AI 生成值。验证渠道优先级：
   官方 llms.txt > 官方模型列表页 > OpenRouter 公开 `/api/v1/models` > 无 key GET
   探测（405 = 路径存在；POST 404 可能是模型不存在的业务错误，不能判端点死）。
   网络不通就标注「未验证」，不猜测。验证矩阵维护在 `src/llm/providers.ts` 头部注释。
5. **双语 README 对称**：改 README.md 必须同步 README.zh-CN.md，提交前 diff 两边
   确认无丢行（中文版曾丢过 `- uses:` 关键行）。

## provider 预设约定

- 显示名 `name` 用社区通称的模型品牌名（Qwen/GLM/Kimi/Doubao/ERNIE/Claude），
  不带公司名或括号副标；聚合平台（OpenRouter/Groq/SiliconFlow/Ollama）用平台名。
- `id` 是机器路由键，保持稳定不改。
- `modelPatterns` 防两类坑：跨版本漏配（`/^qwen-/` 匹配不到 `qwen3-max`，数字紧跟
  无连字符）与跨 provider 抢匹配（放宽 `/^qwen/` 会抢走聚合平台的仓库式命名
  `Qwen/Qwen2.5-...`，需负向断言 `qwen(?!\/)`）。改 pattern 必须测最新代次模型名。
- 订阅套餐（qwen-coding 等 4 家）key/端点与按量计费不互通，`modelPatterns` 留空
  只能显式指定；各家 ToS 禁止套餐 key 用于 API 自动化，CI 场景有封 key 风险，
  README 已警示。

## 分支命名

从 `main` 新建分支完成，不在 main 上直接开发。格式 `<type>/<scope>-<简述>`，
type 对齐 Conventional Commits（feat/fix/chore/docs/refactor/style/test/perf/hotfix），
全小写连字符连接，简述用英文短词。例：`feat/providers-gemini`、`fix/prompt-encoding`。

## 提交流程规范

- 每完成一个任务或功能点即提交。提交信息用**中文**，严格符合 Conventional Commits
  （`feat(llm): 添加新预设`、`fix(core): 修复解析崩溃`）。
- **subject 只概括一个主要变更**，祈使句简洁。一个 commit 含多个独立变更时拆分，
  禁止用 `+` / `、` 堆砌多要点（写不下说明改动太杂，回归原子性三问）。
- **scope 指向最小改动单元**：`config` / `core` / `github` / `llm` / `ci` / `readme` /
  `deps`。去掉某段仍能准确定位位置时，那段就是冗余前缀。
- **body 用 bullet points 列改动事实**，不写散文；决策过程写 PR 描述。
- **请勿推送**，仅在本地 commit。

### 原子性

通用判据（三问 + 反对过度拆分）见
[VOD-Studio/kite AGENTS.md](https://github.com/VOD-Studio/kite/blob/main/AGENTS.md)
「原子性」章节，组织内共用同一套实践，不在此复制（单一真相，避免双份漂移）。

本项目特有：**src 改动与 dist 重建同一提交**（dist 是 src 的编译产物，拆开会有
中间提交 dist 过期）。测试与实现同一提交；CHANGELOG 由 release-please 自动生成，
不手写。

## 代码注释规范

注释只写代码无法自表达的信息，复述签名就是噪音：
- ❌ 设计论证/历史决策塞注释（属 PR 描述）；✅ 非显然陷阱（`// 返回 error 而非
  throw：外层有 cleanup defer，throw 会跳过`）。
- ❌ 过期注释指向已删除符号——重构搬代码时同步改指向，拿不准就删。
- ✅ 魔法值理由（`const replyPreviewLimit = 3 // 首屏无需每条独立请求`）。

新增代码强制遵守；存量不专门清理，改到该文件时顺手清。

## PR 与发版

### PR 规范

- 开 PR 时 `gh pr create` 默认不指定 assignees/reviewers/labels（避免邮件骚扰），
  base 指向 `main`。有对应 issue 时 body 用 `Closes #N`。
- 合并：功能/修复 PR 一律 **squash**（release PR 同为 squash），合并后删除分支。
  原因：release-please 会把 merge commit（记 PR title）与分支原始 commit 各记
  一条，CHANGELOG 出现重复条目（Inori 无应用层去重兜底，与 violet 不同）；
  squash 后 main 上一个 PR 一条 Conventional Commit，changelog 粒度 = PR，
  天然无重复。

### 发版流程（release-please）

- 本轮后续 release PR 审查时核对双语 README 的「尚未发布 / Pending release」提示；在对应 Release 更新 `@v0` 时同步更新或移除，避免提示过期。

push 到 main 后，三个 main-only 链路独立运行：

- `plan → verify → publish`：只验证已合并 release PR 的固定 `merge_commit_sha`；
  pending/verified 候选整批通过后复核并加 `autorelease: verified`，再 release-only 发布。
- `recovery-plan → verify-recovery → recover`：仅验证 major 标签缺失或未对齐的最新正式
  Release 的历史 SHA，独立恢复标签；历史恢复失败不阻断新候选发布。
- `maintain`：独立 PR-only 调用维护 release PR，不依赖发布或恢复成功。

`release-please-config.json` 负责 PR，`release-please-release-config.json` 负责已验证候选；
不要合并回不经 SHA 验证的单次调用。`publish` 与 `recover` 必须各自验证成功才执行，
空矩阵跳过。版本号和 CHANGELOG 仍由 release-please 维护，写权限按各 job 实际需要授予。

major tag 对齐由 `scripts/release-gate.mjs` 完成，只推进本链路已验证的 SHA；其他目标或
并发新 Release 跳过并告警。重跑可恢复已存在 Release 的 major tag，禁止回退或跨分叉。
tag/Release/浮动 tag 全由 `release-please.yml` 收口，不依赖 `GITHUB_TOKEN` 创建 ref 后
再次触发其他 workflow。

- 发版型 commit（feat/fix/perf/refactor）触发新版本；docs/ci/chore 不触发。
- 版本号从 commit 类型推导（feat → minor，fix → patch）；需锁定时在发版型
  commit footer 加 `Release-As: vX.Y.Z`。
- **Marketplace 发布不能全自动**：Release 创建后需人工在 release 页面勾选
  Marketplace 发布（首次还需 Web UI 同意 Developer Agreement）。

### CI 与 AI 评审

- `ci.yml` 调用 `verify.yml`：lint → typecheck → test → build → dist 一致性校验；发布也复用它验证准确 SHA。失败会标红，实际阻断合并仍需远端 main 保护和必需检查配置。依赖审计暂为 advisory。
- `ai-review.yml`：本仓库自 dogfood——用 inori 评审 inori 的 PR（`@main`），
  辅助人工 review，非门禁。需在 Settings → Secrets 配置 `DEEPSEEK_API_KEY`。

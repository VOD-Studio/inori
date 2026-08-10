// 核心纯函数自测：addedLines / isIgnored / parseReviews
// 这些函数无 IO 副作用，测试逻辑边界

const { minimatch } = require("minimatch");

// ── 复制 index.ts 的纯函数逻辑（保持同步）──
const IGNORE_PATTERNS = ["pnpm-lock.yaml", "go.sum", "*.md"];

function isIgnored(path) {
  return IGNORE_PATTERNS.some(
    (p) => path === p || minimatch(path, p) || minimatch(path, `**/${p}`)
  );
}

function addedLines(patch) {
  const lines = new Set();
  let cur = null;
  for (const line of patch.split("\n")) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) { cur = parseInt(m[1], 10); continue; }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+") && cur !== null) { lines.add(cur); cur += 1; }
    else if (line.startsWith("-")) { continue; }
    else if (!line.startsWith("\\") && cur !== null) { cur += 1; }
  }
  return lines;
}

function parseReviews(content, fileLines) {
  let parsed;
  try { parsed = JSON.parse(content); }
  catch { return { summary: content, inlines: [], bodyItems: [] }; }
  const summary = parsed.summary ?? "";
  const rawReviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];
  const inlines = [], bodyItems = [];
  for (const r of rawReviews) {
    if (typeof r !== "object" || r === null) continue;
    const comment = r.comment ?? ""; if (!comment) continue;
    const text = r.severity ? `**[${r.severity}]** ${comment}` : comment;
    const path = r.path ?? "";
    if (r.line && path && fileLines.has(path) && fileLines.get(path).has(r.line)) {
      inlines.push({ path, line: r.line, body: text });
    } else { bodyItems.push(path ? `- ${text}（${path}）` : `- ${text}`); }
  }
  return { summary, inlines, bodyItems };
}

// ── 测试 ──
let pass = 0, fail = 0;
function check(name, cond) {
  console.log(`  [${cond ? "✅" : "❌"}] ${name}`);
  cond ? pass++ : fail++;
}

// addedLines
const al1 = addedLines("@@ -1,3 +1,5 @@\n unchanged\n-old line\n+new line 1\n+new line 2\n ctx");
check("addedLines 基本用例：行2和行3为新增", al1.size === 2 && al1.has(2) && al1.has(3));

const al2 = addedLines("@@ -1,1 +10,2 @@\n+++ b/foo.py\n+real add");
check("addedLines 跳过 +++ 文件头", al2.size === 1 && al2.has(10));

// isIgnored
check("isIgnored 根目录 pnpm-lock.yaml", isIgnored("pnpm-lock.yaml"));
check("isIgnored 子目录 packages/x/pnpm-lock.yaml", isIgnored("packages/x/pnpm-lock.yaml"));
check("isIgnored 不匹配 src/index.ts", !isIgnored("src/index.ts"));
check("isIgnored glob *.md 匹配 README.md", isIgnored("README.md"));
check("isIgnored glob *.md 匹配子目录 docs/x.md", isIgnored("docs/x.md"));

// parseReviews（复现 Python 版修复的所有边界 bug）
const fl = new Map([["a.ts", new Set([5, 10])]]);

const r1 = parseReviews('{"summary":"s","reviews":null}', fl);
check("parseReviews reviews=null 不崩溃", r1.summary === "s" && r1.inlines.length === 0);

const r2 = parseReviews('{"summary":"s","reviews":[123,"x",null]}', fl);
check("parseReviews 非对象元素跳过", r2.inlines.length === 0 && r2.bodyItems.length === 0);

const r3 = parseReviews('{"summary":"ok","reviews":[{"path":"a.ts","line":5,"severity":"严重","comment":"bug"}]}', fl);
check("parseReviews 有效 inline（行5在fileLines）", r3.inlines.length === 1 && r3.inlines[0].line === 5);

const r4 = parseReviews('{"summary":"ok","reviews":[{"path":"a.ts","line":999,"comment":"bug"}]}', fl);
check("parseReviews 行号无效降级 body", r4.inlines.length === 0 && r4.bodyItems.length === 1);

const r5 = parseReviews("not json", fl);
check("parseReviews 非 JSON 返回原文", r5.summary === "not json");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

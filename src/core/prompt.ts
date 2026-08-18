import { t, type Lang } from "./i18n";

/** 构造评审 prompt：系统角色 + JSON 格式约束 + 可选自定义规则 + diff 数据 */
export function buildPrompt(diff: string, lang: Lang, customInstructions = ""): string {
  const table = t(lang);
  const fmt =
    `{"summary": "one-sentence overall conclusion", ` +
    `"reviews": [{"path": "relative file path", ` +
    `"line": added line number, "severity": "${table.severities}", ` +
    `"comment": "issue and suggestion"}]}\n`;
  const rules =
    "line must be the target-file line number of a + added line in the diff; " +
    "omit line when unsure.\n" +
    "If there are no issues, reviews is an empty array.\n";
  const custom = customInstructions.trim()
    ? `\n${table.customIntro}\n${customInstructions.trim()}\n`
    : "";
  return table.promptIntro + fmt + rules + table.langHint + custom + `\n\n${table.diffIntro}\n\n${diff}`;
}

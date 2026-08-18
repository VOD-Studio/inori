import { type Lang, t } from './i18n'

/** 构造评审 prompt：系统角色 + JSON 格式约束 + Coding Plan 引导 + 可选自定义规则 + diff 数据 */
export function buildPrompt(
  diff: string,
  lang: Lang,
  customInstructions = '',
  enableCodingPlan = true,
): string {
  const table = t(lang)
  const planFmt = enableCodingPlan ? `, "coding_plan": "concise fix steps and code snippet"` : ''
  const planRule = enableCodingPlan
    ? 'Include an actionable coding_plan with concrete steps/code whenever a fix exists.\n'
    : ''
  const fmt =
    `{"summary": "one-sentence overall conclusion", ` +
    `"reviews": [{"path": "relative file path", ` +
    `"line": added line number, "severity": "${table.severities}", ` +
    `"comment": "issue description"${planFmt}}]}\n`
  const rules =
    'line must be the target-file line number of a + added line in the diff; ' +
    'omit line when unsure.\n' +
    planRule +
    'If there are no issues, reviews is an empty array.\n'
  const custom = customInstructions.trim()
    ? `\n${table.customIntro}\n${customInstructions.trim()}\n`
    : ''
  return `${table.promptIntro + fmt + rules + table.langHint + custom}\n\n${table.diffIntro}\n\n${diff}`
}

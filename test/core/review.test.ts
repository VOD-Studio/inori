import { describe, expect, it } from 'vitest'
import {
  buildReviewBody,
  extractJson,
  parseReviews,
  REVIEW_MARKER,
  stripThink,
} from '../../src/core/review'

describe('parseReviews', () => {
  const fileLines = new Map([['a.ts', new Set([5, 10])]])

  it.each([
    'null',
    '[]',
    '[{"summary":"ok","reviews":[]}]',
    '{}',
    '{"summary":"s"}',
    '{"summary":"s","reviews":null}',
    '{"summary":"","reviews":[]}',
    '{"summary":{},"reviews":[]}',
  ])('拒绝缺失或无效的响应结构: %s', (content) => {
    expect(() => parseReviews(content, fileLines)).toThrow(/LLM 评审输出/)
  })

  it.each([
    123,
    'x',
    null,
    [],
    {},
    { comment: '' },
    { comment: '  ' },
    { comment: 42 },
    { comment: {} },
    { comment: 'bug', path: {} },
    { comment: 'bug', severity: 42 },
  ])('拒绝非法条目，不把丢失的问题报告为 clean: %j', (item) => {
    expect(() =>
      parseReviews(JSON.stringify({ summary: 's', reviews: [item] }), fileLines),
    ).toThrow(/LLM 评审条目 1/)
  })

  it('合法的空 reviews 表示评审完成且无发现', () => {
    expect(parseReviews('{"summary":"已完成评审","reviews":[]}', fileLines)).toEqual({
      summary: '已完成评审',
      inlines: [],
      bodyItems: [],
    })
  })

  it('混合合法与非法条目也拒绝整次响应', () => {
    expect(() =>
      parseReviews(
        JSON.stringify({
          summary: 's',
          reviews: [{ path: 'a.ts', line: 5, comment: 'bug' }, null],
        }),
        fileLines,
      ),
    ).toThrow(/条目 2/)
  })

  it('行号命中 fileLines 成为 inline', () => {
    const r = parseReviews(
      '{"summary":"ok","reviews":[{"path":"a.ts","line":5,"severity":"严重","comment":"bug"}]}',
      fileLines,
    )
    expect(r.inlines).toHaveLength(1)
    expect(r.inlines[0].line).toBe(5)
    expect(r.inlines[0].body).toBe('**[严重]** bug')
  })

  it('无 severity 时 body 不带标记', () => {
    const r = parseReviews(
      '{"summary":"ok","reviews":[{"path":"a.ts","line":10,"comment":"note"}]}',
      fileLines,
    )
    expect(r.inlines[0].body).toBe('note')
  })

  it('行号无效降级到 body', () => {
    const r = parseReviews(
      '{"summary":"ok","reviews":[{"path":"a.ts","line":999,"comment":"bug"}]}',
      fileLines,
    )
    expect(r.inlines).toHaveLength(0)
    expect(r.bodyItems).toHaveLength(1)
    expect(r.bodyItems[0]).toBe('- bug（a.ts）')
  })

  it('包含 coding_plan 时格式化为 Markdown 引用块', () => {
    const json = JSON.stringify({
      summary: 'ok',
      reviews: [
        {
          path: 'a.ts',
          line: 5,
          severity: '严重',
          comment: '未处理异常',
          coding_plan: '1. 增加 try catch\n2. 记录错误日志',
        },
      ],
    })
    const r = parseReviews(json, fileLines, 'zh')
    expect(r.inlines[0].body).toContain('**[严重]** 未处理异常')
    expect(r.inlines[0].body).toContain('💡 修复计划 (Coding Plan)')
    expect(r.inlines[0].body).toContain('> 1. 增加 try catch\n> 2. 记录错误日志')
  })

  it('coding_plan 类型漂移（对象/数字/数组）不崩溃，安静降级', () => {
    const json = JSON.stringify({
      summary: 'ok',
      reviews: [
        { path: 'a.ts', line: 5, comment: '问题1', coding_plan: { steps: ['s'] } },
        { path: 'a.ts', line: 5, comment: '问题2', coding_plan: 42 },
        { path: 'a.ts', line: 5, comment: '问题3', coding_plan: ['1. x'] },
      ],
    })
    expect(() => parseReviews(json, fileLines, 'zh')).not.toThrow()
    const r = parseReviews(json, fileLines, 'zh')
    expect(r.inlines).toHaveLength(3)
    expect(r.inlines.every((c) => !c.body.includes('修复计划'))).toBe(true)
  })

  it('line 为字符串时不匹配行号，安静降级到 body 清单', () => {
    const json = JSON.stringify({
      summary: 'ok',
      reviews: [{ path: 'a.ts', line: '5', comment: '问题' }],
    })
    const r = parseReviews(json, fileLines, 'zh')
    expect(r.inlines).toHaveLength(0)
    expect(r.bodyItems).toHaveLength(1)
  })
  it('非 JSON 抛出受控错误，不回显模型原文', () => {
    expect(() => parseReviews('secret not json', fileLines)).toThrow('LLM 评审输出不是有效 JSON')
  })
})

describe('parseReviews 围栏容错', () => {
  const fileLines = new Map([['a.ts', new Set([5])]])

  it('剥离 ```json 围栏后正常解析', () => {
    const content =
      '```json\n{"summary":"s","reviews":[{"path":"a.ts","line":5,"comment":"bug"}]}\n```'
    const r = parseReviews(content, fileLines)
    expect(r.summary).toBe('s')
    expect(r.inlines).toHaveLength(1)
  })

  it('无语言标记的围栏也能解析', () => {
    const r = parseReviews('```\n{"summary":"s","reviews":[]}\n```', fileLines)
    expect(r.summary).toBe('s')
  })

  it('围栏外有说明文字时提取 JSON 部分', () => {
    const r = parseReviews(
      '评审结果如下：\n```json\n{"summary":"s","reviews":[]}\n```\n以上。',
      fileLines,
    )
    expect(r.summary).toBe('s')
  })

  it('无围栏但前后有杂质时按花括号截取', () => {
    const r = parseReviews('result: {"summary":"s","reviews":[]} (end)', fileLines)
    expect(r.summary).toBe('s')
  })

  it('围栏内 JSON 损坏时拒绝输出', () => {
    expect(() => parseReviews('```json\n{broken\n```', fileLines)).toThrow(/不是有效 JSON/)
  })
})

describe('parseReviews 思维链剥离（reasoning 模型回归）', () => {
  const fileLines = new Map([['a.ts', new Set([5])]])

  // 复现 violet PR #228：MiniMax-M3 输出 <think> 内含大量代码片段与花括号，
  // 旧实现 indexOf('{') 命中 think 内的 {，JSON.parse 失败后整段思维链贴进 PR
  it('think 块含大量花括号时仍正确解析正文 JSON', () => {
    const content =
      '<think>Let me analyze this diff.\n\n' +
      'The helper creates `Array.from({ length: previewLen }, (_, i) => ({ id: `r${i}` }))`.\n' +
      'Original JSX was `<div className="group relative">`, now plain `<div>`.\n' +
      'Original check: `item.repliesTotal === undefined || (item.repliesTotal ?? 0) > 0`.\n' +
      'Logic seems equivalent. No real defects found beyond comments.\n' +
      '</think>\n\n' +
      '{"summary":"修复正确，命名组隔离了 hover 串扰","reviews":[{"path":"a.ts","line":5,"severity":"中等","comment":"外层 div 移除 relative 前建议确认回复块无绝对定位依赖"}]}'
    const r = parseReviews(content, fileLines, 'zh')
    expect(r.summary).toBe('修复正确，命名组隔离了 hover 串扰')
    expect(r.inlines).toHaveLength(1)
    expect(r.inlines[0].line).toBe(5)
    expect(r.summary).not.toContain('Let me analyze')
    expect(r.inlines[0].body).not.toContain('<think>')
  })

  it('think 与围栏叠加时逐层剥离', () => {
    const content = '<think>reasoning {fake}</think>\n```json\n{"summary":"s","reviews":[]}\n```'
    const r = parseReviews(content, fileLines)
    expect(r.summary).toBe('s')
  })

  it('think 未闭合（输出截断）时拒绝评审，不泄漏思考过程', () => {
    expect(() => parseReviews('<think>secret { more thinking', fileLines)).toThrow(
      'LLM 评审输出未完成：think 标签未闭合',
    )
  })

  it('闭合 think 后再次出现截断块也拒绝输出', () => {
    expect(() =>
      parseReviews('<think>a</think>{"summary":"s","reviews":[]}<think>secret', fileLines),
    ).toThrow(/think 标签未闭合/)
  })

  it('非 JSON 正文解析失败不回显思考或正文', () => {
    expect(() => parseReviews('<think>secret</think>private text', fileLines)).toThrow(
      'LLM 评审输出不是有效 JSON',
    )
  })
})

describe('stripThink', () => {
  it('无 think 标签时恒等（仅 trim）', () => {
    expect(stripThink('  hello  ')).toBe('hello')
    expect(stripThink('{"a":1}')).toBe('{"a":1}')
  })

  it('闭合 think 取其后正文', () => {
    expect(stripThink('<think>x</think>body')).toBe('body')
  })

  it('多个 think 块时取最后一个闭合之后（只认最终正文）', () => {
    expect(stripThink('<think>a</think>mid<think>b</think>final')).toBe('final')
  })

  it('未闭合 think 拒绝输出', () => {
    expect(() => stripThink('prefix <think>unfinished')).toThrow(/未闭合/)
    expect(() => stripThink('<think>unfinished')).toThrow(/未闭合/)
  })
})

describe('extractJson', () => {
  it('围栏与杂质剥离后返回纯 JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJson('x {"a":1} y')).toBe('{"a":1}')
  })
})

describe('buildReviewBody', () => {
  it('标题含模型名，结尾嵌隐藏标记', () => {
    const body = buildReviewBody(
      { summary: 's', bodyItems: [], model: 'deepseek-chat' },
      'zh',
      60000,
    )
    expect(body).toContain('### AI Code Review · deepseek-chat')
    expect(body).toContain('## 评审结论\ns')
    expect(body.endsWith(REVIEW_MARKER)).toBe(true)
  })

  it('bodyItems 进入其他问题清单', () => {
    const body = buildReviewBody(
      { summary: 's', bodyItems: ['- 存在问题（a.ts）'], model: 'm' },
      'zh',
      60000,
    )
    expect(body).toContain('## 其他问题\n- 存在问题（a.ts）')
  })

  it('空 summary 显示无问题文案', () => {
    const body = buildReviewBody({ summary: '', bodyItems: [], model: 'm' }, 'zh', 60000)
    expect(body).toContain('未发现明显问题')
  })

  it('完整正文含 marker 超过配置预算时拒绝发布', () => {
    expect(() =>
      buildReviewBody({ summary: 'x'.repeat(100), bodyItems: [], model: 'm' }, 'zh', 50),
    ).toThrow(/超出 max_body_chars/)
  })

  it.each(['zh', 'en'] as const)('GitHub 上限不能通过增大配置绕过: %s', (lang) => {
    expect(() =>
      buildReviewBody({ summary: 'x'.repeat(70000), bodyItems: [], model: 'm' }, lang, 100000),
    ).toThrow(/GitHub 长度限制/)
  })

  it('精确预算包括隐藏 marker', () => {
    const opts = { summary: 's', bodyItems: ['- bug'], model: 'm' }
    const body = buildReviewBody(opts, 'zh', 60000)
    expect(buildReviewBody(opts, 'zh', body.length)).toBe(body)
    expect(() => buildReviewBody(opts, 'zh', body.length - 1)).toThrow(/超出 max_body_chars/)
  })

  it('en 文案生效', () => {
    const body = buildReviewBody({ summary: '', bodyItems: [], model: 'm' }, 'en', 60000)
    expect(body).toContain('No significant issues found')
    expect(body.endsWith(REVIEW_MARKER)).toBe(true)
  })
})

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

  it('reviews=null 不崩溃', () => {
    const r = parseReviews('{"summary":"s","reviews":null}', fileLines)
    expect(r.summary).toBe('s')
    expect(r.inlines).toHaveLength(0)
  })

  it('非对象元素被跳过', () => {
    const r = parseReviews('{"summary":"s","reviews":[123,"x",null]}', fileLines)
    expect(r.inlines).toHaveLength(0)
    expect(r.bodyItems).toHaveLength(0)
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

  it('comment 为空的条目被丢弃', () => {
    const r = parseReviews(
      '{"summary":"ok","reviews":[{"path":"a.ts","line":5,"comment":""}]}',
      fileLines,
    )
    expect(r.inlines).toHaveLength(0)
    expect(r.bodyItems).toHaveLength(0)
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
  it('非 JSON 返回原文作为 summary', () => {
    const r = parseReviews('not json', fileLines)
    expect(r.summary).toBe('not json')
    expect(r.inlines).toHaveLength(0)
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
    const r = parseReviews('```\n{"summary":"s"}\n```', fileLines)
    expect(r.summary).toBe('s')
  })

  it('围栏外有说明文字时提取 JSON 部分', () => {
    const r = parseReviews('评审结果如下：\n```json\n{"summary":"s"}\n```\n以上。', fileLines)
    expect(r.summary).toBe('s')
  })

  it('无围栏但前后有杂质时按花括号截取', () => {
    const r = parseReviews('result: {"summary":"s"} (end)', fileLines)
    expect(r.summary).toBe('s')
  })

  it('围栏内 JSON 损坏时回退原文 summary', () => {
    const content = '```json\n{broken\n```'
    const r = parseReviews(content, fileLines)
    expect(r.summary).toBe(content)
    expect(r.inlines).toHaveLength(0)
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
    const content = '<think>reasoning {fake}</think>\n```json\n{"summary":"s"}\n```'
    const r = parseReviews(content, fileLines)
    expect(r.summary).toBe('s')
  })

  it('think 未闭合（输出截断）时不泄漏思考过程', () => {
    const content = '<think>Let me analyze { more thinking'
    const r = parseReviews(content, fileLines)
    expect(r.summary).toBe('')
    expect(r.inlines).toHaveLength(0)
  })

  it('非 JSON 正文解析失败时 summary 也剥掉 think', () => {
    const r = parseReviews('<think>英文推理过程</think>\n不是 JSON 的正文', fileLines)
    expect(r.summary).toBe('不是 JSON 的正文')
    expect(r.summary).not.toContain('英文推理过程')
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

  it('未闭合 think 丢弃思考段', () => {
    expect(stripThink('prefix <think>unfinished')).toBe('prefix')
    expect(stripThink('<think>unfinished')).toBe('')
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

  it('截断后仍保留截断提示与标记', () => {
    const body = buildReviewBody({ summary: 'x'.repeat(100), bodyItems: [], model: 'm' }, 'zh', 50)
    expect(body).toContain('（内容过长已截断）')
    expect(body.endsWith(REVIEW_MARKER)).toBe(true)
  })

  it('en 文案生效', () => {
    const body = buildReviewBody({ summary: '', bodyItems: [], model: 'm' }, 'en', 60000)
    expect(body).toContain('No significant issues found')
    expect(body.endsWith(REVIEW_MARKER)).toBe(true)
  })
})

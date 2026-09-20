// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom 不做排版，所以"真的跳过屏幕外内容的布局与绘制"只能在真机上量。
// 这里能守住的是另一半：这条规则确实落在**消息块**（.agent-turn）上，别被误删或挪到别处。
// 用工作目录相对路径读源文件：jsdom 环境里 import.meta.url 不是 file 协议，fileURLToPath 会报错。
const css = readFileSync(resolve(process.cwd(), 'src/styles/agent-conversation.css'), 'utf8')

function ruleBody(selector: string) {
  const start = css.indexOf(selector)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  if (open < 0 || close < 0) return ''
  return css.slice(open + 1, close)
}

describe('resize freeze mitigation', () => {
  it('skips layout and paint for offscreen turns', () => {
    const body = ruleBody('[data-agent-conversation] .agent-turn {\n  content-visibility')
    expect(body).toContain('content-visibility: auto')
    // 估值必须给，否则滚动条长度会剧烈跳动（跳动比慢更难受）。
    expect(body).toContain('contain-intrinsic-size: auto 220px')
  })

  // 这条只是"跳过屏幕外的布局与绘制"，不许动数据与顺序相关的任何东西。
  it('does not touch data or ordering', () => {
    const body = ruleBody('[data-agent-conversation] .agent-turn {\n  content-visibility')
    expect(body).not.toMatch(/display:\s*none/)
    expect(body).not.toMatch(/visibility:\s*hidden/)
    expect(body).not.toMatch(/position:\s*absolute/)
    expect(body).not.toMatch(/max-height|overflow:\s*hidden|height:\s*0/)
  })
})

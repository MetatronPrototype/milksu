// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 为什么是**源码级**测试：渲染 `ChatMessageItem` 会拉起图标依赖（本 worktree 的 `node_modules`
// 是符号链接 ⇒ `?raw` 资源会 Denied，见既有的 RemoteControlPanel 坑）。这一件的目标很窄：
// **"仅采样"这种把样本当总量的说法必须消失，且与 verdict 用同一套词**，源码级足以钉住它。
const source = readFileSync('src/components/ChatMessageItem.tsx', 'utf8')

describe('size line wording', () => {
  it('no longer calls a truncated measurement just "sampled"', () => {
    // ① 两种说法并存 ⇒ 读者看到两套口径 ⇒ 必须只剩一种。
    expect(source).not.toContain('仅采样')
    expect(source).not.toContain("'sampled'")
    // 与 verdict 一字不差的下限用词。
    expect(source).toContain('未扫完')
    expect(source).toContain('will free')
  })

  it('states the floor for a truncated measurement and nothing extra for a complete one', () => {
    // 下限语义：sampled 分支带 ≥ 与"至少"，且复用 lib 的取整函数（不在这里另拼一套）。
    expect(source).toContain('formatBytesFloor')
    expect(source).toContain('≥')
    // 正常卡片（sampled === false）走另一支：那一支里不许出现"未扫完"。
    const completeBranch = source.slice(source.indexOf('approvalMeasurement.fileCount} {t(\'个文件\', \'files\')}`'))
    expect(completeBranch.slice(0, 40)).not.toContain('未扫完')
  })
})

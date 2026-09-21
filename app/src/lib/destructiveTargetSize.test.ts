import { describe, expect, it } from 'vitest'
import { assessDestructiveRequest, type DestructiveFacts } from '@/lib/destructiveTarget'

const MB = 1024 * 1024
const GB = 1024 * MB

// 夹具：不在 git（untracked=false）、可重建 ⇒ 风险判定里那三条 medium 规则都不触发，
// 于是"低"还是"非低"只由**规模**决定 ⇒ 断言不会被别的规则顺带满足（避免假绿）。
function facts(overrides: Partial<DestructiveFacts> & Record<string, unknown>): DestructiveFacts[] {
  return [{
    exists: true,
    inGitRepository: false,
    gitTracked: false,
    rebuildable: true,
    ...overrides,
  } as unknown as DestructiveFacts]
}

describe('destructive card size honesty', () => {
  // ① 被上限截停（sampled）⇒ 必须带"下限"语义：≥ 与「未扫完」。
  it('marks a sampled size as a floor, never as the total', () => {
    const a = assessDestructiveRequest('rm -rf /tmp/big', facts({
      fileCount: 20000, totalBytes: 731.3 * MB, sampled: true,
    }))
    expect(a.verdict).toContain('未扫完')
    expect(a.verdict).toContain('≥')
    expect(a.verdict).toContain('至少 20000 个文件')
    // 下限取整：不许把 731.3 MB 这种"精确到小数点"的数当成真值摆出来。
    expect(a.verdict).toContain('≥ 730 MB')
    expect(a.verdict).not.toContain('731.3')
    // 精确到整串：下限形态必须完整成立（不能只是"碰巧含 ≥"）。
    expect(a.verdict).toContain('至少 20000 个文件 / ≥ 730 MB（未扫完）')
    // 旧写法（把样本当总量直说）必须消失。
    expect(a.verdict).not.toContain('731.3 MB')
  })

  // ② 样本远小于真实的夹具（纯假数据，不碰真机文件）。
  it('shows a lower bound for a sample that is far below the real size', () => {
    const a = assessDestructiveRequest('rm -rf /tmp/x', facts({
      fileCount: 1, totalBytes: 1 * MB, sampled: true,
    }))
    expect(a.verdict).toContain('至少 1 个文件')
    expect(a.verdict).toContain('≥ 1 MB')
    expect(a.verdict).toContain('未扫完')
    expect(a.verdict).toContain('至少 1 个文件 / ≥ 1 MB（未扫完）')
  })

  // ③ 规模未知 ⇒ 不许说"低"；规模庞大（> 1 GB 或 > 10000 文件）⇒ 也不许说"低"。
  it('never calls a sampled or a huge target low risk', () => {
    const sampled = assessDestructiveRequest('rm -rf /tmp/x', facts({ fileCount: 10, totalBytes: MB, sampled: true }))
    expect(sampled.risk).not.toBe('low')
    const hugeBytes = assessDestructiveRequest('rm -rf /tmp/x', facts({ fileCount: 10, totalBytes: 2 * GB }))
    expect(hugeBytes.risk).not.toBe('low')
    const manyFiles = assessDestructiveRequest('rm -rf /tmp/x', facts({ fileCount: 10001, totalBytes: MB }))
    expect(manyFiles.risk).not.toBe('low')
    // 只因为"大"不该升到 high（删 5 GB 缓存是正常的）。
    expect(hugeBytes.risk).toBe('medium')
  })

  // 回归保护：规模已知且不大 ⇒ 仍然是"低"，且不带下限字样（别把正常卡片也标成下限）。
  it('keeps a small known size low risk, without floor wording', () => {
    const a = assessDestructiveRequest('rm -rf /tmp/small', facts({ fileCount: 12, totalBytes: 3 * MB }))
    expect(a.risk).toBe('low')
    expect(a.verdict).toContain('12 个文件')
    expect(a.verdict).not.toContain('未扫完')
    expect(a.verdict).not.toContain('≥')
  })
})

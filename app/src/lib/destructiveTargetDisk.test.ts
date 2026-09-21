import { describe, expect, it } from 'vitest'
import { assessDestructiveRequest, type DestructiveFacts } from '@/lib/destructiveTarget'

const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB

function facts(overrides: Record<string, unknown>): DestructiveFacts[] {
  return [{
    exists: true,
    inGitRepository: false,
    gitTracked: false,
    rebuildable: true,
    ...overrides,
  } as unknown as DestructiveFacts]
}

// 口径：读者关心"删掉能给我腾出多少"，那就是**磁盘占用**（du 口径），不是文件内容之和。
// 1000 个 1 字节文件：内容 ≈ 1 KB，磁盘占用 ≥ 4 MB（每个小文件占一个 4 KiB 块）。
describe('destructive card disk-usage wording', () => {
  it('reports the space a delete frees, not the sum of file contents', () => {
    const a = assessDestructiveRequest('rm -rf /tmp/many', facts({
      fileCount: 1000, totalBytes: 1000, diskBytes: 4 * MB,
    }))
    expect(a.verdict).toContain('将释放')
    expect(a.verdict).not.toContain('内容大小')
    // 显示的必须是磁盘占用那个数，而不是内容大小（1000 字节 ≈ 1000 B / 1 KB）。
    expect(a.verdict).not.toContain('1000 B')
    expect(a.verdict).toContain('4.0 MB')
  })

  it('keeps the floor wording when the walk was truncated', () => {
    const a = assessDestructiveRequest('rm -rf /tmp/many', facts({
      fileCount: 25000, totalBytes: 1 * MB, diskBytes: 98 * MB, sampled: true,
    }))
    expect(a.verdict).toContain('将释放 ≥')
    expect(a.verdict).toContain('未扫完')
    expect(a.verdict).toContain('至少 25000 个文件')
  })

  it('says "content size" when the platform cannot report block usage', () => {
    const a = assessDestructiveRequest('rm -rf /tmp/x', facts({
      fileCount: 10, totalBytes: 5 * MB, diskBytes: -1,
    }))
    expect(a.verdict).toContain('内容大小')
    // 回退值绝不许冒称"将释放"。
    expect(a.verdict).not.toContain('将释放')
  })

  it('raises risk from the disk usage, and from a truncated walk', () => {
    // 内容只有 10 字节，但磁盘占用 2 GiB ⇒ 按内容大小判会漏掉 ⇒ 必须至少 medium。
    const disk = assessDestructiveRequest('rm -rf /tmp/x', facts({
      fileCount: 10, totalBytes: 10, diskBytes: 2 * GB,
    }))
    expect(disk.risk).not.toBe('low')
    expect(disk.risk).toBe('medium')
    // 截停（未扫完）同样至少 medium（用户的探针正是这种）。
    const sampled = assessDestructiveRequest('rm -rf /tmp/x', facts({
      fileCount: 25000, totalBytes: 1 * MB, diskBytes: 98 * MB, sampled: true,
    }))
    expect(sampled.risk).not.toBe('low')
  })
})

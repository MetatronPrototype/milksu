import { describe, expect, it } from 'vitest'

import {
  computeTranscriptWindow,
  TRANSCRIPT_MOUNT_CAP,
  TRANSCRIPT_OLDER_CHUNK,
} from '@/lib/transcriptWindow'

// 转写窗口的规矩（实测出来的，见 transcriptWindow.ts 顶部注释）：
//   ① 短对话行为不能变（整段渲染 ✓）
//   ② 长对话的窗口有上限（节点数才有上限 ✓）
//   ③ 更早的内容必须**够得到**（往回挪窗口 ✓，不是"撞墙看不到" ✗）
//   ④ 这纯粹是"画哪一段"，数据本身不动 ✓

describe('transcript window', () => {
  it('leaves a transcript that fits under the cap exactly as it was', () => {
    const w = computeTranscriptWindow({ length: 60, mounted: 60 })
    expect(w.start).toBe(0)
    expect(w.end).toBe(60)
    expect(w.hidden).toBe(0)
    expect(w.atCap).toBe(false)
  })

  it('caps how much is mounted once the transcript outgrows the cap', () => {
    const w = computeTranscriptWindow({ length: 3781, mounted: 3781 })
    expect(w.size).toBe(TRANSCRIPT_MOUNT_CAP)
    expect(w.end).toBe(3781)
    expect(w.start).toBe(3781 - TRANSCRIPT_MOUNT_CAP)
    // 窗口外的更早内容数 ⇒ 「更早的 N 段」入口要显示这么多 ✓
    expect(w.hidden).toBe(3781 - TRANSCRIPT_MOUNT_CAP)
    expect(w.atCap).toBe(true)
  })

  it('never mounts more than the cap no matter how big "mounted" gets', () => {
    for (const mounted of [401, 1000, 5000, 999999]) {
      const w = computeTranscriptWindow({ length: 5000, mounted })
      expect(w.size).toBeLessThanOrEqual(TRANSCRIPT_MOUNT_CAP)
    }
  })

  it('lets the reader reach the very beginning by moving the window back', () => {
    const length = 3781
    let shift = 0
    const seen = new Set<number>()
    // 模拟读者一直点「更早的 N 段」：必须能一路挪到第 0 段 ✓
    for (let guard = 0; guard < 100; guard += 1) {
      const w = computeTranscriptWindow({ length, mounted: length, shift })
      for (let i = w.start; i < w.end; i += 1) seen.add(i)
      if (w.start === 0) break
      shift += TRANSCRIPT_OLDER_CHUNK
    }
    const w = computeTranscriptWindow({ length, mounted: length, shift })
    expect(w.start).toBe(0)
    expect(w.end).toBe(TRANSCRIPT_MOUNT_CAP)
    // 全部 3781 段都曾经进过窗口 ⇒ 没有一段是"永远看不到"的 ✓
    expect(seen.size).toBe(length)
  })

  it('clamps an out-of-range shift instead of rendering nothing', () => {
    const w = computeTranscriptWindow({ length: 500, mounted: 500, shift: 99999 })
    expect(w.start).toBe(0)
    expect(w.size).toBeGreaterThan(0)
    const negative = computeTranscriptWindow({ length: 500, mounted: 500, shift: -5 })
    expect(negative.end).toBe(500)
    expect(negative.shift).toBe(0)
  })

  it('only ever returns in-range indices, so the view layer cannot drop data', () => {
    // 这条是给读者的保证：折叠**只挑下标**，不搬运、不删数据 ⇒ 模型上下文与别人来读都不受影响 ✓
    const length = 3781
    for (const shift of [0, 1, 200, 3400, 3781, 99999]) {
      for (const mounted of [60, 400, 3781]) {
        const w = computeTranscriptWindow({ length, mounted, shift })
        expect(w.start).toBeGreaterThanOrEqual(0)
        expect(w.end).toBeLessThanOrEqual(length)
        expect(w.start).toBeLessThan(w.end)
        expect(w.size).toBe(w.end - w.start)
      }
    }
  })
})

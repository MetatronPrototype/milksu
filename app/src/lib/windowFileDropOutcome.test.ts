import { describe, expect, it } from 'vitest'
import { windowFileDropOutcome } from '@/lib/windowFileDropOutcome'

const file = (name: string) => new File(['x'], name, { type: 'image/png' })

describe('window file drop outcome', () => {
  // ① 收到文件 ⇒ 全部转交，且不打扰读者（没有提示）。
  it('hands every accepted file over without saying anything', () => {
    const accepted = [file('a.png'), file('b.png')]
    const outcome = windowFileDropOutcome({ accepted })
    expect(outcome.transfer).toHaveLength(accepted.length)
    expect(outcome.notices).toEqual([])
  })

  // ② 超过上限 ⇒ 一条双语提示，说明忽略了多少。
  it('says how many were ignored when the drop is too large', () => {
    const outcome = windowFileDropOutcome({ accepted: [file('a.png')], overflow: 3 })
    expect(outcome.transfer).toHaveLength(1)
    expect(outcome.notices).toEqual([{ kind: 'overflow', count: 3 }])
  })

  // ③ 拖进文件夹 ⇒ 一条双语提示（不递归、不静默）。
  it('says folders are not supported instead of ignoring them', () => {
    const outcome = windowFileDropOutcome({ accepted: [], folders: 2 })
    expect(outcome.notices).toEqual([{ kind: 'folders', count: 2 }])
  })

  // 上限与文件夹同时发生 ⇒ 两条提示都在（都要让读者知道）。
  it('reports both problems when they happen together', () => {
    const outcome = windowFileDropOutcome({ accepted: [file('a.png')], overflow: 2, folders: 1 })
    expect(outcome.notices).toEqual([
      { kind: 'overflow', count: 2 },
      { kind: 'folders', count: 1 },
    ])
  })

  // 边界：什么都没有 ⇒ 不转交、不提示（也不崩）。
  it('handles empty input', () => {
    expect(windowFileDropOutcome({ accepted: [] })).toEqual({ transfer: [], notices: [] })
    expect(windowFileDropOutcome({ accepted: [] as File[], overflow: -5, folders: Number.NaN }).notices).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { backgroundTaskNotice } from '@/lib/backgroundTaskNotice'

describe('background task notice', () => {
  // ① 回合结束 + 后台仍有任务 ⇒ 必须说清"在跑什么"（不是小图标）。
  it('names what is still running once the turn has ended', () => {
    const notice = backgroundTaskNotice({ turnEnded: true, running: [{ name: '打包' }] })
    expect(notice).toEqual({ kind: 'still-running', name: '打包', count: 1, turnEnded: true })
  })

  // 多个任务 ⇒ 带上总数（读者要知道还有几件事没完）。
  it('carries how many are still running', () => {
    expect(backgroundTaskNotice({ turnEnded: true, running: [{ name: '打包' }, { name: 'verify' }] }))
      .toEqual({ kind: 'still-running', name: '打包', count: 2, turnEnded: true })
  })

  // ② 后台跑完 ⇒ 说一声"已完成"（否则读者一直以为还在跑）。
  it('says finished once nothing is running any more, but only if it was running', () => {
    expect(backgroundTaskNotice({ turnEnded: true, running: [], hadRunning: true })).toEqual({ kind: 'finished' })
    // 没跑过 ⇒ 不许无中生有
    expect(backgroundTaskNotice({ turnEnded: true, running: [], hadRunning: false })).toBeNull()
  })

  // ③ 没有后台任务 ⇒ 不出现任何这类提示。
  it('says nothing when there was never a background task', () => {
    expect(backgroundTaskNotice({ turnEnded: true, running: [] })).toBeNull()
    expect(backgroundTaskNotice({ turnEnded: false, running: [] })).toBeNull()
    expect(backgroundTaskNotice({ turnEnded: true, running: undefined })).toBeNull()
  })

  // 回合还没结束、但已经在跑 ⇒ 也要提示（否则转写里看着像完事了）。
  it('still reports a running task before the turn ends', () => {
    expect(backgroundTaskNotice({ turnEnded: false, running: [{ name: '打包' }] }))
      .toEqual({ kind: 'still-running', name: '打包', count: 1, turnEnded: false })
  })

  // 没有名字的任务不算"能说清在跑什么" ⇒ 不拿它当已经说清了（避免空提示）。
  it('ignores tasks with no usable name', () => {
    expect(backgroundTaskNotice({ turnEnded: true, running: [{ name: '   ' }, {}] })).toBeNull()
    expect(backgroundTaskNotice({ turnEnded: true, running: [{ name: '  ' }], hadRunning: true })).toEqual({ kind: 'finished' })
  })
})

// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WindowFileDrop from '@/components/WindowFileDrop'

afterEach(cleanup)

// 假的 DataTransfer：只需要 types 与 files 两个字段（不需要真文件）。
function fakeFile(index: number) {
  return new File([`x${index}`], `f${index}.png`, { type: 'image/png' })
}

function dragEvent(type: string, options: { files?: File[]; types?: string[] } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    dataTransfer: { types: string[]; files: File[]; dropEffect: string }
  }
  const files = options.files ?? []
  event.dataTransfer = {
    types: options.types ?? (files.length ? ['Files'] : []),
    files,
    dropEffect: 'none',
  }
  return event
}

describe('window wide file drop', () => {
  // ① 窗口内任意位置拖**文件** ⇒ 触发导入。
  it('imports files dropped anywhere in the window', () => {
    const onFiles = vi.fn()
    render(<WindowFileDrop onFiles={onFiles}><p>transcript</p></WindowFileDrop>)
    const files = [fakeFile(0), fakeFile(1)]
    window.dispatchEvent(dragEvent('dragenter', { files }))
    window.dispatchEvent(dragEvent('dragover', { files }))
    window.dispatchEvent(dragEvent('drop', { files }))
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0]?.[0]).toHaveLength(2)
    expect(onFiles.mock.calls[0]?.[1]).toEqual([])
  })

  // ② 拖**文字**（没有 Files）⇒ 完全不接管（输入框原有行为不变）。
  it('never takes over a drag that carries no files', () => {
    const onFiles = vi.fn()
    render(<WindowFileDrop onFiles={onFiles}><p>transcript</p></WindowFileDrop>)
    window.dispatchEvent(dragEvent('dragenter', { types: ['text/plain'] }))
    window.dispatchEvent(dragEvent('drop', { types: ['text/plain'] }))
    expect(onFiles).not.toHaveBeenCalled()
    // 没有接管 ⇒ 也不会出现高亮遮罩。
    expect(screen.queryByRole('status')).toBeNull()
  })

  // ③ 超过 8 个 ⇒ 只加 8 个，并把多出来的数量交给调用方提示读者。
  it('keeps at most eight and reports the overflow', () => {
    const onFiles = vi.fn()
    render(<WindowFileDrop onFiles={onFiles} pendingCount={0}><p>transcript</p></WindowFileDrop>)
    const files = Array.from({ length: 11 }, (_v, index) => fakeFile(index))
    window.dispatchEvent(dragEvent('dragenter', { files }))
    window.dispatchEvent(dragEvent('drop', { files }))
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0]?.[0]).toHaveLength(8)
    // 多出来的 3 个要如实告诉读者（双语），不许静默。
    const notices = onFiles.mock.calls[0]?.[1] as { kind: string; count: number }[]
    expect(notices).toEqual([{ kind: 'overflow', count: 3 }])
  })

  // ④ dragleave / drop 之后高亮必须撤掉。
  it('removes the highlight on leave and on drop', () => {
    const onFiles = vi.fn()
    render(<WindowFileDrop onFiles={onFiles}><p>transcript</p></WindowFileDrop>)
    const files = [fakeFile(0)]
    // 原生事件里的 setState 要用 act 包住才会立刻落到 DOM（否则断言跑在更新之前）。
    act(() => { window.dispatchEvent(dragEvent('dragenter', { files })) })
    expect(screen.getByRole('status')).not.toBeNull()
    act(() => { window.dispatchEvent(dragEvent('dragleave', { files })) })
    expect(screen.queryByRole('status')).toBeNull()

    // 放下之后同样撤掉
    act(() => { window.dispatchEvent(dragEvent('dragenter', { files })) })
    expect(screen.getByRole('status')).not.toBeNull()
    act(() => { window.dispatchEvent(dragEvent('drop', { files })) })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

// 文件夹检测已改由 lib 的 selectableDropFiles 负责（上游 0ee93024 的设计）；
// 那条纯函数的用例在 app/src/lib/composerFileDrop.test.ts 里，这里不再重复。

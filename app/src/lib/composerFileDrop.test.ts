import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_LIMIT,
  isFileDrag,
  nextDragDepth,
  planFileDrop,
  selectableDropFiles,
  type DropFileItem,
} from '@/lib/composerFileDrop'

describe('window file drop', () => {
  // 只有真的拖着文件才接管：拖侧栏那一行会话不能被当成"加附件"。
  it('takes over only a drag that carries files', () => {
    expect(isFileDrag(['Files'])).toBe(true)
    expect(isFileDrag(['files', 'text/plain'])).toBe(true)
    expect(isFileDrag(['text/plain'])).toBe(false)
    expect(isFileDrag(['application/x-milksu-conversation'])).toBe(false)
    expect(isFileDrag([])).toBe(false)
    expect(isFileDrag(undefined)).toBe(false)
  })

  // 子元素来回进出会成对抖动，必须靠计数，drop 时强制归零。
  it('counts nested enters and leaves', () => {
    let depth = 0
    depth = nextDragDepth(depth, 'enter')
    expect(depth).toBe(1)
    // 进入子元素：又 enter 一次
    depth = nextDragDepth(depth, 'enter')
    expect(depth).toBe(2)
    // 离开子元素：只减一层
    depth = nextDragDepth(depth, 'leave')
    expect(depth).toBe(1)
    // 真正离开窗口
    depth = nextDragDepth(depth, 'leave')
    expect(depth).toBe(0)
    // 不会变成负数
    expect(nextDragDepth(0, 'leave')).toBe(0)
    // 放下后一律归零
    expect(nextDragDepth(3, 'drop')).toBe(0)
  })

  it('accepts up to the limit and reports what it had to leave out', () => {
    expect(planFileDrop({ fileCount: 3, pendingCount: 0 })).toEqual({ accept: 3, overflow: 0, folders: 0 })
    // 已经有 6 个，再拖 3 个 ⇒ 只收 2 个，1 个要说明
    expect(planFileDrop({ fileCount: 3, pendingCount: 6 })).toEqual({ accept: 2, overflow: 1, folders: 0 })
    // 已经满了 ⇒ 一个都不收，全部说明
    expect(planFileDrop({ fileCount: 2, pendingCount: 8 })).toEqual({ accept: 0, overflow: 2, folders: 0 })
    // 上限就是 8
    expect(ATTACHMENT_LIMIT).toBe(8)
  })

  // 文件夹必须明确拒绝（不递归），并且不占"超上限"的额度。
  it('refuses folders without recursing and without counting them as overflow', () => {
    expect(planFileDrop({ fileCount: 3, pendingCount: 0, folderCount: 2 })).toEqual({
      accept: 1,
      overflow: 0,
      folders: 2,
    })
    // 文件夹与上限混在一起：只对可导入的那部分算上限
    expect(planFileDrop({ fileCount: 4, pendingCount: 7, folderCount: 1 })).toEqual({
      accept: 1,
      overflow: 2,
      folders: 1,
    })
  })
})

function named(name: string): File {
  return { name } as File
}

describe('selectableDropFiles', () => {
  it('keeps files and drops directories before the accept slice', () => {
    const folder = named('dir')
    const first = named('a.txt')
    const second = named('b.txt')
    const items: { length: number; [index: number]: DropFileItem } = {
      length: 3,
      0: { kind: 'file', getAsFile: () => folder, webkitGetAsEntry: () => ({ isDirectory: true }) },
      1: { kind: 'file', getAsFile: () => first, webkitGetAsEntry: () => ({ isDirectory: false }) },
      2: { kind: 'file', getAsFile: () => second, webkitGetAsEntry: () => ({ isDirectory: false }) },
    }
    const selected = selectableDropFiles([folder, first, second], items)
    expect(selected.folders).toBe(1)
    expect(selected.files.map(file => file.name)).toEqual(['a.txt', 'b.txt'])
    const plan = planFileDrop({
      fileCount: selected.files.length + selected.folders,
      pendingCount: 7,
      folderCount: selected.folders,
    })
    expect(plan).toMatchObject({ accept: 1, overflow: 1, folders: 1 })
    expect(selected.files.slice(0, plan.accept).map(file => file.name)).toEqual(['a.txt'])
  })

  it('returns the raw file list when entries cannot be classified', () => {
    const file = named('a.txt')
    const selected = selectableDropFiles([file], {
      length: 1,
      0: { kind: 'file', getAsFile: () => file },
    })
    expect(selected.folders).toBe(0)
    expect(selected.files).toEqual([file])
  })
})

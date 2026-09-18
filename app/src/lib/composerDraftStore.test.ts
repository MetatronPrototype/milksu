// @vitest-environment jsdom

// 用户两次因"切对话丢草稿"重打大段文字。这里锁住四件事：
// 落盘、切 key 往返不丢、发送后清空、空内容不残留。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'milksu.composer-drafts.v1'

/**
 * 这个仓库的 vitest 环境不一定提供 localStorage，而"草稿是否真的落盘"正是要验的东西，
 * 所以测试自己装一个内存实现（挂在 globalThis/window 上，跨 resetModules 仍然存在，
 * 正好模拟应用重启后重新读取）。
 */
function installStorageStub(): Storage {
  const target = (globalThis as unknown as { window?: unknown }).window ?? globalThis
  const host = target as Record<string, unknown> & { localStorage?: Storage }
  if (!host.localStorage) {
    const map = new Map<string, string>()
    const stub: Storage = {
      get length() { return map.size },
      clear: () => { map.clear() },
      getItem: key => (map.has(String(key)) ? map.get(String(key))! : null),
      key: index => [...map.keys()][index] ?? null,
      removeItem: key => { map.delete(String(key)) },
      setItem: (key, value) => { map.set(String(key), String(value)) },
    }
    Object.defineProperty(host, 'localStorage', { configurable: true, value: stub })
  }
  return host.localStorage as Storage
}

async function freshStore() {
  vi.resetModules()
  return import('@/lib/composerDraftStore')
}

describe('composer draft store', () => {
  beforeEach(() => {
    installStorageStub().clear()
    vi.resetModules()
  })

  it('keeps a draft for its own conversation and returns it when switching back', async () => {
    const store = await freshStore()
    store.writeComposerDraft('conversation-a', { html: '', text: 'REPRO草稿测试-XYZZY', attachments: [] })
    store.writeComposerDraft('conversation-b', { html: '', text: 'B 的内容', attachments: [] })

    expect(store.readComposerDraft('conversation-b')?.text).toBe('B 的内容')
    expect(store.readComposerDraft('conversation-a')?.text).toBe('REPRO草稿测试-XYZZY')
  })

  it('survives a restart because the draft is written to storage', async () => {
    const first = await freshStore()
    first.writeComposerDraft('conversation-a', { html: '', text: '崩溃前的草稿', attachments: [] })
    expect(installStorageStub().getItem(STORAGE_KEY)).toContain('崩溃前的草稿')

    // 重新加载模块 = 应用重启（内存 Map 清空），草稿应从落盘内容恢复。
    const second = await freshStore()
    expect(second.readComposerDraft('conversation-a')?.text).toBe('崩溃前的草稿')
  })

  it('clears the draft after a successful send', async () => {
    const store = await freshStore()
    store.writeComposerDraft('conversation-a', { html: '', text: '已经发出去了', attachments: [] })
    store.clearComposerDraft('conversation-a')

    expect(store.readComposerDraft('conversation-a')).toBeUndefined()
    expect(installStorageStub().getItem(STORAGE_KEY) ?? '').not.toContain('已经发出去了')
  })

  it('drops an emptied draft instead of keeping an empty shell', async () => {
    const store = await freshStore()
    store.writeComposerDraft('conversation-a', { html: '', text: '打了一半', attachments: [] })
    store.writeComposerDraft('conversation-a', { html: '', text: '   ', attachments: [] })

    expect(store.readComposerDraft('conversation-a')).toBeUndefined()
  })
})

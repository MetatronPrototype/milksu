import type { CodingAttachment } from '@/types'
import type { WorkspaceHome } from '@/lib/workspaceSessionRouting'

export type StoredComposerDraft = {
  html: string
  text: string
  attachments: CodingAttachment[]
}

const drafts = new Map<string, StoredComposerDraft>()

export function composerDraftKey(
  conversationId?: string | null,
  workspaceHome: WorkspaceHome = 'chat',
) {
  const id = String(conversationId ?? '').trim()
  return id || `pending:${workspaceHome}`
}

export function readComposerDraft(key: string): StoredComposerDraft | undefined {
  const normalized = String(key ?? '').trim()
  if (!normalized) return undefined
  const stored = drafts.get(normalized)
  if (!stored) return undefined
  return {
    html: stored.html,
    text: stored.text,
    attachments: [...stored.attachments],
  }
}

export function writeComposerDraft(key: string, draft: StoredComposerDraft) {
  const normalized = String(key ?? '').trim()
  if (!normalized) return
  const html = String(draft.html ?? '')
  const text = String(draft.text ?? '')
  const attachments = [...(draft.attachments ?? [])]
  if (!html && !text.trim() && !attachments.length) {
    drafts.delete(normalized)
    return
  }
  drafts.set(normalized, { html, text, attachments })
}

export function clearComposerDraft(key: string) {
  const normalized = String(key ?? '').trim()
  if (!normalized) return
  drafts.delete(normalized)
}

export function resetComposerDrafts() {
  drafts.clear()
}

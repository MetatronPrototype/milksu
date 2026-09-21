import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '@/hooks/useUiLocale'
import { ATTACHMENT_LIMIT, isFileDrag, nextDragDepth, planFileDrop } from '@/lib/composerFileDrop'

/**
 * 整窗拖拽加附件（**接线**那一半；判定在 `composerFileDrop.ts` ✓）。
 *
 * 行为约束（照产品要求 ✓）：
 *  - **只有真的拖着文件时才接管** ✓（`DataTransfer.types` 含 `Files` ✓）⇒ 拖文本/选区、以及输入框自身
 *    原有的拖放**保持原样** ✗（不是文件 ⇒ 这里一个 `preventDefault` 都不做 ✓）；
 *  - 拖入时给一个**克制的整体高亮** ✓，**离开或放下后必须撤掉** ✗（用 `nextDragDepth` 计数 ✓，
 *    因为 dragenter/dragleave 会因子元素成对抖动 ✓）；
 *  - 超过上限 ⇒ **把多出来的数量交给调用方去提示读者** ✓（不许静默丢 ✗）；
 *  - **不自己读文件、不自己造导入逻辑** ✗：把 `File[]` 交给调用方（复用 `importCodingFiles` ✓）。
 */
export default function WindowFileDrop({
  children,
  pendingCount = 0,
  limit = ATTACHMENT_LIMIT,
  onFiles,
}: {
  children: ReactNode
  /** 当前已有几个附件（用于算"还能收几个"✓）。 */
  pendingCount?: number
  limit?: number
  /** 真正要导入的文件 + 因为超上限被忽略的数量（由调用方提示读者 ✓）。 */
  onFiles: (files: File[], overflow: number) => void
}) {
  const t = useT()
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  // 用 ref 拿最新的 props，避免把监听器绑成"会过期的闭包"。
  const latest = useRef({ pendingCount, limit, onFiles })
  latest.current = { pendingCount, limit, onFiles }

  const endDrag = useCallback(() => {
    depth.current = 0
    setDragging(false)
  }, [])

  useEffect(() => {
    function isFile(event: DragEvent) {
      return isFileDrag(event.dataTransfer?.types as unknown as readonly string[] | undefined)
    }
    function handleEnter(event: DragEvent) {
      // 不是文件 ⇒ **完全不接管**（输入框自己的拖放行为不受影响）。
      if (!isFile(event)) return
      depth.current = nextDragDepth(depth.current, 'enter')
      setDragging(true)
    }
    function handleOver(event: DragEvent) {
      if (!isFile(event)) return
      // 必须 preventDefault，否则浏览器/Electron 会用默认行为"打开这个文件"。
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    function handleLeave(event: DragEvent) {
      if (!isFile(event)) return
      depth.current = nextDragDepth(depth.current, 'leave')
      if (depth.current === 0) setDragging(false)
    }
    function handleDrop(event: DragEvent) {
      if (!isFile(event)) return
      event.preventDefault()
      endDrag()
      const dropped = Array.from(event.dataTransfer?.files ?? [])
      const plan = planFileDrop({
        fileCount: dropped.length,
        pendingCount: latest.current.pendingCount,
        limit: latest.current.limit,
      })
      if (!plan.accept) {
        // 一个都收不下：仍然要告诉读者（不许静默）。
        if (plan.overflow > 0 || dropped.length > 0) latest.current.onFiles([], plan.overflow || dropped.length)
        return
      }
      latest.current.onFiles(dropped.slice(0, plan.accept), plan.overflow)
    }
    window.addEventListener('dragenter', handleEnter)
    window.addEventListener('dragover', handleOver)
    window.addEventListener('dragleave', handleLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleEnter)
      window.removeEventListener('dragover', handleOver)
      window.removeEventListener('dragleave', handleLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [onFiles, endDrag])


  return (
    <>
      {children}
      {dragging ? (
        <div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/60"
          role="status"
          aria-label={t('松开即可添加为附件', 'Drop to add as attachments')}
        >
          <span className="rounded-xl border border-border bg-background/90 px-4 py-2 text-caption shadow-lg">
            {t('松开即可添加为附件', 'Drop to add as attachments')}
          </span>
        </div>
      ) : null}
    </>
  )
}

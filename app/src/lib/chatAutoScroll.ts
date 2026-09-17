/**
 * 距离底部多少像素以内算“还贴着底”。
 *
 * 本来是 8——那个值使得“往上翻看过之后重新跟随”几乎不可能：读者滚回底部时
 * 通常停在几十像素处，于是 pinned 永远是 false，看起来就是“跟随根本没实现”。
 * 64 像素对滚动的读者来说仍然等于“就在底部”。
 */
export const chatAutoScrollThreshold = 64

export function shouldFollowChatOutput(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = chatAutoScrollThreshold,
): boolean {
  const remaining = Math.max(0, scrollHeight - scrollTop - clientHeight)
  return remaining <= Math.max(0, threshold)
}

/**
 * 跟随滚动要不要再试一次。
 *
 * 长内容（markdown、代码块、图片、分批挂载）会在我们滚动之后继续变高，
 * 只转两帧就收手会停在半路、然后被判成“离底部太远”而不再跟随。
 * 只要还差得远就再滚一次，直到真的贴到底。
 */
export function chatNeedsAnotherFollowScroll(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  return Math.max(0, scrollHeight - scrollTop - clientHeight) > 1
}

export function nextChatAutoScrollPinned(
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  if (scrollTop < previousScrollTop) return false
  return shouldFollowChatOutput(scrollTop, clientHeight, scrollHeight)
}

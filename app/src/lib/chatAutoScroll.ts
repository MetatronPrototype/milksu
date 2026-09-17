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

export function nextChatAutoScrollPinned(
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  if (scrollTop < previousScrollTop) return false
  return shouldFollowChatOutput(scrollTop, clientHeight, scrollHeight)
}

// The line the model reads about each attachment.
//
// Sizes were missing, so an agent could not tell that a 1179x17728 screenshot was about to be
// refused by the provider - it had to walk into the wall first, which is part of why one
// conversation spun for a day. Knowing the pixels up front lets the agent choose another route
// (read the file locally, pick a different image) instead of retrying a doomed upload.

/** `1179×17728 px`, or "" when one of the two numbers is unusable. */
export function formatPixelSize(width, height) {
  const w = Math.floor(Number(width))
  const h = Math.floor(Number(height))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return ""
  return `${w}×${h} px`
}

/**
 * One attachment as a single line. Dimensions are inserted only when they are known, so a caller
 * that could not measure the file (an unreadable header, a non-image) produces exactly the line the
 * model used to get.
 */
export function formatAttachmentLine(value, { describeBytes } = {}) {
  const name = String(value?.name ?? "").trim() || "attachment"
  const mediaType = String(value?.mediaType ?? "").trim() || "application/octet-stream"
  const size = typeof describeBytes === "function" ? describeBytes(value?.size) : String(value?.size ?? 0)
  const pixels = formatPixelSize(value?.width, value?.height)
  const parts = [mediaType, size]
  if (pixels) parts.push(pixels)
  parts.push(`sha256:${String(value?.sha256 ?? "")}`, `read-only path: ${String(value?.path ?? "")}`)
  return `- ${name} (${parts.join(", ")})`
}

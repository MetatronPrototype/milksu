// How many pixels an attachment holds, read from the file header only.
//
// The model-facing description line wants a size (1179x17728 px), and having it is what lets an agent
// foresee that a screenshot will be refused instead of walking into the wall. Decoding the whole image
// is not an option: attachments are described on every turn, so this has to be a header read, and the
// result is cached by content hash so the same image is measured once.
//
// Only the three containers the app accepts are parsed, and anything unreadable yields null - the
// caller shows no size rather than guessing one.

/** Bumped if the parsing changes what we would report, so cached entries can be invalidated. */
export const IMAGE_SIZE_HEADER_VERSION = 1

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function asBuffer(bytes) {
  if (!bytes) return null
  if (Buffer.isBuffer(bytes)) return bytes
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (Array.isArray(bytes)) return Buffer.from(bytes)
  return null
}

function looksNonsense(width, height) {
  return !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
}

/**
 * `{ width, height, mediaType, format }`, or null when the bytes are not an image we can measure.
 * Never throws: a damaged file must not take a turn down.
 */
export function imageSizeFromHeader(bytes) {
  const buffer = asBuffer(bytes)
  if (!buffer || buffer.length < 16) return null
  try {
    return pngSize(buffer) ?? jpegSize(buffer) ?? heicSize(buffer)
  } catch {
    return null
  }
}

function pngSize(buffer) {
  if (buffer.length < 24) return null
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (buffer[index] !== PNG_SIGNATURE[index]) return null
  }
  if (buffer.toString("latin1", 12, 16) !== "IHDR") return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (looksNonsense(width, height)) return null
  return { width, height, mediaType: "image/png", format: "png" }
}

// SOF0..SOF15, minus the ones that are not frame headers (DHT, JPG, DAC).
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    let marker = buffer[offset + 1]
    // Padding fill bytes before a marker are legal.
    while (marker === 0xff && offset + 2 < buffer.length) {
      offset += 1
      marker = buffer[offset + 1]
    }
    offset += 2
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9 || marker === 0xda) return null
    if (offset + 1 >= buffer.length) return null
    const length = buffer.readUInt16BE(offset)
    if (length < 2) return null
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 7 >= buffer.length) return null
      const height = buffer.readUInt16BE(offset + 3)
      const width = buffer.readUInt16BE(offset + 5)
      if (looksNonsense(width, height)) return null
      return { width, height, mediaType: "image/jpeg", format: "jpeg" }
    }
    offset += length
  }
  return null
}

// HEIC/HEIF: the only header we can trust across brands is the ISO-BMFF `ispe` box.
function heicSize(buffer) {
  const probe = buffer.toString("latin1", 0, Math.min(buffer.length, 32))
  if (!/ftyp(heic|heix|hevc|hevx|mif1|msf1|avif)/.test(probe)) return null
  const at = buffer.indexOf("ispe", 0, "latin1")
  if (at < 0 || at + 12 > buffer.length) return null
  const width = buffer.readUInt32BE(at + 8)
  const height = buffer.readUInt32BE(at + 12)
  if (looksNonsense(width, height)) return null
  return { width, height, mediaType: "image/heic", format: "heic" }
}

/**
 * Measure-once cache keyed by the content hash, so a conversation that re-sends the same attachment
 * does not re-parse it every turn. Unmeasurable files are remembered too (as null) for the same reason.
 */
export function createImageSizeCache({ measure = imageSizeFromHeader, limit = 512 } = {}) {
  const entries = new Map()
  return {
    sizeFor(sha256, bytes) {
      const key = String(sha256 ?? "").trim()
      if (key && entries.has(key)) return entries.get(key)
      const measured = measure(bytes)
      const value = measured && !looksNonsense(measured.width, measured.height) ? measured : null
      if (key) {
        if (entries.size >= limit) entries.delete(entries.keys().next().value)
        entries.set(key, value)
      }
      return value
    },
    get size() {
      return entries.size
    },
  }
}

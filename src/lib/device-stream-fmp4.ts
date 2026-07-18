/**
 * Minimal fMP4 box helpers for live MSE attachment (no MediaSource dependency).
 */

export type Fmp4Box = {
  type: string
  offset: number
  size: number
  headerSize: number
}

export function iterFmp4TopBoxes(data: Uint8Array): Fmp4Box[] {
  const boxes: Fmp4Box[] = []
  let offset = 0
  while (offset + 8 <= data.byteLength) {
    const size32 = readU32(data, offset)
    const type = readType(data, offset + 4)
    let size = size32
    let headerSize = 8
    if (size32 === 1) {
      if (offset + 16 > data.byteLength) break
      size = readU64(data, offset + 8)
      headerSize = 16
    } else if (size32 === 0) {
      size = data.byteLength - offset
    }
    if (size < 8) break
    boxes.push({ type, offset, size, headerSize })
    if (offset + size > data.byteLength) break
    offset += size
  }
  return boxes
}

export function extractFmp4InitSegment(
  buffer: Uint8Array,
): { init: Uint8Array; rest: Uint8Array } | null {
  let offset = 0
  let hasFtyp = false
  let moovEnd: number | null = null
  const length = buffer.byteLength

  while (offset + 8 <= length) {
    const size32 = readU32(buffer, offset)
    const type = readType(buffer, offset + 4)
    let size = size32
    if (size32 === 1) {
      if (offset + 16 > length) return null
      size = readU64(buffer, offset + 8)
    } else if (size32 === 0) {
      break
    }
    if (size < 8) break
    if (offset + size > length) return null
    if (type === 'ftyp') hasFtyp = true
    else if (type === 'moov') {
      moovEnd = offset + size
      break
    }
    offset += size
  }

  if (!hasFtyp || moovEnd == null) return null
  return {
    init: buffer.slice(0, moovEnd),
    rest: buffer.slice(moovEnd),
  }
}

/** Build an avc1.PPCCLL codec string from an init segment's avcC box, if present. */
export function parseAvc1CodecFromInit(init: Uint8Array): string | null {
  const avcC = findBox(init, 'avcC')
  if (!avcC || avcC.offset + avcC.headerSize + 4 > init.byteLength) return null
  const base = avcC.offset + avcC.headerSize
  // avcC: configurationVersion, AVCProfileIndication, profile_compatibility, AVCLevelIndication
  const profile = init[base + 1]
  const compat = init[base + 2]
  const level = init[base + 3]
  const pp = profile.toString(16).padStart(2, '0')
  const cc = compat.toString(16).padStart(2, '0')
  const ll = level.toString(16).padStart(2, '0')
  return `avc1.${pp}${cc}${ll}`
}

function findBox(data: Uint8Array, target: string, start = 0, end = data.byteLength): Fmp4Box | null {
  let offset = start
  while (offset + 8 <= end) {
    const size32 = readU32(data, offset)
    const type = readType(data, offset + 4)
    let size = size32
    let headerSize = 8
    if (size32 === 1) {
      if (offset + 16 > end) return null
      size = readU64(data, offset + 8)
      headerSize = 16
    } else if (size32 === 0) {
      size = end - offset
    }
    if (size < 8 || offset + size > end) return null
    if (type === target) return { type, offset, size, headerSize }
    // Recurse into containers that may hold avcC.
    if (
      type === 'moov' ||
      type === 'trak' ||
      type === 'mdia' ||
      type === 'minf' ||
      type === 'stbl' ||
      type === 'stsd' ||
      type === 'avc1' ||
      type === 'avc3'
    ) {
      // stsd/avc1 have extra preamble before child boxes.
      let childStart = offset + headerSize
      if (type === 'stsd') childStart += 8
      if (type === 'avc1' || type === 'avc3') childStart += 78
      const found = findBox(data, target, childStart, offset + size)
      if (found) return found
    }
    offset += size
  }
  return null
}

function readU32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  )
}

function readU64(data: Uint8Array, offset: number): number {
  // Sizes we care about fit in 2^53; avoid BigInt for simplicity.
  const hi = readU32(data, offset)
  const lo = readU32(data, offset + 4)
  return hi * 0x1_0000_0000 + lo
}

function readType(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
}

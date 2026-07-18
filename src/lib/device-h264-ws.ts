/**
 * Device mirror over WebSocket: framed Annex-B H.264 → WebCodecs → canvas.
 * No progressive fMP4, no play-from-zero timeline.
 */

export type DeviceH264LatencySample = {
  wallMs: number
  captureLagMs: number
  framesDecoded: number
}

export type DeviceH264AttachResult = {
  stop: () => void
  canvas: HTMLCanvasElement
  stream: MediaStream
}

const WS_MAGIC_0 = 0x48 // 'H'
const WS_MAGIC_1 = 0x32 // '2'

const NAL_TYPE_NAMES: Record<number, string> = {
  1: 'non-IDR',
  5: 'IDR',
  6: 'SEI',
  7: 'SPS',
  8: 'PPS',
  9: 'AUD',
}

export function deviceWsUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (configured) {
    const base = configured.replace(/\/$/, '')
    const wsBase = base.replace(/^http/, 'ws')
    return `${wsBase}/api/device/ws`
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/device/ws`
}

export function parseWsNalMessage(buffer: ArrayBuffer): {
  nalType: number
  isKey: boolean
  wallMs: number
  data: Uint8Array
} {
  const view = new DataView(buffer)
  if (buffer.byteLength < 16 || view.getUint8(0) !== WS_MAGIC_0 || view.getUint8(1) !== WS_MAGIC_1) {
    throw new Error('invalid H.264 WS frame')
  }
  const version = view.getUint8(2)
  if (version !== 1) throw new Error(`unsupported WS frame version ${version}`)
  const flags = view.getUint8(3)
  const nalType = view.getUint8(4)
  // wall_ms is u64 BE at offset 8 — JS safe for current epoch ms
  const wallMs = view.getUint32(8) * 0x1_0000_0000 + view.getUint32(12)
  return {
    nalType,
    isKey: (flags & 0x01) !== 0,
    wallMs,
    data: new Uint8Array(buffer, 16),
  }
}

/** Extract avc1.PPCCLL from SPS NAL (Annex-B or raw). */
export function codecStringFromSps(spsNal: Uint8Array): string {
  // Skip start code
  let i = 0
  if (
    spsNal.byteLength > 4 &&
    spsNal[0] === 0 &&
    spsNal[1] === 0 &&
    spsNal[2] === 0 &&
    spsNal[3] === 1
  ) {
    i = 4
  } else if (spsNal.byteLength > 3 && spsNal[0] === 0 && spsNal[1] === 0 && spsNal[2] === 1) {
    i = 3
  }
  // NAL header + profile_idc, constraint_set flags, level_idc
  if (i + 4 >= spsNal.byteLength) return 'avc1.42E01E'
  const profile = spsNal[i + 1]
  const compat = spsNal[i + 2]
  const level = spsNal[i + 3]
  const pp = profile.toString(16).padStart(2, '0')
  const cc = compat.toString(16).padStart(2, '0')
  const ll = level.toString(16).padStart(2, '0')
  return `avc1.${pp}${cc}${ll}`
}

function stripStartCode(nal: Uint8Array): Uint8Array {
  if (nal.byteLength > 4 && nal[0] === 0 && nal[1] === 0 && nal[2] === 0 && nal[3] === 1) {
    return nal.subarray(4)
  }
  if (nal.byteLength > 3 && nal[0] === 0 && nal[1] === 0 && nal[2] === 1) {
    return nal.subarray(3)
  }
  return nal
}

/** Build AVCDecoderConfigurationRecord from SPS+PPS Annex-B NALs. */
export function buildAvcDecoderConfig(spsNal: Uint8Array, ppsNal: Uint8Array): Uint8Array {
  const sps = stripStartCode(spsNal)
  const pps = stripStartCode(ppsNal)
  const out = new Uint8Array(11 + sps.byteLength + pps.byteLength)
  let o = 0
  out[o++] = 1 // configurationVersion
  out[o++] = sps[1] // AVCProfileIndication
  out[o++] = sps[2] // profile_compatibility
  out[o++] = sps[3] // AVCLevelIndication
  out[o++] = 0xff // lengthSizeMinusOne = 3
  out[o++] = 0xe1 // numOfSequenceParameterSets = 1
  out[o++] = (sps.byteLength >> 8) & 0xff
  out[o++] = sps.byteLength & 0xff
  out.set(sps, o)
  o += sps.byteLength
  out[o++] = 1 // numOfPictureParameterSets
  out[o++] = (pps.byteLength >> 8) & 0xff
  out[o++] = pps.byteLength & 0xff
  out.set(pps, o)
  return out
}

function annexBToLengthPrefixed(nal: Uint8Array): Uint8Array {
  const body = stripStartCode(nal)
  const out = new Uint8Array(4 + body.byteLength)
  const len = body.byteLength
  out[0] = (len >>> 24) & 0xff
  out[1] = (len >>> 16) & 0xff
  out[2] = (len >>> 8) & 0xff
  out[3] = len & 0xff
  out.set(body, 4)
  return out
}

/** Concatenate several Annex-B NALs into one length-prefixed access unit. */
export function concatLengthPrefixed(nals: Uint8Array[]): Uint8Array {
  const parts = nals.map(annexBToLengthPrefixed)
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.byteLength
  }
  return out
}

function describeDecoderError(err: unknown): Record<string, unknown> {
  if (err && typeof err === 'object') {
    const e = err as DOMException & { code?: number }
    return {
      name: e.name,
      message: e.message,
      code: e.code,
      toString: String(err),
    }
  }
  return { toString: String(err) }
}

/**
 * Attach device H.264 WebSocket stream to a canvas and return captureStream().
 */
export async function attachDeviceH264WebSocket(
  video: HTMLVideoElement,
  {
    wsUrl = deviceWsUrl(),
    onLatency,
    signal,
  }: {
    wsUrl?: string
    onLatency?: (sample: DeviceH264LatencySample) => void
    signal?: AbortSignal
  } = {},
): Promise<DeviceH264AttachResult> {
  if (typeof VideoDecoder === 'undefined') {
    throw new Error('WebCodecs VideoDecoder is not available')
  }

  const canvas = document.createElement('canvas')
  canvas.width = 9
  canvas.height = 16
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (!ctx) throw new Error('Could not get canvas 2d context')

  let decoder: VideoDecoder | null = null
  let configured = false
  let configuring = false
  let sps: Uint8Array | null = null
  let pps: Uint8Array | null = null
  let framesDecoded = 0
  let framesReceived = 0
  let lastLatencyLog = 0
  let stopped = false
  let frameTimestampUs = 0
  let preferSoftware = false
  let pendingChunks: EncodedVideoChunk[] = []
  let sawIdr = false

  const stream = canvas.captureStream(60)

  // Declare ws early so stop() can close it (assigned below).
  let ws: WebSocket

  const stop = (reason = 'stop') => {
    if (stopped) return
    stopped = true
    console.info('[device-h264] stop', {
      reason,
      framesReceived,
      framesDecoded,
      decoderState: decoder?.state,
      wallMs: Math.round(performance.now()),
    })
    try {
      ws.close()
    } catch {
      // ignore
    }
    try {
      decoder?.close()
    } catch {
      // ignore
    }
    decoder = null
    configured = false
    pendingChunks = []
    stream.getTracks().forEach((t) => t.stop())
    video.srcObject = null
  }

  signal?.addEventListener(
    'abort',
    () => {
      stop('abort-signal')
    },
    { once: true },
  )

  const flushPending = () => {
    if (!decoder || decoder.state !== 'configured') return
    const queue = pendingChunks
    pendingChunks = []
    for (const chunk of queue) {
      try {
        console.info('[device-h264] decode flush', {
          type: chunk.type,
          byteLength: chunk.byteLength,
          timestamp: chunk.timestamp,
          decoderState: decoder.state,
        })
        decoder.decode(chunk)
      } catch (err) {
        console.error('[device-h264] decode() threw during flush', describeDecoderError(err))
      }
    }
  }

  const ensureDecoder = (spsNal: Uint8Array, ppsNal: Uint8Array) => {
    const codec = codecStringFromSps(spsNal)
    const description = buildAvcDecoderConfig(spsNal, ppsNal)
    if (decoder) {
      try {
        decoder.close()
      } catch {
        // ignore
      }
    }
    configuring = true
    configured = false
    pendingChunks = []

    decoder = new VideoDecoder({
      output: (frame) => {
        if (stopped) {
          frame.close()
          return
        }
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth
          canvas.height = frame.displayHeight
        }
        ctx.drawImage(frame, 0, 0)
        frame.close()
        framesDecoded += 1
        if (framesDecoded === 1 || framesDecoded % 60 === 0) {
          console.info('[device-h264] frame output', {
            framesDecoded,
            width: canvas.width,
            height: canvas.height,
            wallMs: Math.round(performance.now()),
          })
        }
      },
      error: (err) => {
        // Explicit handler — decode failures must never silently kill the pipe.
        console.error('[device-h264] VideoDecoder.onerror', {
          ...describeDecoderError(err),
          decoderState: decoder?.state,
          codec,
          framesReceived,
          framesDecoded,
          sawIdr,
          preferSoftware,
          wallMs: Math.round(performance.now()),
        })
        // Fall back to software decode once; do not close the WebSocket.
        if (!preferSoftware && !stopped) {
          preferSoftware = true
          console.warn('[device-h264] retrying decoder with software acceleration')
          try {
            ensureDecoder(spsNal, ppsNal)
          } catch (reconfErr) {
            console.error('[device-h264] software reconfigure failed', describeDecoderError(reconfErr))
          }
        }
      },
    })

    const config: VideoDecoderConfig = {
      codec,
      description,
      optimizeForLatency: true,
      hardwareAcceleration: preferSoftware ? 'prefer-software' : 'prefer-hardware',
    }

    console.info('[device-h264] configuring decoder', {
      codec,
      descriptionBytes: description.byteLength,
      hardwareAcceleration: config.hardwareAcceleration,
      avcCHead: Array.from(description.slice(0, 8)),
      wallMs: Math.round(performance.now()),
    })

    try {
      decoder.configure(config)
    } catch (err) {
      console.error('[device-h264] configure() threw', describeDecoderError(err))
      configuring = false
      return
    }

    // configure() applies asynchronously — wait until state is configured
    // before decode(), otherwise the first IDR is dropped/errors.
    const started = performance.now()
    const waitReady = () => {
      if (stopped || !decoder) return
      const state = decoder.state
      if (state === 'configured') {
        configured = true
        configuring = false
        console.info('[device-h264] decoder configured', {
          codec,
          state,
          waitMs: Math.round(performance.now() - started),
          wallMs: Math.round(performance.now()),
        })
        flushPending()
        return
      }
      if (state === 'closed') {
        configuring = false
        console.error('[device-h264] decoder closed during configure')
        return
      }
      if (performance.now() - started > 3000) {
        configuring = false
        console.error('[device-h264] decoder configure timeout', { state })
        return
      }
      window.setTimeout(waitReady, 0)
    }
    window.setTimeout(waitReady, 0)
  }

  const submitChunk = (chunk: EncodedVideoChunk, meta: Record<string, unknown>) => {
    if (!decoder) {
      console.warn('[device-h264] drop chunk — no decoder', meta)
      return
    }
    if (decoder.state !== 'configured') {
      console.info('[device-h264] queue chunk until configured', {
        ...meta,
        decoderState: decoder.state,
        pending: pendingChunks.length + 1,
      })
      pendingChunks.push(chunk)
      return
    }
    try {
      console.info('[device-h264] decode', {
        ...meta,
        decoderState: decoder.state,
        decodeQueueSize: decoder.decodeQueueSize,
      })
      decoder.decode(chunk)
    } catch (err) {
      console.error('[device-h264] decode() threw', {
        ...describeDecoderError(err),
        ...meta,
        decoderState: decoder.state,
      })
    }
  }

  ws = new WebSocket(wsUrl)
  ws.binaryType = 'arraybuffer'

  ws.onclose = (ev) => {
    console.info('[device-h264] ws close', {
      code: ev.code,
      reason: ev.reason,
      wasClean: ev.wasClean,
      framesReceived,
      framesDecoded,
      stopped,
      wallMs: Math.round(performance.now()),
    })
  }

  // Attach onmessage BEFORE open resolves — bootstrap SPS/PPS/IDR often arrive
  // in the same tick as the hello JSON and would otherwise be dropped.
  ws.onmessage = (ev) => {
    if (stopped) return
    if (typeof ev.data === 'string') {
      console.info('[device-h264] ws text', ev.data.slice(0, 200))
      return
    }

    const raw = ev.data as ArrayBuffer
    let parsed
    try {
      parsed = parseWsNalMessage(raw)
    } catch (err) {
      console.warn('[device-h264] bad frame', err)
      return
    }

    framesReceived += 1
    const nalName = NAL_TYPE_NAMES[parsed.nalType] ?? `nal${parsed.nalType}`
    console.info('[device-h264] ws frame', {
      n: framesReceived,
      nalType: parsed.nalType,
      nalName,
      isKey: parsed.isKey,
      payloadBytes: parsed.data.byteLength,
      wsBytes: raw.byteLength,
      firstBytes: Array.from(parsed.data.slice(0, 8)),
      configured,
      configuring,
      decoderState: decoder?.state ?? 'none',
      framesDecoded,
      captureLagMs: Date.now() - parsed.wallMs,
      wallMs: Math.round(performance.now()),
    })

    const lagMs = Date.now() - parsed.wallMs
    const now = performance.now()
    if (onLatency && now - lastLatencyLog > 1000) {
      lastLatencyLog = now
      onLatency({
        wallMs: now,
        captureLagMs: lagMs,
        framesDecoded,
      })
    }

    if (parsed.nalType === 7) {
      sps = parsed.data
      if (sps && pps) ensureDecoder(sps, pps)
      return
    }
    if (parsed.nalType === 8) {
      pps = parsed.data
      if (sps && pps) ensureDecoder(sps, pps)
      return
    }

    // SEI / AUD etc. — skip non-VCL except IDR/non-IDR slices
    if (parsed.nalType !== 1 && parsed.nalType !== 5) {
      console.info('[device-h264] skip non-VCL', { nalType: parsed.nalType, nalName })
      return
    }

    if (!sps || !pps) {
      console.warn('[device-h264] VCL before SPS/PPS — drop', { nalType: parsed.nalType })
      return
    }

    if (!decoder && !configuring) {
      ensureDecoder(sps, pps)
    }

    const isKey = parsed.nalType === 5 || parsed.isKey
    if (isKey) sawIdr = true

    // First IDR: send SPS+PPS+IDR in one access unit — more reliable for WebCodecs
    // than relying solely on the avcC description for the first keyframe.
    const chunkData =
      isKey && !framesDecoded
        ? concatLengthPrefixed([sps, pps, parsed.data])
        : annexBToLengthPrefixed(parsed.data)

    frameTimestampUs += 16_666
    const chunk = new EncodedVideoChunk({
      type: isKey ? 'key' : 'delta',
      timestamp: frameTimestampUs,
      data: chunkData,
    })
    submitChunk(chunk, {
      nalType: parsed.nalType,
      nalName,
      isKey,
      chunkBytes: chunkData.byteLength,
      bundledSpsPps: isKey && !framesDecoded,
    })
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal?.addEventListener('abort', onAbort, { once: true })
    ws.onopen = () => {
      console.info('[device-h264] ws open', { wsUrl, wallMs: Math.round(performance.now()) })
      resolve()
    }
    ws.onerror = () => reject(new Error('Device WebSocket failed to open'))
    const timer = window.setTimeout(() => reject(new Error('Device WebSocket open timeout')), 15000)
    ws.addEventListener(
      'open',
      () => {
        window.clearTimeout(timer)
      },
      { once: true },
    )
  })

  // Wait until we have decoded at least one frame (or timeout).
  // Never close the WebSocket on decode failure — keep listening.
  const readyDeadline = Date.now() + 20_000
  while (Date.now() < readyDeadline && !stopped) {
    if (framesDecoded > 0) break
    await new Promise((r) => setTimeout(r, 50))
    if (signal?.aborted) {
      stop('abort-during-wait')
      throw new DOMException('Aborted', 'AbortError')
    }
  }

  if (framesDecoded === 0) {
    console.warn('[device-h264] no frames decoded yet; attaching canvas stream anyway', {
      framesReceived,
      decoderState: decoder?.state,
      configured,
      sawIdr,
    })
  }

  video.srcObject = stream
  video.playsInline = true
  video.muted = true
  await video.play().catch(() => undefined)

  return { stop: () => stop('caller'), canvas, stream }
}

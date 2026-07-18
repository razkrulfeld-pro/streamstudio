/** Downsample PCM samples into normalized peak buckets (0–1). */
export function downsamplePeaks(samples: ArrayLike<number>, bucketCount: number): number[] {
  if (bucketCount <= 0) return []
  if (samples.length === 0) return Array.from({ length: bucketCount }, () => 0)

  const peaks = new Array<number>(bucketCount)
  const block = samples.length / bucketCount
  let maxPeak = 0

  for (let i = 0; i < bucketCount; i++) {
    const start = Math.floor(i * block)
    const end = Math.max(start + 1, Math.floor((i + 1) * block))
    let max = 0
    for (let j = start; j < end && j < samples.length; j++) {
      const value = Math.abs(samples[j] ?? 0)
      if (value > max) max = value
    }
    peaks[i] = max
    if (max > maxPeak) maxPeak = max
  }

  if (maxPeak <= 1e-9) return peaks.fill(0)

  for (let i = 0; i < peaks.length; i++) {
    peaks[i] = peaks[i]! / maxPeak
  }
  return peaks
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length
  const channels = buffer.numberOfChannels
  if (channels === 1) return buffer.getChannelData(0).slice()

  const out = new Float32Array(length)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i++) {
      out[i]! += data[i]! / channels
    }
  }
  return out
}

const DEFAULT_BUCKETS = 240

/**
 * Decode media bytes and return normalized waveform peaks.
 * Accepts a Blob (preferred) or a URL string.
 */
export async function extractWaveformPeaks(
  source: Blob | string,
  bucketCount = DEFAULT_BUCKETS,
): Promise<number[]> {
  const context = new AudioContext()
  try {
    const arrayBuffer =
      typeof source === 'string'
        ? await (await fetch(source)).arrayBuffer()
        : await source.arrayBuffer()
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0))
    return downsamplePeaks(mixToMono(audioBuffer), bucketCount)
  } finally {
    await context.close().catch(() => undefined)
  }
}

/** Slice peaks covering [sourceStart, sourceEnd] within a source of `sourceDuration`. */
export function slicePeaksForSourceRange(
  peaks: number[],
  sourceStart: number,
  sourceEnd: number,
  sourceDuration: number,
): number[] {
  if (peaks.length === 0 || sourceDuration <= 0) return []
  const start = Math.min(1, Math.max(0, sourceStart / sourceDuration))
  const end = Math.min(1, Math.max(start, sourceEnd / sourceDuration))
  const from = Math.floor(start * peaks.length)
  const to = Math.max(from + 1, Math.ceil(end * peaks.length))
  return peaks.slice(from, to)
}

function parseAspectRatio(aspectRatio: string): { width: number; height: number } {
  const [rawW, rawH] = aspectRatio.split(':').map(Number)
  const width = Number.isFinite(rawW) && rawW > 0 ? rawW : 16
  const height = Number.isFinite(rawH) && rawH > 0 ? rawH : 9
  return { width, height }
}

/**
 * Prefer decoded video size; if the browser hasn't reported dimensions yet
 * (common with some WebM Shorts), fall back to the session aspect ratio.
 */
export function resolveExportCanvasSize(
  videoWidth: number,
  videoHeight: number,
  aspectRatio?: string,
): { width: number; height: number } {
  if (videoWidth > 0 && videoHeight > 0) {
    return { width: videoWidth, height: videoHeight }
  }

  const { width: aw, height: ah } = parseAspectRatio(aspectRatio ?? '16:9')
  if (aw < ah) {
    return { width: 1080, height: 1920 }
  }
  if (aw === ah) {
    return { width: 1080, height: 1080 }
  }
  return { width: 1920, height: 1080 }
}

/** Cutout backgrounds must only composite the masked person — never opaque camera. */
export function shouldDrawSegmentedPersonOnly(options: {
  hasBackground: boolean
  hasFreshSegmentedPerson: boolean
}): boolean {
  return options.hasBackground && options.hasFreshSegmentedPerson
}

/** True when source playback is far enough from the target that a seek is required. */
export function needsSourceSeek(currentTime: number, targetTime: number, tolerance = 0.12): boolean {
  return Math.abs(currentTime - targetTime) > tolerance
}

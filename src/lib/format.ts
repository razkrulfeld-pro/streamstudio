export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatRecordedDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(isoDate))
}

/**
 * Display YouTube source start as `mm:ss` or `h:mm:ss`.
 * Plain seconds like 30 → `00:30`; 30 minutes → `30:00`; 1h12m → `1:12:00`.
 */
export function formatSourceStartTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Duration field display, e.g. `3secs`. */
export function formatExtractDurationSecs(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  return `${safe}secs`
}

/** Parse `3`, `3s`, `3secs`, `3 seconds`, or timestamp strings into seconds. */
export function parseExtractDurationInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  const secsOnly = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)?$/)
  if (secsOnly) {
    const value = Number(secsOnly[1])
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  return parseTimestampToSeconds(trimmed)
}

/** Parse `mm:ss`, `h:mm:ss`, or plain seconds into a non-negative number. */
export function parseTimestampToSeconds(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Bare number → seconds (30 → 30s → displays as 00:30)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const value = Number(trimmed)
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  const parts = trimmed.split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null

  if (parts.length === 2) {
    const [minutes, seconds] = parts
    if (seconds >= 60) return null
    return minutes * 60 + seconds
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts
    if (minutes >= 60 || seconds >= 60) return null
    return hours * 3600 + minutes * 60 + seconds
  }

  return null
}

/** Normalize a typed source-start string to `mm:ss` / `h:mm:ss`, or null if invalid. */
export function normalizeSourceStartInput(input: string): string | null {
  const seconds = parseTimestampToSeconds(input)
  if (seconds == null) return null
  return formatSourceStartTimestamp(seconds)
}

/** Normalize a typed duration to `Nsecs` (caller should clamp 1–60 as needed). */
export function normalizeExtractDurationInput(input: string): string | null {
  const seconds = parseExtractDurationInput(input)
  if (seconds == null) return null
  return formatExtractDurationSecs(seconds)
}

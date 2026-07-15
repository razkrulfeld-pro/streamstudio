export type ResolvedBackgroundMedia =
  | { kind: 'direct'; url: string; mediaType: 'image' | 'gif' | 'video' }
  | { kind: 'youtube'; videoId: string }
  | { kind: 'page'; site: string }

const DIRECT_MEDIA_PATTERN = /\.(gif|webp|png|jpe?g|mp4|webm|mov)(\?.*)?$/i

const MEDIA_PAGE_HOSTS = [
  { pattern: /(^|\.)pinterest\./i, site: 'Pinterest' },
  { pattern: /(^|\.)instagram\./i, site: 'Instagram' },
  { pattern: /(^|\.)facebook\./i, site: 'Facebook' },
  { pattern: /(^|\.)tiktok\./i, site: 'TikTok' },
  { pattern: /(^|\.)twitter\.|^x\.com$/i, site: 'X' },
]

function matchMediaPageSite(hostname: string): string | null {
  for (const host of MEDIA_PAGE_HOSTS) {
    if (host.pattern.test(hostname)) return host.site
  }
  return null
}

function isLikelyDirectMediaUrl(parsed: URL): boolean {
  if (DIRECT_MEDIA_PATTERN.test(parsed.pathname)) return true
  if (parsed.hostname.includes('media.giphy.com')) return true
  if (parsed.hostname.includes('media.tenor.com')) return true
  if (parsed.hostname.includes('pinimg.com')) return true
  if (parsed.hostname.includes('giphy.com') && parsed.pathname.includes('/media/')) return true
  return false
}

function extractGiphyId(url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean)
  const gifsIndex = parts.indexOf('gifs')
  if (gifsIndex === -1 || !parts[gifsIndex + 1]) return null

  const slug = parts[gifsIndex + 1]
  const dashIndex = slug.lastIndexOf('-')
  const candidate = dashIndex >= 0 ? slug.slice(dashIndex + 1) : slug
  return /^[a-zA-Z0-9]+$/.test(candidate) ? candidate : slug
}

function extractYoutubeId(url: URL): string | null {
  if (url.hostname.includes('youtu.be')) {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id || null
  }

  if (url.hostname.includes('youtube.com')) {
    if (url.pathname.startsWith('/shorts/')) {
      return url.pathname.split('/')[2] ?? null
    }

    return url.searchParams.get('v')
  }

  return null
}

export function resolveBackgroundMediaUrl(input: string): ResolvedBackgroundMedia | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  const youtubeId = extractYoutubeId(parsed)
  if (youtubeId) {
    return { kind: 'youtube', videoId: youtubeId }
  }

  if (parsed.hostname.includes('giphy.com')) {
    const giphyId = extractGiphyId(parsed)
    if (giphyId) {
      return {
        kind: 'direct',
        url: `https://media.giphy.com/media/${giphyId}/giphy.gif`,
        mediaType: 'gif',
      }
    }
  }

  if (DIRECT_MEDIA_PATTERN.test(parsed.pathname)) {
    const extension = parsed.pathname.match(DIRECT_MEDIA_PATTERN)?.[1]?.toLowerCase()
    if (extension === 'gif') {
      return { kind: 'direct', url: trimmed, mediaType: 'gif' }
    }
    if (extension === 'mp4' || extension === 'webm' || extension === 'mov') {
      return { kind: 'direct', url: trimmed, mediaType: 'video' }
    }
    return { kind: 'direct', url: trimmed, mediaType: 'image' }
  }

  if (parsed.hostname.includes('media.giphy.com') || parsed.hostname.includes('media.tenor.com')) {
    return {
      kind: 'direct',
      url: trimmed,
      mediaType: parsed.pathname.endsWith('.mp4') ? 'video' : 'gif',
    }
  }

  if (parsed.hostname.includes('pinimg.com')) {
    return {
      kind: 'direct',
      url: trimmed,
      mediaType: parsed.pathname.endsWith('.gif') ? 'gif' : 'image',
    }
  }

  const pageSite = matchMediaPageSite(parsed.hostname)
  if (pageSite) {
    return { kind: 'page', site: pageSite }
  }

  if (!isLikelyDirectMediaUrl(parsed)) {
    return { kind: 'page', site: 'that website' }
  }

  return { kind: 'direct', url: trimmed, mediaType: 'image' }
}

export function youtubeBackgroundErrorMessage(): string {
  return 'YouTube page links cannot play inside the recording canvas. Use a direct .mp4, .webm, or .gif URL instead.'
}

export function mediaPageBackgroundErrorMessage(site: string): string {
  if (site === 'Pinterest') {
    return 'Pinterest pin links are web pages, not direct GIF files. Open the pin, right-click the image → Copy image address, and paste the i.pinimg.com link here instead.'
  }

  return `${site} page links cannot play inside the recording canvas. Paste a direct .gif, .mp4, or .webm file URL instead.`
}

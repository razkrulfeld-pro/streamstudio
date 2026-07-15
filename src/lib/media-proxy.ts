export function getMediaProxyUrl(remoteUrl: string): string {
  if (remoteUrl.startsWith('blob:') || remoteUrl.startsWith('/media-proxy?')) {
    return remoteUrl
  }

  try {
    const parsed = new URL(remoteUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return remoteUrl
    }
  } catch {
    return remoteUrl
  }

  return `/media-proxy?url=${encodeURIComponent(remoteUrl)}`
}

export async function fetchMediaAsBlobUrl(remoteUrl: string): Promise<string> {
  const attempts = [getMediaProxyUrl(remoteUrl), remoteUrl]

  for (const attemptUrl of attempts) {
    try {
      const response = await fetch(attemptUrl)
      if (!response.ok) continue

      const blob = await response.blob()
      if (blob.size === 0) continue

      return URL.createObjectURL(blob)
    } catch {
      // Try the next strategy.
    }
  }

  throw new Error(
    'Could not download media from that URL. Try uploading the file instead, or run the app via the dev server.',
  )
}

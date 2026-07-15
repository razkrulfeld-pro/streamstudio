import { getChannelInfo, initiateUpload } from '@/lib/api'
import type { UploadMetadata, UploadResult } from '@/lib/types/youtube'

const CHUNK_SIZE = 8 * 1024 * 1024

function apiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (configured) return configured.replace(/\/$/, '')
  return 'http://localhost:8080'
}

export async function uploadVideoToYouTube(
  blob: Blob,
  metadata: UploadMetadata,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const mimeType = metadata.mime_type || blob.type || 'video/webm'
  const { upload_uri } = await initiateUpload({
    ...metadata,
    mime_type: mimeType,
  })

  const total = blob.size
  let offset = 0
  let videoId: string | null = null

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total)
    const chunk = blob.slice(offset, end)
    const contentRange = `bytes ${offset}-${end - 1}/${total}`

    const response = await fetch(`${apiBaseUrl()}/youtube/upload-chunk`, {
      method: 'POST',
      headers: {
        'X-Upload-Uri': upload_uri,
        'X-Content-Range': contentRange,
        'X-Content-Type': mimeType,
      },
      body: chunk,
    })

    // Backend remaps Google's 308 resume-incomplete to 200 + X-Youtube-Status.
    const youtubeStatus = Number(response.headers.get('X-Youtube-Status') || response.status)

    if (youtubeStatus === 308) {
      offset = end
      onProgress?.((offset / total) * 100)
      continue
    }

    if (youtubeStatus === 200 || youtubeStatus === 201) {
      const data = (await response.json()) as { id?: string }
      if (!data.id) {
        throw new Error('YouTube upload succeeded but no video ID was returned.')
      }
      videoId = data.id
      offset = end
      onProgress?.(100)
      break
    }

    const text = await response.text()
    throw new Error(`YouTube upload failed (${youtubeStatus}): ${text || response.statusText}`)
  }

  if (!videoId) {
    throw new Error('YouTube upload did not complete.')
  }

  let subscribeUrl = `https://youtube.com/watch?v=${videoId}`
  try {
    const channel = await getChannelInfo()
    if (channel.subscribe_url) subscribeUrl = channel.subscribe_url
  } catch {
    // Non-fatal: video URL still works without channel subscribe link.
  }

  return {
    videoId,
    videoUrl: `https://youtube.com/watch?v=${videoId}`,
    subscribeUrl,
  }
}

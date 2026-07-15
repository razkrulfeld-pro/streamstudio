import { uploadVideoToYouTube } from '@/lib/youtubeUpload'
import type { UploadMetadata, UploadResult } from '@/lib/types/youtube'
import { useCallback, useState } from 'react'

export type PublishStatus = 'idle' | 'uploading' | 'success' | 'error'

export function usePublish() {
  const [status, setStatus] = useState<PublishStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const publish = useCallback(async (blob: Blob, metadata: UploadMetadata) => {
    setStatus('uploading')
    setProgress(0)
    setResult(null)
    setError(null)

    try {
      const uploadResult = await uploadVideoToYouTube(blob, metadata, (percent) => {
        setProgress(percent)
      })
      setResult(uploadResult)
      setStatus('success')
      return uploadResult
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload to YouTube.'
      setError(message)
      setStatus('error')
      throw err
    }
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setProgress(0)
    setResult(null)
    setError(null)
  }, [])

  return { status, progress, result, error, publish, reset }
}

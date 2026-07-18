import { EditorWorkspace } from '@/components/editor/editor-workspace'
import { PageTitle } from '@/components/page-title'
import { useAssetLibrary } from '@/context/asset-library-context'
import { useRecordings } from '@/context/recordings-context'
import { useSettings } from '@/context/settings-context'
import { getAuthStatus, getChannelInfo } from '@/lib/api'
import { buildYouTubeMetadata } from '@/lib/recording-session-state'
import { getSessionType } from '@/lib/sessionTypes'
import type { UploadResult } from '@/lib/types/youtube'
import {
  createRecordingObjectUrls,
  loadStoredRecordingForEditor,
} from '@/lib/recording-storage'
import type { EditorProject } from '@/types/editor-project'
import type { RecordingStatus } from '@/types/recording'
import type { SessionYouTubeMetadata } from '@/types/session'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

const visibilityLabels = {
  public: 'Public',
  unlisted: 'Unlisted',
  private: 'Private',
} as const

type ObjectUrls = {
  videoUrl: string
  thumbnailUrl: string
  overlayAudioUrl: string | null
}

export function EditorStudioPage() {
  const { settings, updateYoutube } = useSettings()
  const { youtube } = settings
  const { assets } = useAssetLibrary()
  const { updateRecording } = useRecordings()
  const [searchParams] = useSearchParams()
  const recordingId = searchParams.get('recording')

  const [recordingName, setRecordingName] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [contentTypeLabel, setContentTypeLabel] = useState<string | null>(null)
  const [publishMetadata, setPublishMetadata] = useState<SessionYouTubeMetadata | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null)
  const [overlayAudioUrl, setOverlayAudioUrl] = useState<string | null>(null)
  const [overlayAudioBlob, setOverlayAudioBlob] = useState<Blob | null>(null)
  const [overlayBlobDirty, setOverlayBlobDirty] = useState(false)
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null)
  const [initialProject, setInitialProject] = useState<EditorProject | null>(null)
  const [overlayMissingMessage, setOverlayMissingMessage] = useState<string | null>(null)
  const [isLoadingDraft, setIsLoadingDraft] = useState(Boolean(recordingId))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [youtubeConnected, setYoutubeConnected] = useState(youtube.isConnected)
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('draft')
  const objectUrlsRef = useRef<ObjectUrls | null>(null)

  useEffect(() => {
    let cancelled = false
    async function syncYoutube() {
      try {
        const status = await getAuthStatus()
        if (cancelled) return
        setYoutubeConnected(status.connected)
        if (!status.connected) {
          updateYoutube({ isConnected: false })
          return
        }
        const channel = await getChannelInfo()
        if (cancelled) return
        updateYoutube({
          isConnected: true,
          channelName: channel.channel_title,
          channelId: channel.channel_id,
        })
      } catch {
        if (!cancelled) setYoutubeConnected(false)
      }
    }
    void syncYoutube()
    return () => {
      cancelled = true
    }
  }, [updateYoutube])

  useEffect(() => {
    if (!recordingId) {
      setIsLoadingDraft(false)
      setVideoUrl(null)
      setVideoBlob(null)
      setOverlayAudioUrl(null)
      setOverlayAudioBlob(null)
      setOverlayBlobDirty(false)
      setInitialProject(null)
      setOverlayMissingMessage(null)
      setLoadError(null)
      setPublishMetadata(null)
      return
    }

    let cancelled = false

    async function loadDraft() {
      setIsLoadingDraft(true)
      setLoadError(null)
      setOverlayMissingMessage(null)

      try {
        const loaded = await loadStoredRecordingForEditor(recordingId!)
        if (cancelled) return

        if (!loaded) {
          setRecordingName(null)
          setVideoUrl(null)
          setVideoBlob(null)
          setOverlayAudioUrl(null)
          setOverlayAudioBlob(null)
          setDurationSeconds(null)
          setInitialProject(null)
          setPublishMetadata(null)
          setLoadError('Draft recording not found.')
          setIsLoadingDraft(false)
          return
        }

        const { recording: stored, project, overlayMissing } = loaded
        const nextUrls = await createRecordingObjectUrls(stored)
        if (cancelled) {
          URL.revokeObjectURL(nextUrls.videoUrl)
          URL.revokeObjectURL(nextUrls.thumbnailUrl)
          if (nextUrls.overlayAudioUrl) URL.revokeObjectURL(nextUrls.overlayAudioUrl)
          return
        }

        if (objectUrlsRef.current) {
          URL.revokeObjectURL(objectUrlsRef.current.videoUrl)
          URL.revokeObjectURL(objectUrlsRef.current.thumbnailUrl)
          if (objectUrlsRef.current.overlayAudioUrl) {
            URL.revokeObjectURL(objectUrlsRef.current.overlayAudioUrl)
          }
        }

        const contentType = getSessionType(stored.contentTypeId)
        const metadata =
          stored.youtubeMetadata ??
          buildYouTubeMetadata(contentType, settings.youtube, stored.name)

        objectUrlsRef.current = nextUrls
        setRecordingName(stored.name)
        setRecordingStatus(stored.status)
        setAspectRatio(stored.aspectRatio ?? contentType.aspectRatio)
        setContentTypeLabel(contentType.label)
        setPublishMetadata({ ...metadata, title: stored.name })
        setVideoUrl(nextUrls.videoUrl)
        setVideoBlob(stored.videoBlob)
        setOverlayAudioUrl(nextUrls.overlayAudioUrl)
        setOverlayAudioBlob(stored.overlayAudioBlob ?? null)
        setOverlayBlobDirty(false)
        setDurationSeconds(stored.durationSeconds)
        setInitialProject(project)
        setOverlayMissingMessage(
          overlayMissing ? 'Inserted audio was missing from storage — re-add the clip.' : null,
        )
        setIsLoadingDraft(false)
      } catch (error) {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : 'Failed to load draft recording.')
        setIsLoadingDraft(false)
      }
    }

    void loadDraft()

    return () => {
      cancelled = true
    }
  }, [recordingId, settings.youtube])

  useEffect(() => {
    return () => {
      if (objectUrlsRef.current) {
        URL.revokeObjectURL(objectUrlsRef.current.videoUrl)
        URL.revokeObjectURL(objectUrlsRef.current.thumbnailUrl)
        if (objectUrlsRef.current.overlayAudioUrl) {
          URL.revokeObjectURL(objectUrlsRef.current.overlayAudioUrl)
        }
        objectUrlsRef.current = null
      }
    }
  }, [])

  const handleRecordingNameChange = useCallback((name: string) => {
    setRecordingName(name)
    setPublishMetadata((current) => (current ? { ...current, title: name } : current))
  }, [])

  const handlePublishMetadataChange = useCallback((metadata: SessionYouTubeMetadata) => {
    setPublishMetadata(metadata)
    setRecordingName(metadata.title)
  }, [])

  const handleOverlayAudioBlobChange = useCallback((blob: Blob | null) => {
    setOverlayAudioBlob(blob)
    setOverlayBlobDirty(true)
    setOverlayMissingMessage(null)

    if (objectUrlsRef.current?.overlayAudioUrl) {
      URL.revokeObjectURL(objectUrlsRef.current.overlayAudioUrl)
      objectUrlsRef.current = { ...objectUrlsRef.current, overlayAudioUrl: null }
    }

    if (!blob) {
      setOverlayAudioUrl(null)
      return
    }

    const nextUrl = URL.createObjectURL(blob)
    if (objectUrlsRef.current) {
      objectUrlsRef.current = { ...objectUrlsRef.current, overlayAudioUrl: nextUrl }
    }
    setOverlayAudioUrl(nextUrl)
  }, [])

  const persistProject = useCallback(
    async (
      project: EditorProject,
      status: 'draft' | 'published',
      youtube?: Pick<UploadResult, 'videoId' | 'videoUrl'>,
    ) => {
      if (!recordingId) return
      const patch: {
        name: string
        status: 'draft' | 'published'
        editorProject: EditorProject
        youtubeMetadata?: SessionYouTubeMetadata
        overlayAudioBlob?: Blob | null
        youtubeVideoId?: string
        youtubeVideoUrl?: string
      } = {
        name: recordingName?.trim() || 'Untitled recording',
        status,
        editorProject: project,
        youtubeMetadata: publishMetadata ?? undefined,
      }
      if (overlayBlobDirty) {
        patch.overlayAudioBlob = overlayAudioBlob
      } else if (!project.overlayAudio) {
        patch.overlayAudioBlob = null
      }
      if (youtube) {
        patch.youtubeVideoId = youtube.videoId
        patch.youtubeVideoUrl = youtube.videoUrl
      }
      const result = await updateRecording(recordingId, patch)
      if (!result) throw new Error('Recording not found.')
      setOverlayBlobDirty(false)
    },
    [overlayAudioBlob, overlayBlobDirty, publishMetadata, recordingId, recordingName, updateRecording],
  )

  const handleSaveDraft = useCallback(
    async (project: EditorProject) => {
      await persistProject(project, recordingStatus)
    },
    [persistProject, recordingStatus],
  )

  const handlePublish = useCallback(
    async (project: EditorProject, result: UploadResult) => {
      if (!youtubeConnected) {
        throw new Error('Connect YouTube in Settings before publishing.')
      }
      await persistProject(project, 'published', result)
      setRecordingStatus('published')
    },
    [persistProject, youtubeConnected],
  )

  if (recordingId) {
    if (isLoadingDraft) {
      return <p className="text-sm text-neutral-500">Loading draft recording…</p>
    }

    if (!videoUrl || durationSeconds == null || !publishMetadata) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">{loadError ?? 'Draft recording not found.'}</p>
          <Link to="/" className="text-sm text-[#5234d2] hover:underline">
            Back to lobby
          </Link>
        </div>
      )
    }

    const youtubeHint = youtubeConnected
      ? `${contentTypeLabel ?? 'Video'} · ${aspectRatio} · uploads as ${visibilityLabels[publishMetadata.privacy].toLowerCase()}.`
      : 'Connect YouTube in Settings before publishing.'

    return (
      <div className="-m-10 -mb-16 h-svh min-h-0 overflow-hidden md:-m-14 md:-mb-20 lg:-m-16 lg:-mb-24">
        {overlayMissingMessage ? (
          <p className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
            {overlayMissingMessage}
          </p>
        ) : null}
        <EditorWorkspace
          key={recordingId}
          videoUrl={videoUrl}
          videoBlob={videoBlob}
          overlayAudioUrl={overlayAudioUrl}
          overlayAudioBlob={overlayAudioBlob}
          onOverlayAudioBlobChange={handleOverlayAudioBlobChange}
          sourceDuration={Math.max(durationSeconds, 0.1)}
          assets={assets}
          recordingName={recordingName ?? ''}
          onRecordingNameChange={handleRecordingNameChange}
          youtubeConnected={youtubeConnected}
          youtubeHint={youtubeHint}
          aspectRatio={aspectRatio}
          contentTypeLabel={contentTypeLabel ?? undefined}
          publishMetadata={publishMetadata}
          onPublishMetadataChange={handlePublishMetadataChange}
          initialProject={initialProject}
          onSaveDraft={handleSaveDraft}
          onPublish={handlePublish}
        />
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <PageTitle>Editor Studio</PageTitle>
      <p className="mt-2 text-sm text-neutral-600 md:text-base">
        Open a draft recording from the lobby to review and publish it.
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-6 py-10 text-center">
        <p className="text-sm font-medium text-neutral-700">No recording selected</p>
        <p className="mt-1 text-sm text-neutral-500">
          Finish a recording session or choose a draft from your lobby.
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          Start a new recording
        </Link>
      </div>
    </div>
  )
}

import { CameraMediaPreview } from '@/components/camera-media-preview'
import { SettingsSection } from '@/components/settings/settings-section'
import { useSettings } from '@/context/settings-context'
import { useMediaSession } from '@/hooks/use-media-session'
import { DEFAULT_DEVICE_ID } from '@/lib/media-devices'
import type { VideoResolution } from '@/types/settings'

const resolutionOptions: { id: VideoResolution; label: string }[] = [
  { id: '720p', label: '720p HD' },
  { id: '1080p', label: '1080p Full HD' },
  { id: '4k', label: '4K Ultra HD' },
]

export function CameraSettingsSection() {
  const { settings, updateCamera } = useSettings()
  const camera = settings.camera

  const {
    stream,
    status,
    error,
    cameras,
    microphones,
    audioLevel,
    connect,
  } = useMediaSession(camera)

  const devicesReady = cameras.length > 0 || microphones.length > 0

  return (
    <SettingsSection
      title="My camera"
      description="Test and configure your camera and microphone for future recording sessions."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <p className="mb-2 text-sm font-medium text-neutral-700">Preview</p>
          <CameraMediaPreview
            stream={stream}
            status={status}
            error={error}
            audioLevel={audioLevel}
            camera={camera}
            onConnect={connect}
          />
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">Camera</span>
            <select
              value={camera.cameraId}
              onChange={(event) => updateCamera({ cameraId: event.target.value })}
              disabled={!devicesReady}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-50"
            >
              <option value={DEFAULT_DEVICE_ID}>System default</option>
              {cameras.map((device) => (
                <option key={device.deviceId || device.label} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">Microphone</span>
            <select
              value={camera.microphoneId}
              onChange={(event) => updateCamera({ microphoneId: event.target.value })}
              disabled={!devicesReady}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-50"
            >
              <option value={DEFAULT_DEVICE_ID}>System default</option>
              {microphones.map((device) => (
                <option key={device.deviceId || device.label} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-700">Resolution</span>
            <select
              value={camera.resolution}
              onChange={(event) =>
                updateCamera({ resolution: event.target.value as VideoResolution })
              }
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
            >
              {resolutionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5">
            <span className="text-sm font-medium text-neutral-700">Mirror my video</span>
            <input
              type="checkbox"
              checked={camera.mirrorVideo}
              onChange={(event) => updateCamera({ mirrorVideo: event.target.checked })}
              className="size-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-300"
            />
          </label>
        </div>
      </div>
    </SettingsSection>
  )
}

import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/format'
import type { ReactNode } from 'react'
import {
  ChevronDown,
  Mic,
  MicOff,
  MonitorUp,
  Sparkles,
  Square,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react'

type ActivePanel = 'camera' | 'screen' | 'effects' | null

interface RecordingControlBarProps {
  cameraEnabled: boolean
  screenShareEnabled: boolean
  micAudioEnabled: boolean
  screenAudioEnabled: boolean
  screenAudioAvailable: boolean
  isRecording: boolean
  isSaving: boolean
  elapsedSeconds: number
  maxDurationSeconds?: number | null
  activePanel: ActivePanel
  visible: boolean
  onToggleCamera: () => void
  onToggleScreenShare: () => void
  onToggleMicAudio: () => void
  onToggleScreenAudio: () => void
  onOpenCameraPanel: () => void
  onOpenScreenSharePanel: () => void
  onToggleEffectsPanel: () => void
  onStartRecording: () => void
  onStopRecording: () => void
  onReveal: () => void
}

function FloatingControl({
  label,
  enabled,
  panelOpen,
  onToggle,
  onOpenPanel,
  disabled,
  children,
  offChildren,
}: {
  label: string
  enabled: boolean
  panelOpen: boolean
  onToggle: () => void
  onOpenPanel: () => void
  disabled?: boolean
  children: ReactNode
  offChildren?: ReactNode
}) {
  return (
    <div className="flex items-stretch gap-0.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'flex size-14 shrink-0 aspect-square items-center justify-center rounded-l-[1.125rem] text-white transition disabled:cursor-not-allowed disabled:opacity-50',
          'bg-black/45 backdrop-blur-md hover:bg-black/55',
          !enabled && 'opacity-70',
        )}
      >
        {enabled ? children : (offChildren ?? children)}
      </button>
      <button
        type="button"
        onClick={onOpenPanel}
        disabled={disabled}
        aria-label={`${label} settings`}
        className={cn(
          'flex items-center justify-center rounded-r-[1.125rem] px-2 text-white transition disabled:cursor-not-allowed disabled:opacity-50',
          'bg-black/45 backdrop-blur-md hover:bg-black/55',
          panelOpen && 'bg-black/60',
        )}
      >
        <ChevronDown className={cn('size-4 transition-transform', panelOpen && 'rotate-180')} />
      </button>
    </div>
  )
}

function FloatingButton({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex size-14 shrink-0 aspect-square items-center justify-center rounded-[1.125rem] text-white transition disabled:cursor-not-allowed disabled:opacity-50',
        'bg-black/45 backdrop-blur-md hover:bg-black/55',
        active && 'bg-black/60',
      )}
    >
      {children}
    </button>
  )
}

export function RecordingControlBar({
  cameraEnabled,
  screenShareEnabled,
  micAudioEnabled,
  screenAudioEnabled,
  screenAudioAvailable,
  isRecording,
  isSaving,
  elapsedSeconds,
  maxDurationSeconds = null,
  activePanel,
  visible,
  onToggleCamera,
  onToggleScreenShare,
  onToggleMicAudio,
  onToggleScreenAudio,
  onOpenCameraPanel,
  onOpenScreenSharePanel,
  onToggleEffectsPanel,
  onStartRecording,
  onStopRecording,
  onReveal,
}: RecordingControlBarProps) {
  const timerLabel =
    maxDurationSeconds != null
      ? `${formatDuration(elapsedSeconds)} / ${formatDuration(maxDurationSeconds)}`
      : formatDuration(elapsedSeconds)

  return (
    <div
      onMouseEnter={onReveal}
      className={cn(
        'flex flex-wrap items-center justify-center gap-2 transition-all duration-300 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0',
      )}
    >
      <FloatingControl
        label={cameraEnabled ? 'Camera' : 'Camera off'}
        enabled={cameraEnabled}
        panelOpen={activePanel === 'camera'}
        onToggle={onToggleCamera}
        onOpenPanel={onOpenCameraPanel}
        disabled={isSaving}
        offChildren={<VideoOff className="size-5" />}
      >
        <Video className="size-5" />
      </FloatingControl>

      <FloatingButton
        label={micAudioEnabled ? 'Mic on' : 'Mic off'}
        active={!micAudioEnabled}
        onClick={onToggleMicAudio}
        disabled={isSaving}
      >
        {micAudioEnabled ? <Mic className="size-5" /> : <MicOff className="size-5" />}
      </FloatingButton>

      <FloatingControl
        label={screenShareEnabled ? 'Sharing' : 'Share screen'}
        enabled={screenShareEnabled}
        panelOpen={activePanel === 'screen'}
        onToggle={() => void onToggleScreenShare()}
        onOpenPanel={onOpenScreenSharePanel}
        disabled={isSaving}
      >
        <MonitorUp className="size-5" />
      </FloatingControl>

      <FloatingButton
        label={
          !screenShareEnabled
            ? 'Screen aud'
            : !screenAudioAvailable
              ? 'No aud'
              : screenAudioEnabled
                ? 'Scr on'
                : 'Scr off'
        }
        active={screenShareEnabled && screenAudioAvailable && !screenAudioEnabled}
        onClick={onToggleScreenAudio}
        disabled={isSaving || !screenShareEnabled || !screenAudioAvailable}
      >
        {screenAudioEnabled && screenAudioAvailable ? (
          <Volume2 className="size-5" />
        ) : (
          <VolumeX className="size-5" />
        )}
      </FloatingButton>

      <FloatingButton
        label="Effects"
        active={activePanel === 'effects'}
        onClick={onToggleEffectsPanel}
        disabled={isSaving}
      >
        <Sparkles className="size-5" />
      </FloatingButton>

      {isRecording ? (
        <button
          type="button"
          onClick={onStopRecording}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-full bg-red-600/95 px-5 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-red-700 disabled:opacity-60"
        >
          <Square className="size-4 fill-current" />
          {isSaving ? 'Saving draft…' : `Stop · ${timerLabel}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={onStartRecording}
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-full bg-red-600/95 px-5 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-red-700 disabled:opacity-60"
        >
          <span className="size-3 rounded-full bg-white" />
          Start recording
        </button>
      )}
    </div>
  )
}

import { CameraSidePanel } from '@/components/recording/camera-side-panel'
import { InstantEffectsPanel } from '@/components/recording/instant-effects-panel'
import { RecordingExitDialog } from '@/components/recording/recording-exit-dialog'
import { RecordingOptionsPanel } from '@/components/recording/recording-options-panel'
import { RecordingControlBar } from '@/components/recording/recording-control-bar'
import { ScreenShareSidePanel } from '@/components/recording/screen-share-side-panel'
import { useDockControlsReveal } from '@/hooks/use-dock-controls-reveal'
import { useEffectKeyboardShortcuts } from '@/hooks/use-effect-keyboard-shortcuts'
import { useEffectsLibrary } from '@/hooks/use-effects-library'
import { useInstantEffects } from '@/hooks/use-instant-effects'
import { useRecordingSession } from '@/hooks/use-recording-session'
import { aspectRatioStyle } from '@/lib/recording-session-state'
import type { LibraryEffect } from '@/types/effects-library'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, MonitorUp } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type ActivePanel = 'camera' | 'screen' | 'effects' | null

const PANEL_WIDTH = 320

export function RecordingSessionPage() {
  const navigate = useNavigate()
  const effectsLibrary = useEffectsLibrary()
  const instantEffects = useInstantEffects()
  const recording = useRecordingSession({ stickersRef: instantEffects.stickersRef })
  const previewFrame = aspectRatioStyle(recording.aspectRatio)
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [exitDialogOpen, setExitDialogOpen] = useState(false)
  const { visible: controlsVisible, reveal: revealControls } = useDockControlsReveal({
    keepVisible: activePanel !== null,
  })

  useEffect(() => {
    if (!recording.session && !recording.handingOffToEditorRef.current) {
      navigate('/', { replace: true })
    }
  }, [navigate, recording.handingOffToEditorRef, recording.session])

  const handleExitRequest = () => {
    if (recording.isSaving) return
    setExitDialogOpen(true)
  }

  const handleExitConfirm = () => {
    recording.discardSession()
    setExitDialogOpen(false)
    navigate('/')
  }

  const handleTriggerEffect = useCallback(
    (effect: LibraryEffect) => {
      instantEffects.triggerEffect(effect)
      setActivePanel(null)
    },
    [instantEffects],
  )

  useEffectKeyboardShortcuts(effectsLibrary.effectsByKey, handleTriggerEffect, !recording.isSaving)

  if (!recording.session) {
    return null
  }

  const contentLabel = recording.session.contentType.label

  return (
    <div className="flex h-svh w-full gap-2 overflow-hidden bg-neutral-950 p-2 md:gap-3 md:p-3">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div
          className={cn(
            'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-neutral-950',
            recording.isRecording && 'ring-2 ring-red-500/80',
          )}
        >
          <div className="flex size-full items-center justify-center [container-type:size]">
            <div className={previewFrame.className} style={previewFrame.style}>
              <canvas ref={recording.canvasRef} className="absolute inset-0 size-full" />
            </div>
          </div>

          <video ref={recording.cameraVideoRef} className="hidden" muted playsInline />
          <video ref={recording.screenVideoRef} className="hidden" muted playsInline />
          <video
            ref={recording.cameraBgVideoRef}
            className="hidden"
            muted
            playsInline
            loop
            crossOrigin="anonymous"
          />
          <video ref={recording.screenBgVideoRef} className="hidden" muted playsInline loop crossOrigin="anonymous" />
          <img
            ref={recording.cameraBgImageRef}
            alt=""
            aria-hidden
            className="pointer-events-none fixed top-0 -left-[9999px] h-auto w-auto opacity-0"
          />
          <img
            ref={recording.screenBgImageRef}
            alt=""
            aria-hidden
            className="pointer-events-none fixed top-0 -left-[9999px] h-auto w-auto opacity-0"
          />

          {recording.isConnecting ? (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/70 text-sm text-white">
              Connecting camera and microphone…
            </div>
          ) : null}

          {!recording.isConnecting &&
          ['searching', 'found', 'connecting'].includes(recording.deviceState) ? (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/70 text-sm text-white">
              {recording.deviceMessage ?? 'Connecting…'}
            </div>
          ) : null}

          {!recording.isConnecting && recording.deviceState === 'error' ? (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/70 p-6">
              <div className="flex max-w-sm flex-col items-center px-6 text-center">
                <p className="text-sm leading-relaxed text-white/90">
                  {recording.deviceError ?? 'Something went wrong. Please try again.'}
                </p>
                <button
                  type="button"
                  disabled={recording.isSaving}
                  onClick={() => void recording.retryDeviceMirror()}
                  className="mt-6 inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-white/90 disabled:opacity-50"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : null}

          {!recording.isConnecting &&
          recording.deviceState === 'idle' &&
          !recording.screenShareEnabled &&
          !(recording.cameraEnabled && recording.cameraLayout.displayType === 'fullscreen') ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto flex max-w-sm flex-col items-center px-6 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-white/10 text-white">
                  <MonitorUp className="size-6" strokeWidth={1.75} />
                </div>
                <h2 className="mt-5 text-lg font-semibold tracking-tight text-white">
                  Add your screen or phone
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/65">
                  Bring slides, your desktop, or a mirrored phone into the frame. Your camera can float
                  on top.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    disabled={recording.isSaving}
                    onClick={() => void recording.toggleScreenShare()}
                    className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-white/90 disabled:opacity-50"
                  >
                    Share screen
                  </button>
                  <button
                    type="button"
                    disabled={
                      recording.isSaving ||
                      ['searching', 'found', 'connecting'].includes(recording.deviceState)
                    }
                    onClick={() => void recording.startDeviceMirror()}
                    className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-white/90 disabled:opacity-50"
                  >
                    Connect Device
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-white/45">
                  Or use the share control in the bar below
                </p>
              </div>
            </div>
          ) : null}

          <div className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
            {contentLabel} · {recording.aspectRatio}
          </div>

          {recording.isRecording ? (
            <div className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">
              <span className="size-2 animate-pulse rounded-full bg-white" />
              REC
            </div>
          ) : null}
        </div>

        <div className="pointer-events-none absolute inset-0 z-30">
          {activePanel === 'effects' ? (
            <div
              className="pointer-events-auto absolute inset-0"
              onClick={() => setActivePanel(null)}
              aria-hidden
            />
          ) : null}

          <div
            className={cn(
              'pointer-events-auto absolute left-3 top-3 z-40 transition-all duration-300 ease-out md:left-4 md:top-4',
              recording.isRecording && 'pointer-events-none -translate-y-2 opacity-0',
            )}
          >
            <button
              type="button"
              onClick={handleExitRequest}
              disabled={recording.isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-black/45 px-3 py-1.5 text-sm font-medium text-white shadow-lg backdrop-blur-md transition hover:bg-black/55 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowLeft className="size-4" />
              Exit
            </button>
          </div>

          <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-40 flex justify-center pb-1">
            <div className="relative" onMouseEnter={revealControls}>
              {activePanel === 'effects' ? (
                <RecordingOptionsPanel title="Instant effects" className="w-[min(92vw,480px)]">
                  <InstantEffectsPanel
                    effects={effectsLibrary.effects}
                    isLoading={effectsLibrary.isLoading}
                    error={effectsLibrary.error}
                    onTrigger={handleTriggerEffect}
                  />
                </RecordingOptionsPanel>
              ) : null}

              <RecordingControlBar
                cameraEnabled={recording.cameraEnabled}
                screenShareEnabled={recording.screenShareEnabled}
                micAudioEnabled={recording.micAudioEnabled}
                screenAudioEnabled={recording.screenAudioEnabled}
                screenAudioAvailable={recording.screenAudioAvailable}
                isRecording={recording.isRecording}
                isSaving={recording.isSaving}
                elapsedSeconds={recording.elapsedSeconds}
                maxDurationSeconds={recording.maxDurationSeconds}
                activePanel={activePanel}
                visible={controlsVisible}
                onToggleCamera={recording.toggleCamera}
                onToggleScreenShare={() => void recording.toggleScreenShare()}
                onToggleMicAudio={recording.toggleMicAudio}
                onToggleScreenAudio={recording.toggleScreenAudio}
                onOpenCameraPanel={() =>
                  setActivePanel((current) => (current === 'camera' ? null : 'camera'))
                }
                onOpenScreenSharePanel={() =>
                  setActivePanel((current) => (current === 'screen' ? null : 'screen'))
                }
                onToggleEffectsPanel={() =>
                  setActivePanel((current) => (current === 'effects' ? null : 'effects'))
                }
                onStartRecording={recording.startRecording}
                onStopRecording={() => void recording.stopRecording()}
                onReveal={revealControls}
              />
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {activePanel === 'camera' ? (
          <motion.div
            key="camera-panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: PANEL_WIDTH, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="shrink-0 overflow-hidden"
          >
            <CameraSidePanel
              className="h-full"
              layout={recording.cameraLayout}
              assets={recording.assets}
              onClose={() => setActivePanel(null)}
              onLayoutChange={recording.setCameraLayout}
            />
          </motion.div>
        ) : null}

        {activePanel === 'screen' ? (
          <motion.div
            key="screen-panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: PANEL_WIDTH, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="shrink-0 overflow-hidden"
          >
            <ScreenShareSidePanel
              className="h-full"
              layout={recording.screenShareLayout}
              assets={recording.assets}
              onClose={() => setActivePanel(null)}
              onLayoutChange={recording.setScreenShareLayout}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <RecordingExitDialog
        open={exitDialogOpen}
        isRecording={recording.isRecording}
        onCancel={() => setExitDialogOpen(false)}
        onConfirm={handleExitConfirm}
      />
    </div>
  )
}

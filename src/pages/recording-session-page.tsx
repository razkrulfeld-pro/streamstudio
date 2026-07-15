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
import type { LibraryEffect } from '@/types/effects-library'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, MonitorUp } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type ActivePanel = 'camera' | 'screen' | 'effects' | null

const PANEL_WIDTH = 320

export function RecordingSessionPage() {
  const navigate = useNavigate()
  const effectsLibrary = useEffectsLibrary()
  const instantEffects = useInstantEffects()
  const session = useRecordingSession({ stickersRef: instantEffects.stickersRef })
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [exitDialogOpen, setExitDialogOpen] = useState(false)
  const { visible: controlsVisible, reveal: revealControls } = useDockControlsReveal({
    keepVisible: activePanel !== null,
  })

  const handleExitRequest = () => {
    if (session.isSaving) return
    setExitDialogOpen(true)
  }

  const handleExitConfirm = () => {
    session.discardSession()
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

  useEffectKeyboardShortcuts(effectsLibrary.effectsByKey, handleTriggerEffect, !session.isSaving)

  return (
    <div className="flex h-svh w-full gap-2 overflow-hidden bg-neutral-950 p-2 md:gap-3 md:p-3">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div
          className={cn(
            'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-neutral-950',
            session.isRecording && 'ring-2 ring-red-500/80',
          )}
        >
          <div className="flex size-full items-center justify-center [container-type:size]">
            <div
              className="relative aspect-video max-h-full overflow-hidden"
              style={{ width: 'min(100%, calc(100cqh * 16 / 9))' }}
            >
              <canvas ref={session.canvasRef} className="absolute inset-0 size-full" />
            </div>
          </div>

          <video ref={session.cameraVideoRef} className="hidden" muted playsInline />
          <video ref={session.screenVideoRef} className="hidden" muted playsInline />
          <video
            ref={session.cameraBgVideoRef}
            className="hidden"
            muted
            playsInline
            loop
            crossOrigin="anonymous"
          />
          <video ref={session.screenBgVideoRef} className="hidden" muted playsInline loop crossOrigin="anonymous" />
          <img
            ref={session.cameraBgImageRef}
            alt=""
            aria-hidden
            className="pointer-events-none fixed top-0 -left-[9999px] h-auto w-auto opacity-0"
          />
          <img
            ref={session.screenBgImageRef}
            alt=""
            aria-hidden
            className="pointer-events-none fixed top-0 -left-[9999px] h-auto w-auto opacity-0"
          />

          {session.isConnecting ? (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/70 text-sm text-white">
              Connecting camera and microphone…
            </div>
          ) : null}

          {!session.isConnecting &&
          !session.screenShareEnabled &&
          !(session.cameraEnabled && session.cameraLayout.displayType === 'fullscreen') ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto flex max-w-sm flex-col items-center px-6 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-white/10 text-white">
                  <MonitorUp className="size-6" strokeWidth={1.75} />
                </div>
                <h2 className="mt-5 text-lg font-semibold tracking-tight text-white">
                  Share your screen
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/65">
                  Bring your slides, product, or desktop into the frame. Your camera can float on top.
                </p>
                <button
                  type="button"
                  disabled={session.isSaving}
                  onClick={() => void session.toggleScreenShare()}
                  className="mt-6 inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-white/90 disabled:opacity-50"
                >
                  Share screen
                </button>
                <p className="mt-3 text-[11px] text-white/45">
                  Or use the share control in the bar below
                </p>
              </div>
            </div>
          ) : null}

          {session.error ? (
            <div className="absolute left-4 right-4 top-4 rounded-lg bg-black/70 px-3 py-2 text-sm text-white">
              {session.error}
            </div>
          ) : null}

          {session.isRecording ? (
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
              session.isRecording && 'pointer-events-none -translate-y-2 opacity-0',
            )}
          >
            <button
              type="button"
              onClick={handleExitRequest}
              disabled={session.isSaving}
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
                cameraEnabled={session.cameraEnabled}
                screenShareEnabled={session.screenShareEnabled}
                micAudioEnabled={session.micAudioEnabled}
                screenAudioEnabled={session.screenAudioEnabled}
                screenAudioAvailable={session.screenAudioAvailable}
                isRecording={session.isRecording}
                isSaving={session.isSaving}
                elapsedSeconds={session.elapsedSeconds}
                activePanel={activePanel}
                visible={controlsVisible}
                onToggleCamera={session.toggleCamera}
                onToggleScreenShare={() => void session.toggleScreenShare()}
                onToggleMicAudio={session.toggleMicAudio}
                onToggleScreenAudio={session.toggleScreenAudio}
                onOpenCameraPanel={() =>
                  setActivePanel((current) => (current === 'camera' ? null : 'camera'))
                }
                onOpenScreenSharePanel={() =>
                  setActivePanel((current) => (current === 'screen' ? null : 'screen'))
                }
                onToggleEffectsPanel={() =>
                  setActivePanel((current) => (current === 'effects' ? null : 'effects'))
                }
                onStartRecording={session.startRecording}
                onStopRecording={() => void session.stopRecording()}
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
              layout={session.cameraLayout}
              assets={session.assets}
              onClose={() => setActivePanel(null)}
              onLayoutChange={session.setCameraLayout}
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
              layout={session.screenShareLayout}
              assets={session.assets}
              onClose={() => setActivePanel(null)}
              onLayoutChange={session.setScreenShareLayout}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <RecordingExitDialog
        open={exitDialogOpen}
        isRecording={session.isRecording}
        onCancel={() => setExitDialogOpen(false)}
        onConfirm={handleExitConfirm}
      />
    </div>
  )
}

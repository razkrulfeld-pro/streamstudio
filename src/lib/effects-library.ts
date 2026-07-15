import { preloadStickerImage } from '@/lib/floating-stickers'
import type { EffectManifestEntry, LibraryEffect } from '@/types/effects-library'

export const DEFAULT_EFFECT_DURATION_S = 4

const IMAGE_EXTENSIONS = ['png', 'webp', 'gif'] as const
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg'] as const

export function getEffectAssetUrls(id: string): { imageUrl: string; audioUrl: string } {
  return {
    imageUrl: `/effects/${id}.png`,
    audioUrl: `/effects/${id}.mp3`,
  }
}

export function toLibraryEffect(entry: EffectManifestEntry): LibraryEffect {
  const urls = getEffectAssetUrls(entry.id)
  return {
    ...entry,
    ...urls,
    durationS: entry.durationS ?? DEFAULT_EFFECT_DURATION_S,
  }
}

export async function loadEffectsManifest(): Promise<LibraryEffect[]> {
  const response = await fetch('/effects/effects.json', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('Could not load effects manifest.')
  }

  const raw = (await response.json()) as EffectManifestEntry[]
  if (!Array.isArray(raw)) {
    throw new Error('Effects manifest must be an array.')
  }

  return raw
    .filter((entry) => typeof entry.id === 'string' && typeof entry.key === 'string')
    .map((entry) =>
      toLibraryEffect({
        ...entry,
        label: entry.label ?? entry.id,
      }),
    )
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

let audioContext: AudioContext | null = null
let micSource: MediaStreamAudioSourceNode | null = null
let screenSource: MediaStreamAudioSourceNode | null = null
let micGain: GainNode | null = null
let screenGain: GainNode | null = null
let mixDestination: MediaStreamAudioDestinationNode | null = null
let activeSource: AudioBufferSourceNode | null = null
let activeGain: GainNode | null = null
let activeStopTimer: number | null = null

const bufferCache = new Map<string, AudioBuffer>()
const bufferLoads = new Map<string, Promise<AudioBuffer>>()

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

async function ensureAudioContextRunning(): Promise<AudioContext> {
  const context = getAudioContext()
  if (context.state === 'suspended') {
    await context.resume().catch(() => undefined)
  }
  return context
}

async function loadEffectBuffer(audioUrl: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(audioUrl)
  if (cached) return cached

  const inflight = bufferLoads.get(audioUrl)
  if (inflight) return inflight

  const load = (async () => {
    const response = await fetch(audioUrl)
    if (!response.ok) {
      throw new Error(`Failed to load effect audio: ${audioUrl}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    const buffer = await getAudioContext().decodeAudioData(arrayBuffer.slice(0))
    bufferCache.set(audioUrl, buffer)
    bufferLoads.delete(audioUrl)
    return buffer
  })().catch((error) => {
    bufferLoads.delete(audioUrl)
    throw error
  })

  bufferLoads.set(audioUrl, load)
  return load
}

export function preloadEffectAssets(effect: LibraryEffect): void {
  preloadStickerImage(effect.imageUrl)
  void loadEffectBuffer(effect.audioUrl).catch(() => undefined)
}

function clearActiveEffectAudio() {
  if (activeStopTimer !== null) {
    window.clearTimeout(activeStopTimer)
    activeStopTimer = null
  }

  if (activeSource) {
    try {
      activeSource.stop()
    } catch {
      // already stopped
    }
    activeSource.disconnect()
    activeSource = null
  }

  if (activeGain) {
    activeGain.disconnect()
    activeGain = null
  }
}

let micCaptureEnabled = true
let screenAudioCaptureEnabled = true

export function setMicCaptureEnabled(enabled: boolean) {
  micCaptureEnabled = enabled
  if (micGain) {
    micGain.gain.value = enabled ? 1 : 0
  }
}

export function setScreenAudioCaptureEnabled(enabled: boolean) {
  screenAudioCaptureEnabled = enabled
  if (screenGain) {
    screenGain.gain.value = enabled ? 1 : 0
  }
}

export function getMicCaptureEnabled() {
  return micCaptureEnabled
}

export function getScreenAudioCaptureEnabled() {
  return screenAudioCaptureEnabled
}

export async function beginRecordingAudioMix(
  micStream: MediaStream,
  screenStream?: MediaStream | null,
): Promise<MediaStreamTrack | null> {
  const context = await ensureAudioContextRunning()

  endRecordingAudioMix()

  const micTrack = micStream.getAudioTracks().find((track) => track.readyState === 'live')
  const screenTrack = screenStream?.getAudioTracks().find((track) => track.readyState === 'live')
  if (!micTrack && !screenTrack) {
    return null
  }

  mixDestination = context.createMediaStreamDestination()

  if (micTrack) {
    micGain = context.createGain()
    micGain.gain.value = micCaptureEnabled ? 1 : 0
    micSource = context.createMediaStreamSource(new MediaStream([micTrack]))
    micSource.connect(micGain)
    micGain.connect(mixDestination)
  }

  if (screenTrack) {
    screenGain = context.createGain()
    screenGain.gain.value = screenAudioCaptureEnabled ? 1 : 0
    screenSource = context.createMediaStreamSource(new MediaStream([screenTrack]))
    screenSource.connect(screenGain)
    screenGain.connect(mixDestination)
  }

  return mixDestination.stream.getAudioTracks()[0] ?? null
}

export function endRecordingAudioMix() {
  if (micSource) {
    micSource.disconnect()
    micSource = null
  }
  if (screenSource) {
    screenSource.disconnect()
    screenSource = null
  }
  if (micGain) {
    micGain.disconnect()
    micGain = null
  }
  if (screenGain) {
    screenGain.disconnect()
    screenGain = null
  }
  mixDestination = null
}

export async function playEffectAudio(audioUrl: string): Promise<void> {
  clearActiveEffectAudio()

  const context = await ensureAudioContextRunning()
  const buffer = await loadEffectBuffer(audioUrl)

  const source = context.createBufferSource()
  source.buffer = buffer

  const gain = context.createGain()
  gain.gain.value = 1

  source.connect(gain)
  gain.connect(context.destination)
  if (mixDestination && micGain) {
    // Route effect SFX into the recording mix via the mic stem
    gain.connect(micGain)
  } else if (mixDestination) {
    gain.connect(mixDestination)
  }

  const fadeSeconds = Math.min(1, buffer.duration)
  const fadeStart = Math.max(0, buffer.duration - fadeSeconds)
  if (fadeSeconds > 0) {
    gain.gain.setValueAtTime(1, context.currentTime + fadeStart)
    gain.gain.linearRampToValueAtTime(0, context.currentTime + buffer.duration)
  }

  activeSource = source
  activeGain = gain

  source.onended = () => {
    if (activeSource === source) {
      clearActiveEffectAudio()
    }
  }

  source.start(0)
  activeStopTimer = window.setTimeout(() => {
    if (activeSource === source) {
      clearActiveEffectAudio()
    }
  }, Math.ceil(buffer.duration * 1000) + 50)
}

export { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS }

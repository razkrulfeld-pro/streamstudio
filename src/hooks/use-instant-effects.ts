import { playEffectAudio } from '@/lib/effects-library'
import type { FloatingSticker } from '@/lib/floating-stickers'
import type { LibraryEffect } from '@/types/effects-library'
import { useCallback, useRef } from 'react'

export type { FloatingSticker }

export function useInstantEffects() {
  const stickersRef = useRef<FloatingSticker[]>([])

  const triggerEffect = useCallback((effect: LibraryEffect) => {
    void playEffectAudio(effect.audioUrl)
      .then(() => {
        const sticker: FloatingSticker = {
          id: crypto.randomUUID(),
          imageUrl: effect.imageUrl,
          label: effect.label,
          durationS: effect.durationS,
          startedAtMs: performance.now(),
          driftX: (Math.random() - 0.5) * 180,
          wobble: (Math.random() - 0.5) * 90,
          spin: (Math.random() - 0.5) * 28,
          size: (7 + Math.random() * 4) * 2.25,
        }

        stickersRef.current = [...stickersRef.current, sticker]

        window.setTimeout(() => {
          stickersRef.current = stickersRef.current.filter((item) => item.id !== sticker.id)
        }, effect.durationS * 1000)
      })
      .catch(() => undefined)
  }, [])

  return { stickersRef, triggerEffect }
}

import { loadEffectsManifest, preloadEffectAssets } from '@/lib/effects-library'
import type { LibraryEffect } from '@/types/effects-library'
import { useEffect, useMemo, useState } from 'react'

export function useEffectsLibrary() {
  const [effects, setEffects] = useState<LibraryEffect[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void loadEffectsManifest()
      .then((loaded) => {
        if (!active) return
        setEffects(loaded)
        setError(null)
        for (const effect of loaded) {
          preloadEffectAssets(effect)
        }
      })
      .catch((loadError) => {
        if (!active) return
        setEffects([])
        setError(loadError instanceof Error ? loadError.message : 'Failed to load effects.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const effectsByKey = useMemo(() => {
    const map = new Map<string, LibraryEffect>()
    for (const effect of effects) {
      map.set(effect.key, effect)
    }
    return map
  }, [effects])

  return { effects, effectsByKey, isLoading, error }
}

import { isTypingTarget } from '@/lib/effects-library'
import type { LibraryEffect } from '@/types/effects-library'
import { useEffect } from 'react'

export function useEffectKeyboardShortcuts(
  effectsByKey: Map<string, LibraryEffect>,
  onTrigger: (effect: LibraryEffect) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const effect = effectsByKey.get(event.key)
      if (!effect) return

      event.preventDefault()
      onTrigger(effect)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [effectsByKey, onTrigger, enabled])
}

import type { LibraryEffect } from '@/types/effects-library'

interface InstantEffectsPanelProps {
  effects: LibraryEffect[]
  isLoading?: boolean
  error?: string | null
  onTrigger: (effect: LibraryEffect) => void
}

export function InstantEffectsPanel({
  effects,
  isLoading = false,
  error = null,
  onTrigger,
}: InstantEffectsPanelProps) {
  if (isLoading) {
    return <p className="text-xs text-neutral-500">Loading effects library…</p>
  }

  if (error) {
    return <p className="text-xs text-red-500">{error}</p>
  }

  if (effects.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        Add sticker + audio pairs to <code className="text-neutral-700">public/effects</code> and list them in{' '}
        <code className="text-neutral-700">effects.json</code>.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-600">
        Tap an effect or press its number key — sticker + sound go live instantly.
      </p>
      <div className="grid max-h-[min(42vh,280px)] grid-cols-4 gap-3 overflow-y-auto pr-1">
        {effects.map((effect) => (
          <button
            key={effect.id}
            type="button"
            title={`${effect.label} (key ${effect.key})`}
            onClick={() => onTrigger(effect)}
            className="group relative flex flex-col items-center gap-1 bg-transparent p-1 text-center transition hover:scale-105 active:scale-95"
          >
            <div className="relative flex aspect-square w-full items-center justify-center">
              <span className="absolute left-0 top-0 z-10 text-[10px] font-medium text-neutral-400/75">
                {effect.key}
              </span>
              <img
                src={effect.imageUrl}
                alt=""
                className="max-h-full max-w-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.18)] transition group-hover:drop-shadow-[0_6px_16px_rgba(0,0,0,0.22)]"
                draggable={false}
              />
            </div>
            <span className="line-clamp-1 text-[10px] font-medium text-neutral-500">{effect.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

import { drawOrbBackground, ORB_PRESET_LABELS, type OrbPreset } from '@/lib/orb-background'
import { cn } from '@/lib/utils'
import { useEffect, useRef } from 'react'

interface OrbPresetThumbProps {
  preset: OrbPreset
  selected: boolean
  onClick: () => void
}

export function OrbPresetThumb({ preset, selected, onClick }: OrbPresetThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const resize = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width
        canvas.height = height
      }
    }

    resize()

    let frame = 0
    const render = () => {
      resize()
      context.clearRect(0, 0, canvas.width, canvas.height)
      drawOrbBackground(context, { x: 0, y: 0, width: canvas.width, height: canvas.height }, performance.now(), preset)
      frame = requestAnimationFrame(render)
    }

    render()

    return () => cancelAnimationFrame(frame)
  }, [preset])

  return (
    <button
      type="button"
      onClick={onClick}
      title={ORB_PRESET_LABELS[preset]}
      className={cn(
        'aspect-square overflow-hidden rounded-lg ring-2 ring-offset-2 ring-offset-neutral-800 transition',
        selected ? 'ring-white' : 'ring-transparent hover:ring-neutral-500',
      )}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </button>
  )
}

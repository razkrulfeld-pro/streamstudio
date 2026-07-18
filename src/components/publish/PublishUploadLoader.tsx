import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { Clapperboard, Rocket, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

type UploadLoaderPhase = 'exporting' | 'uploading'

const sublines = [
  'Polishing the cut...',
  'Packing the upload...',
  'Handing it to YouTube...',
  'Getting your watch link ready...',
]

interface PublishUploadLoaderProps {
  phase: UploadLoaderPhase
  progress: number
}

export function PublishUploadLoader({ phase, progress }: PublishUploadLoaderProps) {
  const [lineIndex, setLineIndex] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLineIndex((current) => (current + 1) % sublines.length)
    }, 2200)

    return () => window.clearInterval(timer)
  }, [])

  const safeProgress = Math.min(100, Math.max(0, Math.round(progress)))
  const label =
    phase === 'exporting'
      ? 'Rendering your edit...'
      : safeProgress >= 92
        ? 'Almost there...'
        : 'Sending to YouTube...'

  return (
    <div className="mt-5 rounded-2xl border border-violet-100 bg-gradient-to-b from-violet-50 to-white p-5 text-center">
      <div className="relative mx-auto flex size-28 items-center justify-center">
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-[#5234d2]/10"
          animate={{ scale: [0.92, 1.08, 0.92], opacity: [0.55, 0.9, 0.55] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="relative flex size-20 items-center justify-center rounded-3xl bg-[#5234d2] text-white shadow-lg shadow-violet-200"
          animate={{ y: [0, -8, 0], rotate: phase === 'uploading' ? [0, 3, -3, 0] : 0 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          {phase === 'exporting' ? <Clapperboard className="size-9" /> : <Rocket className="size-9" />}
        </motion.div>
        <motion.div
          className="absolute right-4 top-5 rounded-full bg-white p-1.5 text-amber-500 shadow"
          animate={{ scale: [1, 1.18, 1], rotate: [0, 12, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Sparkles className="size-4" />
        </motion.div>
      </div>

      <p className="mt-4 text-lg font-semibold text-neutral-900">{label}</p>
      <p className="mt-1 text-sm text-neutral-500">{sublines[lineIndex]}</p>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs font-medium text-neutral-500">
          <span>{phase === 'exporting' ? 'Render' : 'Upload'}</span>
          <span>{safeProgress}%</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-white shadow-inner">
          <motion.div
            className={cn('h-full rounded-full bg-[#5234d2]')}
            initial={false}
            animate={{ width: `${Math.max(2, safeProgress)}%` }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
        </div>
      </div>
    </div>
  )
}

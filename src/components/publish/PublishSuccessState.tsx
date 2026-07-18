import type { UploadResult } from '@/lib/types/youtube'
import { motion } from 'framer-motion'
import { CheckCircle2, Copy, ExternalLink, Sparkles } from 'lucide-react'
import { useState } from 'react'

interface PublishSuccessStateProps {
  result: UploadResult
  onDone: () => void
}

export function PublishSuccessState({ result, onDone }: PublishSuccessStateProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!navigator.clipboard) return
    await navigator.clipboard.writeText(result.videoUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-5 text-center">
      <motion.div
        className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-100"
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      >
        <CheckCircle2 className="size-8" />
      </motion.div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <Sparkles className="size-4 text-amber-500" />
        <h3 className="text-lg font-semibold text-neutral-900">It&apos;s on YouTube!</h3>
      </div>
      <p className="mt-2 text-sm text-neutral-600">
        Upload complete. YouTube may take up to about 1 minute to finish processing before the
        video is fully live and playable everywhere.
      </p>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <a
          href={result.videoUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#5234d2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#4529b8]"
        >
          Watch on YouTube
          <ExternalLink className="size-4" />
        </a>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
        >
          <Copy className="size-4" />
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Done
      </button>
    </div>
  )
}

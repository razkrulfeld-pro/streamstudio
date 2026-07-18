import { Plus } from 'lucide-react'

interface NewRecordingCardProps {
  onOpenPicker: () => void
}

export function NewRecordingCard({ onOpenPicker }: NewRecordingCardProps) {
  return (
    <button type="button" onClick={onOpenPicker} className="group block w-full text-left">
      <div className="flex aspect-video items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 transition-colors group-hover:border-neutral-300 group-hover:bg-neutral-100/80">
        <div className="flex flex-col items-center gap-2 text-neutral-500 transition-colors group-hover:text-neutral-700">
          <div className="flex size-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-neutral-200">
            <Plus className="size-5" strokeWidth={2} />
          </div>
          <span className="text-sm font-medium">New Session</span>
        </div>
      </div>

      <div className="mt-3 pr-2">
        <h3 className="text-sm font-medium text-neutral-900">Start a session</h3>
        <p className="mt-1 text-xs text-neutral-500">Shorts or Videos</p>
      </div>
    </button>
  )
}

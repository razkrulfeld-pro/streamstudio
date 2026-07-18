import { ContentTypePickerDialog } from '@/components/content-type-picker-dialog'
import { NewRecordingCard } from '@/components/new-recording-card'
import { PageTitle } from '@/components/page-title'
import { RecordingCard } from '@/components/recording-card'
import { useRecordings } from '@/context/recordings-context'
import { useSettings } from '@/context/settings-context'
import { getFirstName } from '@/lib/settings-storage'
import { Clapperboard } from 'lucide-react'
import { useState } from 'react'

function LobbyEmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/70 px-6 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200">
        <Clapperboard className="size-7 text-neutral-700" strokeWidth={1.75} />
      </div>
      <h3 className="mt-6 text-xl font-semibold tracking-tight text-neutral-900">
        No recordings yet
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-500">
        Your drafts and published videos will show up here. Start with a Short or a full video —
        whichever fits the moment.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="mt-8 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
      >
        Start a recording
      </button>
    </div>
  )
}

export function LobbyPage() {
  const { settings } = useSettings()
  const { recordings, isLoading } = useRecordings()
  const firstName = getFirstName(settings.account.fullName)
  const [pickerOpen, setPickerOpen] = useState(false)
  const isEmpty = !isLoading && recordings.length === 0

  return (
    <div>
      <PageTitle>Hi {firstName},</PageTitle>
      <p className="mt-2 text-base text-neutral-600 md:text-lg">
        Let&apos;s get your next video ready.
      </p>

      <section className="mt-10">
        {isEmpty ? (
          <LobbyEmptyState onStart={() => setPickerOpen(true)} />
        ) : (
          <>
            <h3 className="mb-5 text-base font-medium text-neutral-900">Recent recordings</h3>
            <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <NewRecordingCard onOpenPicker={() => setPickerOpen(true)} />
              {recordings.map((recording) => (
                <RecordingCard key={recording.id} recording={recording} />
              ))}
            </div>
          </>
        )}
      </section>

      <ContentTypePickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  )
}

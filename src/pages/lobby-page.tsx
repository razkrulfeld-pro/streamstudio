import { NewRecordingCard } from '@/components/new-recording-card'
import { PageTitle } from '@/components/page-title'
import { RecordingCard } from '@/components/recording-card'
import { useRecordings } from '@/context/recordings-context'
import { useSettings } from '@/context/settings-context'
import { getFirstName } from '@/lib/settings-storage'

export function LobbyPage() {
  const { settings } = useSettings()
  const { recordings } = useRecordings()
  const firstName = getFirstName(settings.account.fullName)

  return (
    <div>
      <PageTitle>Hi {firstName},</PageTitle>
      <p className="mt-2 text-base text-neutral-600 md:text-lg">
        Let&apos;s get your next video ready.
      </p>

      <section className="mt-10">
        <h3 className="mb-5 text-base font-medium text-neutral-900">Recent recordings</h3>
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <NewRecordingCard />
          {recordings.map((recording) => (
            <RecordingCard key={recording.id} recording={recording} />
          ))}
        </div>
        {recordings.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">
            Finished and published videos stay here too — open any card to keep editing.
          </p>
        ) : null}
      </section>
    </div>
  )
}

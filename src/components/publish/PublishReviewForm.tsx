import {
  categoryOptions,
  formatTagsInput,
  getCategoryLabel,
  getVisibilityLabel,
  parseTagsInput,
  visibilityOptions,
} from '@/lib/youtube-upload-options'
import type { SessionYouTubeMetadata } from '@/types/session'
import type { YoutubeVisibility } from '@/types/settings'
import { useEffect, useState } from 'react'

interface PublishReviewFormProps {
  metadata: SessionYouTubeMetadata
  contentTypeLabel?: string
  onChange: (metadata: SessionYouTubeMetadata) => void
  disabled?: boolean
}

export function PublishReviewForm({
  metadata,
  contentTypeLabel,
  onChange,
  disabled = false,
}: PublishReviewFormProps) {
  const [tagsInput, setTagsInput] = useState(() => formatTagsInput(metadata.tags))

  useEffect(() => {
    setTagsInput(formatTagsInput(metadata.tags))
  }, [metadata.tags])

  const updateMetadata = (patch: Partial<SessionYouTubeMetadata>) => {
    onChange({ ...metadata, ...patch })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-400">
          Recording setup
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-700">
          {contentTypeLabel ? (
            <span className="rounded-full bg-white px-2.5 py-1 font-medium shadow-sm">
              {contentTypeLabel}
            </span>
          ) : null}
          <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">
            {getVisibilityLabel(metadata.privacy)}
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">
            {getCategoryLabel(metadata.categoryId)}
          </span>
          {metadata.maxDurationSeconds != null ? (
            <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">
              Max {metadata.maxDurationSeconds}s
            </span>
          ) : null}
        </div>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700">Title</span>
        <input
          type="text"
          value={metadata.title}
          disabled={disabled}
          onChange={(event) => updateMetadata({ title: event.target.value })}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 disabled:opacity-50"
        />
        {metadata.titleSuffix ? (
          <p className="mt-1 text-xs text-neutral-500">
            Uploads as &ldquo;{metadata.title.trim() || 'Untitled recording'}
            {metadata.titleSuffix}&rdquo;
          </p>
        ) : null}
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700">Description</span>
        <textarea
          value={metadata.description}
          disabled={disabled}
          rows={4}
          onChange={(event) => updateMetadata({ description: event.target.value })}
          className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 disabled:opacity-50"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">Privacy</span>
          <select
            value={metadata.privacy}
            disabled={disabled}
            onChange={(event) =>
              updateMetadata({ privacy: event.target.value as YoutubeVisibility })
            }
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 disabled:opacity-50"
          >
            {visibilityOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">Category</span>
          <select
            value={metadata.categoryId}
            disabled={disabled}
            onChange={(event) => updateMetadata({ categoryId: event.target.value })}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 disabled:opacity-50"
          >
            {categoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700">Tags</span>
        <input
          type="text"
          value={tagsInput}
          disabled={disabled}
          placeholder="comma, separated, tags"
          onChange={(event) => {
            const nextValue = event.target.value
            setTagsInput(nextValue)
            updateMetadata({ tags: parseTagsInput(nextValue) })
          }}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 disabled:opacity-50"
        />
      </label>

      <label className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5">
        <span className="text-sm font-medium text-neutral-700">Made for kids</span>
        <input
          type="checkbox"
          checked={metadata.madeForKids}
          disabled={disabled}
          onChange={(event) => updateMetadata({ madeForKids: event.target.checked })}
          className="size-4 rounded border-neutral-300"
        />
      </label>
    </div>
  )
}

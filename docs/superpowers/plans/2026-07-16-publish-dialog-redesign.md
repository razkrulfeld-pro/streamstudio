# Publish Dialog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an editable YouTube publish review dialog, a single playful combined export/upload loader, and a success state with the YouTube link.

**Architecture:** Keep upload orchestration in `PublishButton`, but split reusable UI and option data into focused files. Add pure helper coverage for metadata/tag/progress behavior, then verify React UI with TypeScript build and manual browser checks.

**Tech Stack:** React 19, TypeScript 6, Tailwind CSS 4 classes, `framer-motion`, `lucide-react`, Node built-in `node:test`, Vite build.

## Global Constraints

- Do not change content type (Short / Standard / Square) at publish time.
- Do not add Lottie or new animation libraries; use existing `framer-motion` + CSS.
- One loader must cover both export and YouTube upload; do not show a second spinner/progress UI.
- Combined progress maps export to 0-35% and upload to 35-100%.
- Success copy must mention YouTube may take up to about 1 minute to finish processing before the video is fully live/playable everywhere.
- Preserve the existing duration limit guard before export/upload starts.
- Do not implement upload cancellation; dialog remains locked while busy.

---

## File Structure

- Create `src/lib/youtube-upload-options.ts`: shared visibility/category options and small pure helpers for labels, tag parsing, and combined progress.
- Create `src/lib/youtube-upload-options.test.ts`: Node tests for helper behavior.
- Create `src/components/publish/PublishReviewForm.tsx`: editable metadata form for title, description, privacy, tags, category, and made-for-kids.
- Create `src/components/publish/PublishUploadLoader.tsx`: single animated combined loader for exporting and uploading.
- Create `src/components/publish/PublishSuccessState.tsx`: happy success state with watch link, copy link, and Done.
- Modify `src/components/PublishButton.tsx`: own dialog state, metadata draft, export/upload flow, combined phase rendering, and callback wiring.
- Modify `src/components/editor/editor-workspace.tsx`: replace title-only callback usage with full `onPublishMetadataChange`.
- Modify `src/components/settings/youtube-settings-section.tsx`: import shared YouTube options instead of local duplicated arrays.

---

### Task 1: Shared YouTube Publish Helpers

**Files:**
- Create: `src/lib/youtube-upload-options.ts`
- Create: `src/lib/youtube-upload-options.test.ts`
- Modify: `src/components/settings/youtube-settings-section.tsx`

**Interfaces:**
- Produces:
  - `visibilityOptions: { id: YoutubeVisibility; label: string }[]`
  - `categoryOptions: { id: string; label: string }[]`
  - `getVisibilityLabel(value: YoutubeVisibility): string`
  - `getCategoryLabel(categoryId: string): string`
  - `parseTagsInput(value: string): string[]`
  - `formatTagsInput(tags: string[]): string`
  - `getCombinedPublishProgress(phase: 'idle' | 'exporting' | 'uploading', exportProgress: number, uploadProgress: number): number`
- Consumes:
  - `YoutubeVisibility` from `src/types/settings.ts`

- [x] **Step 1: Write the failing helper tests**

Create `src/lib/youtube-upload-options.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatTagsInput,
  getCategoryLabel,
  getCombinedPublishProgress,
  getVisibilityLabel,
  parseTagsInput,
} from './youtube-upload-options.ts'

test('parseTagsInput trims blanks and removes duplicate tags case-insensitively', () => {
  assert.deepEqual(parseTagsInput('streaming, demo, streaming,  Demo , , youtube'), [
    'streaming',
    'demo',
    'youtube',
  ])
})

test('formatTagsInput joins tags for the editable text field', () => {
  assert.equal(formatTagsInput(['streaming', 'demo', 'youtube']), 'streaming, demo, youtube')
})

test('getCombinedPublishProgress maps export to the first 35 percent', () => {
  assert.equal(getCombinedPublishProgress('idle', 0, 0), 0)
  assert.equal(getCombinedPublishProgress('exporting', 50, 0), 18)
  assert.equal(getCombinedPublishProgress('exporting', 100, 0), 35)
})

test('getCombinedPublishProgress maps upload to the remaining 65 percent', () => {
  assert.equal(getCombinedPublishProgress('uploading', 0, 0), 35)
  assert.equal(getCombinedPublishProgress('uploading', 0, 50), 68)
  assert.equal(getCombinedPublishProgress('uploading', 100, 100), 100)
})

test('labels fall back gracefully for unknown category ids', () => {
  assert.equal(getVisibilityLabel('unlisted'), 'Unlisted')
  assert.equal(getCategoryLabel('22'), 'People & Blogs')
  assert.equal(getCategoryLabel('999'), 'Category 999')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types src/lib/youtube-upload-options.test.ts`

Expected: FAIL with an import/module error because `src/lib/youtube-upload-options.ts` does not exist yet.

- [ ] **Step 3: Add the helper implementation**

Create `src/lib/youtube-upload-options.ts`:

```ts
import type { YoutubeVisibility } from '@/types/settings'

export const visibilityOptions: { id: YoutubeVisibility; label: string }[] = [
  { id: 'public', label: 'Public' },
  { id: 'unlisted', label: 'Unlisted' },
  { id: 'private', label: 'Private' },
]

export const categoryOptions = [
  { id: '22', label: 'People & Blogs' },
  { id: '27', label: 'Education' },
  { id: '28', label: 'Science & Technology' },
  { id: '24', label: 'Entertainment' },
]

export type PublishPhase = 'idle' | 'exporting' | 'uploading'

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export function getVisibilityLabel(value: YoutubeVisibility): string {
  return visibilityOptions.find((option) => option.id === value)?.label ?? value
}

export function getCategoryLabel(categoryId: string): string {
  return categoryOptions.find((option) => option.id === categoryId)?.label ?? `Category ${categoryId}`
}

export function parseTagsInput(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const rawTag of value.split(',')) {
    const tag = rawTag.trim()
    const key = tag.toLocaleLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }

  return tags
}

export function formatTagsInput(tags: string[]): string {
  return tags.join(', ')
}

export function getCombinedPublishProgress(
  phase: PublishPhase,
  exportProgress: number,
  uploadProgress: number,
): number {
  if (phase === 'exporting') {
    return Math.round(clampProgress(exportProgress) * 0.35)
  }

  if (phase === 'uploading') {
    return Math.round(35 + clampProgress(uploadProgress) * 0.65)
  }

  return 0
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `node --experimental-strip-types src/lib/youtube-upload-options.test.ts`

Expected: PASS for all five tests.

- [ ] **Step 5: Share options with the settings page**

Modify the top of `src/components/settings/youtube-settings-section.tsx`:

```ts
import { SettingsSection } from '@/components/settings/settings-section'
import { useSettings } from '@/context/settings-context'
import { getAuthStatus, getAuthUrl, getChannelInfo, logout } from '@/lib/api'
import type { ChannelInfo } from '@/lib/types/youtube'
import { categoryOptions, visibilityOptions } from '@/lib/youtube-upload-options'
import { cn } from '@/lib/utils'
import type { YoutubeVisibility } from '@/types/settings'
import { CheckCircle2, Loader2, Video } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
```

Delete the local `visibilityOptions` and `categoryOptions` arrays from `youtube-settings-section.tsx`.

- [ ] **Step 6: Run build**

Run: `npm run build`

Expected: PASS with TypeScript and Vite build output.

---

### Task 2: Editable Publish Review Form

**Files:**
- Create: `src/components/publish/PublishReviewForm.tsx`
- Modify: `src/components/PublishButton.tsx`
- Modify: `src/components/editor/editor-workspace.tsx`

**Interfaces:**
- Consumes:
  - `SessionYouTubeMetadata` from `src/types/session.ts`
  - `visibilityOptions`, `categoryOptions`, `formatTagsInput`, `parseTagsInput`, `getCategoryLabel`, `getVisibilityLabel` from Task 1
- Produces:
  - `PublishReviewForm` React component
  - `PublishButtonProps.onPublishMetadataChange?: (metadata: SessionYouTubeMetadata) => void`

- [ ] **Step 1: Create the review form component**

Create `src/components/publish/PublishReviewForm.tsx`:

```tsx
import {
  categoryOptions,
  formatTagsInput,
  getCategoryLabel,
  getVisibilityLabel,
  parseTagsInput,
  visibilityOptions,
} from '@/lib/youtube-upload-options'
import type { YoutubeVisibility } from '@/types/settings'
import type { SessionYouTubeMetadata } from '@/types/session'
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
```

- [ ] **Step 2: Generalize `PublishButton` metadata props**

In `src/components/PublishButton.tsx`, replace `onTitleChange` with:

```ts
  contentTypeLabel?: string
  onPublished?: (result: UploadResult) => void | Promise<void>
  onPublishMetadataChange?: (metadata: SessionYouTubeMetadata) => void
```

In the component parameters, replace `onTitleChange` with `onPublishMetadataChange`, and add:

```ts
  const [draftMetadata, setDraftMetadata] = useState(publishMetadata)
```

Replace the open-reset effect with:

```ts
  useEffect(() => {
    if (open) {
      setDraftMetadata(publishMetadata)
      setLocalError(null)
      setPhase('idle')
      setExportProgress(0)
    }
  }, [open, publishMetadata])
```

Add:

```ts
  const handleMetadataChange = (metadata: SessionYouTubeMetadata) => {
    setDraftMetadata(metadata)
    onPublishMetadataChange?.(metadata)
  }
```

- [ ] **Step 3: Use draft metadata for upload**

In `handleConfirm`, replace `publishMetadata` usages for upload metadata with `draftMetadata`:

```ts
    const maxDuration = draftMetadata.maxDurationSeconds
```

and:

```ts
      const metadata = toUploadMetadata(
        { ...draftMetadata, title: draftMetadata.title.trim() || 'Untitled recording' },
        exportBlob.type || 'video/webm',
      )
```

- [ ] **Step 4: Render the review form instead of read-only summary**

Import the form:

```ts
import { PublishReviewForm } from '@/components/publish/PublishReviewForm'
```

Replace the title field and read-only `<dl>` review block with:

```tsx
                    <PublishReviewForm
                      metadata={draftMetadata}
                      contentTypeLabel={contentTypeLabel}
                      onChange={handleMetadataChange}
                      disabled={busy}
                    />
```

- [ ] **Step 5: Wire parents to the new callback**

In both `PublishButton` call sites in `src/components/editor/editor-workspace.tsx`, replace:

```tsx
              onTitleChange={(title) =>
                onPublishMetadataChange?.({ ...publishMetadata, title })
              }
```

and:

```tsx
        onTitleChange={(title) => onPublishMetadataChange?.({ ...publishMetadata, title })}
```

with:

```tsx
              onPublishMetadataChange={onPublishMetadataChange}
```

and:

```tsx
        onPublishMetadataChange={onPublishMetadataChange}
```

Pass content type label when available at the header call site:

```tsx
              contentTypeLabel={contentTypeLabel ?? undefined}
```

For `ExportPanel`, add `contentTypeLabel?: string` only if the surrounding component already has the value in scope; otherwise omit it and let the form show privacy/category/max-duration chips.

- [ ] **Step 6: Run build**

Run: `npm run build`

Expected: PASS. If TypeScript reports stale `onTitleChange` props, remove the old prop from all call sites.

---

### Task 3: Single Playful Combined Loader

**Files:**
- Create: `src/components/publish/PublishUploadLoader.tsx`
- Modify: `src/components/PublishButton.tsx`

**Interfaces:**
- Consumes:
  - `phase: 'exporting' | 'uploading'`
  - `progress: number` where progress is already combined 0-100
- Produces:
  - `PublishUploadLoader` React component

- [ ] **Step 1: Create loader component**

Create `src/components/publish/PublishUploadLoader.tsx`:

```tsx
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
```

- [ ] **Step 2: Integrate loader in `PublishButton`**

Import:

```ts
import { PublishUploadLoader } from '@/components/publish/PublishUploadLoader'
import { getCombinedPublishProgress } from '@/lib/youtube-upload-options'
```

Replace the old `displayProgress` / `progressLabel` calculation with:

```ts
  const combinedProgress = getCombinedPublishProgress(phase, exportProgress, progress)
```

Replace both old progress-bar render blocks with a single loader block:

```tsx
            {busy ? (
              <PublishUploadLoader
                phase={phase === 'exporting' ? 'exporting' : 'uploading'}
                progress={combinedProgress}
              />
            ) : null}
```

Keep the review block rendered only when not busy:

```tsx
            {!busy && (status === 'idle' || status === 'error') ? (
              <div className="mt-4 space-y-3">
                {/* review form + errors + actions */}
              </div>
            ) : null}
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS. Verify no old second uploading block remains in `PublishButton.tsx`.

---

### Task 4: Success State With Watch Link and Copy

**Files:**
- Create: `src/components/publish/PublishSuccessState.tsx`
- Modify: `src/components/PublishButton.tsx`

**Interfaces:**
- Consumes:
  - `UploadResult` from `src/lib/types/youtube.ts`
  - `onDone: () => void`
- Produces:
  - `PublishSuccessState` React component

- [ ] **Step 1: Create success component**

Create `src/components/publish/PublishSuccessState.tsx`:

```tsx
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
```

- [ ] **Step 2: Render success component in `PublishButton`**

Import:

```ts
import { PublishSuccessState } from '@/components/publish/PublishSuccessState'
```

Replace the current success block with:

```tsx
            {status === 'success' && result ? (
              <PublishSuccessState result={result} onDone={handleClose} />
            ) : null}
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS. If TypeScript complains about `navigator.clipboard`, use `void navigator.clipboard?.writeText(result.videoUrl)` guarded by `if (!navigator.clipboard) return`.

---

### Task 5: Dialog Polish, Error States, and Manual Verification

**Files:**
- Modify: `src/components/PublishButton.tsx`
- Verify: `src/components/publish/PublishReviewForm.tsx`
- Verify: `src/components/publish/PublishUploadLoader.tsx`
- Verify: `src/components/publish/PublishSuccessState.tsx`

**Interfaces:**
- Consumes all components from Tasks 2-4.
- Produces final publish dialog behavior matching the approved spec.

- [ ] **Step 1: Update dialog copy and sizing**

In `PublishButton.tsx`, use this header copy:

```tsx
            <h2 id="publish-dialog-title" className="text-lg font-semibold text-neutral-900">
              Review YouTube upload
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Adjust the details now. We&apos;ll render your edit, upload it to YouTube, then give
              you the watch link.
            </p>
```

Update the modal width class:

```tsx
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
```

- [ ] **Step 2: Keep backdrop close locked while busy**

Keep `handleClose` as:

```ts
  const handleClose = () => {
    if (busy) return
    setOpen(false)
    setPhase('idle')
    if (status === 'success' || status === 'error') reset()
  }
```

Ensure only Cancel/Done call `handleClose`; do not add backdrop click behavior during this task.

- [ ] **Step 3: Ensure error recovery returns to Review**

In the `catch` block, keep:

```ts
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to publish.')
      setPhase('idle')
    }
```

Verify the review condition includes `status === 'error'`:

```tsx
            {!busy && (status === 'idle' || status === 'error') ? (
```

- [ ] **Step 4: Run full verification commands**

Run helper tests:

```bash
node --experimental-strip-types src/lib/youtube-upload-options.test.ts
```

Expected: all tests PASS.

Run build:

```bash
npm run build
```

Expected: `tsc -b && vite build` completes successfully.

Run lints for edited files using the IDE diagnostics tool after code changes:

```text
ReadLints on:
- src/lib/youtube-upload-options.ts
- src/lib/youtube-upload-options.test.ts
- src/components/PublishButton.tsx
- src/components/publish/PublishReviewForm.tsx
- src/components/publish/PublishUploadLoader.tsx
- src/components/publish/PublishSuccessState.tsx
- src/components/editor/editor-workspace.tsx
- src/components/settings/youtube-settings-section.tsx
```

Expected: no new diagnostics in edited files.

- [ ] **Step 5: Manual browser checks**

Start the app if no dev server is already running:

```bash
npm run dev
```

Expected: Vite prints a localhost URL.

Manually verify:

1. Open a recording in the editor and click **Publish to YouTube**.
2. Confirm title, description, privacy, tags, category, and made-for-kids are editable.
3. Change several fields, close the dialog, reopen it, and confirm edits persisted on the recording.
4. Click Upload and confirm only one loader appears for export and upload.
5. Confirm the loader percent does not jump back to 0 when export switches to upload.
6. Confirm Cancel is disabled/locked while busy.
7. After upload succeeds, confirm the success state says YouTube may take up to about 1 minute, the watch link opens `result.videoUrl`, Copy link changes to Copied, and Done closes the dialog.


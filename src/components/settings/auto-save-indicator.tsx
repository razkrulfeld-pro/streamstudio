import { cn } from '@/lib/utils'

export function AutoSaveIndicator({
  lastSavedAt,
  className,
}: {
  lastSavedAt: number | null
  className?: string
}) {
  return (
    <p className={cn('text-xs text-neutral-400', className)}>
      {lastSavedAt ? 'Saved · ' : ''}Changes auto-save and apply to future sessions only.
    </p>
  )
}

import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

const darkPanelStyles = {
  shell: 'bg-neutral-800 text-neutral-100',
  title: 'text-neutral-100',
  close: 'text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100',
  section: 'text-neutral-400',
  chipIdle: 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600',
  chipActive: 'bg-white text-[#5234d2] shadow-sm',
  segmentTrack: 'bg-neutral-700/80',
  segmentActive: 'bg-white text-[#5234d2] shadow-sm',
  segmentIdle: 'text-neutral-300 hover:text-neutral-100',
  grid: 'border-neutral-600 bg-neutral-700/50',
  gridIdle: 'bg-neutral-600 hover:bg-neutral-500',
  gridActive: 'bg-white shadow-sm ring-2 ring-[#5234d2]/30',
}

export function RecordingSidePanel({
  title,
  onClose,
  children,
  className,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <aside className={cn('flex h-full flex-col overflow-hidden rounded-2xl', darkPanelStyles.shell, className)}>
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className={cn('text-sm font-semibold', darkPanelStyles.title)}>{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className={cn('rounded-md p-1 transition', darkPanelStyles.close)}
          aria-label="Close panel"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </aside>
  )
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h4 className={cn('mb-2 text-xs font-semibold uppercase tracking-wide', darkPanelStyles.section)}>
        {title}
      </h4>
      {children}
    </section>
  )
}

export function PanelSlider({
  label,
  value,
  min,
  max,
  step,
  valueLabel,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  valueLabel: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium text-neutral-300">{label}</span>
        <span className="font-medium text-white">{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[#5234d2]"
      />
    </label>
  )
}

export function PanelSegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string; icon?: ReactNode }[]
  onChange: (value: T) => void
}) {
  return (
    <div className={cn('flex w-full rounded-lg p-1', darkPanelStyles.segmentTrack)}>
      {options.map((option) => {
        const isActive = value === option.id

        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition',
              isActive ? darkPanelStyles.segmentActive : darkPanelStyles.segmentIdle,
              isActive && '[&_svg]:text-[#5234d2]',
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function OptionChips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition',
            value === option.id ? darkPanelStyles.chipActive : darkPanelStyles.chipIdle,
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function PositionGrid({
  positionV,
  positionH,
  onChange,
}: {
  positionV: 'top' | 'center' | 'bottom'
  positionH: 'left' | 'center' | 'right'
  onChange: (v: 'top' | 'center' | 'bottom', h: 'left' | 'center' | 'right') => void
}) {
  const rows: Array<'top' | 'center' | 'bottom'> = ['top', 'center', 'bottom']
  const cols: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right']

  return (
    <div className={cn('inline-grid grid-cols-3 gap-1 rounded-lg border p-2', darkPanelStyles.grid)}>
      {rows.map((row) =>
        cols.map((col) => (
          <button
            key={`${row}-${col}`}
            type="button"
            onClick={() => onChange(row, col)}
            className={cn(
              'size-8 rounded-md transition',
              positionV === row && positionH === col
                ? darkPanelStyles.gridActive
                : darkPanelStyles.gridIdle,
            )}
            aria-label={`${row} ${col}`}
          />
        )),
      )}
    </div>
  )
}

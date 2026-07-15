import { StageBackgroundPicker } from '@/components/recording/stage-background-picker'
import {
  PanelSection,
  PanelSlider,
  RecordingSidePanel,
} from '@/components/recording/recording-side-panel'
import type { LibraryAssetView } from '@/context/asset-library-context'
import type { ScreenShareLayoutSettings } from '@/types/recording-layout'

interface ScreenShareSidePanelProps {
  className?: string
  layout: ScreenShareLayoutSettings
  assets: LibraryAssetView[]
  onClose: () => void
  onLayoutChange: (patch: Partial<ScreenShareLayoutSettings>) => void
}

export function ScreenShareSidePanel({
  className,
  layout,
  assets,
  onClose,
  onLayoutChange,
}: ScreenShareSidePanelProps) {
  return (
    <RecordingSidePanel title="Screen share" onClose={onClose} className={className}>
      <PanelSection title="Background">
        <StageBackgroundPicker
          layout={layout}
          assets={assets}
          onLayoutChange={onLayoutChange}
          allowedModes={['color', 'media', 'orbs']}
        />
      </PanelSection>

      <PanelSection title="Margins">
        <PanelSlider
          label="Inset"
          value={layout.margins}
          min={0}
          max={120}
          step={4}
          valueLabel={`${layout.margins}px`}
          onChange={(margins) => onLayoutChange({ margins })}
        />
      </PanelSection>

      <PanelSection title="Corner radius">
        <PanelSlider
          label="Radius"
          value={layout.cornerRadius}
          min={0}
          max={48}
          step={2}
          valueLabel={`${layout.cornerRadius}px`}
          onChange={(cornerRadius) => onLayoutChange({ cornerRadius })}
        />
      </PanelSection>
    </RecordingSidePanel>
  )
}

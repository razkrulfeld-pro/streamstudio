import { StageBackgroundPicker } from '@/components/recording/stage-background-picker'
import {
  OptionChips,
  PanelSection,
  PanelSegmentedControl,
  PanelSlider,
  PositionGrid,
  RecordingSidePanel,
} from '@/components/recording/recording-side-panel'
import type { LibraryAssetView } from '@/context/asset-library-context'
import type { CameraLayoutSettings } from '@/types/recording-layout'

interface CameraSidePanelProps {
  className?: string
  layout: CameraLayoutSettings
  assets: LibraryAssetView[]
  onClose: () => void
  onLayoutChange: (patch: Partial<CameraLayoutSettings>) => void
}

export function CameraSidePanel({
  className,
  layout,
  assets,
  onClose,
  onLayoutChange,
}: CameraSidePanelProps) {
  return (
    <RecordingSidePanel title="Camera" onClose={onClose} className={className}>
      <PanelSection title="Type">
        <PanelSegmentedControl
          value={layout.displayType}
          options={[
            { id: 'bubble', label: 'Bubble' },
            { id: 'fullscreen', label: 'Full screen' },
          ]}
          onChange={(displayType) => onLayoutChange({ displayType })}
        />
      </PanelSection>

      {layout.displayType === 'bubble' ? (
        <>
          <PanelSection title="Bubble size">
            <OptionChips
              value={layout.bubbleSize}
              options={[
                { id: 'S', label: 'S' },
                { id: 'L', label: 'L' },
                { id: 'XL', label: 'XL' },
              ]}
              onChange={(bubbleSize) => onLayoutChange({ bubbleSize })}
            />
          </PanelSection>

          <PanelSection title="Ratio">
            <OptionChips
              value={layout.bubbleRatio}
              options={[
                { id: '1:1', label: '1:1' },
                { id: '4:3', label: '4:3' },
                { id: '16:9', label: '16:9' },
                { id: '9:16', label: '9:16' },
              ]}
              onChange={(bubbleRatio) => onLayoutChange({ bubbleRatio })}
            />
          </PanelSection>

          <PanelSection title="Position">
            <PositionGrid
              positionV={layout.positionV}
              positionH={layout.positionH}
              onChange={(positionV, positionH) => onLayoutChange({ positionV, positionH })}
            />
          </PanelSection>

          <PanelSection title="Container style">
            <PanelSegmentedControl
              value={layout.containerStyle}
              options={[
                { id: 'square', label: 'Square' },
                { id: 'circle', label: 'Circle' },
                { id: 'rounded', label: 'Rounded' },
                { id: 'none', label: 'None' },
              ]}
              onChange={(containerStyle) => onLayoutChange({ containerStyle })}
            />
          </PanelSection>
        </>
      ) : null}

      <PanelSection title="Background">
        <StageBackgroundPicker layout={layout} assets={assets} onLayoutChange={onLayoutChange} />
      </PanelSection>

      <PanelSection title="Face focus">
        <div className="space-y-4">
          <PanelSlider
            label="Zoom"
            value={layout.cameraZoom}
            min={1}
            max={2.5}
            step={0.05}
            valueLabel={`${layout.cameraZoom.toFixed(2)}×`}
            onChange={(cameraZoom) => onLayoutChange({ cameraZoom })}
          />
          <PanelSlider
            label="Vertical focus"
            value={layout.cameraPanY}
            min={-0.5}
            max={0.5}
            step={0.05}
            valueLabel={layout.cameraPanY === 0 ? 'Centered' : layout.cameraPanY < 0 ? 'Higher' : 'Lower'}
            onChange={(cameraPanY) => onLayoutChange({ cameraPanY })}
          />
          <button
            type="button"
            onClick={() => onLayoutChange({ cameraZoom: 1.45, cameraPanY: -0.18 })}
            className="w-full rounded-lg bg-neutral-700 px-3 py-2 text-xs font-medium text-neutral-100 transition hover:bg-neutral-600"
          >
            Auto face focus
          </button>
        </div>
      </PanelSection>
    </RecordingSidePanel>
  )
}

import type { CSSProperties } from 'react'
import {
  backgroundMaterials,
  effectMaterials,
  stickerMaterials,
  type MaterialItem,
} from '@/config/materials'

const materialPools = [...backgroundMaterials, ...stickerMaterials, ...effectMaterials]

export function getMaterialById(id: string): MaterialItem | undefined {
  return materialPools.find((item) => item.id === id)
}

export function getMaterialPreviewStyle(preview: string): CSSProperties {
  if (preview.startsWith('url(')) {
    return {
      backgroundImage: preview,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }

  return { background: preview }
}

export function getBackgroundStyle(backgroundId: string): CSSProperties {
  if (backgroundId === 'bg-none') return { backgroundColor: '#171717' }
  if (backgroundId === 'bg-blur') {
    return { background: 'linear-gradient(135deg, #dbeafe 0%, #c4b5fd 100%)' }
  }

  const material = getMaterialById(backgroundId)
  if (!material) return { backgroundColor: '#171717' }

  return getMaterialPreviewStyle(material.preview)
}

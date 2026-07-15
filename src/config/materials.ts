export interface MaterialItem {
  id: string
  label: string
  preview: string
}

export const backgroundMaterials: MaterialItem[] = [
  { id: 'bg-none', label: 'None', preview: 'linear-gradient(135deg, #f5f5f5 0%, #e5e5e5 100%)' },
  { id: 'bg-blur', label: 'Blur', preview: 'linear-gradient(135deg, #dbeafe 0%, #c4b5fd 100%)' },
  { id: 'bg-office', label: 'Office', preview: 'url(https://picsum.photos/seed/bg-office/320/180)' },
  { id: 'bg-bookshelf', label: 'Bookshelf', preview: 'url(https://picsum.photos/seed/bg-bookshelf/320/180)' },
  { id: 'bg-plants', label: 'Plants', preview: 'url(https://picsum.photos/seed/bg-plants/320/180)' },
  { id: 'bg-minimal', label: 'Minimal', preview: 'url(https://picsum.photos/seed/bg-minimal/320/180)' },
  { id: 'bg-gradient-blue', label: 'Blue gradient', preview: 'linear-gradient(135deg, #60a5fa 0%, #818cf8 100%)' },
  { id: 'bg-gradient-pink', label: 'Pink gradient', preview: 'linear-gradient(135deg, #f472b6 0%, #fb7185 100%)' },
]

export const stickerMaterials: MaterialItem[] = [
  { id: 'stk-none', label: 'None', preview: 'linear-gradient(135deg, #fafafa 0%, #f0f0f0 100%)' },
  { id: 'stk-wave', label: 'Wave', preview: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' },
  { id: 'stk-star', label: 'Star burst', preview: 'linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 100%)' },
  { id: 'stk-frame', label: 'Frame', preview: 'linear-gradient(135deg, #bfdbfe 0%, #93c5fd 100%)' },
  { id: 'stk-logo', label: 'Logo badge', preview: 'linear-gradient(135deg, #fecdd3 0%, #fda4af 100%)' },
  { id: 'stk-lower-third', label: 'Lower third', preview: 'linear-gradient(135deg, #d1fae5 0%, #6ee7b7 100%)' },
]

export const effectMaterials: MaterialItem[] = [
  { id: 'fx-none', label: 'None', preview: 'linear-gradient(135deg, #f5f5f5 0%, #e5e5e5 100%)' },
  { id: 'fx-soft-glow', label: 'Soft glow', preview: 'linear-gradient(135deg, #fef9c3 0%, #fde047 100%)' },
  { id: 'fx-vignette', label: 'Vignette', preview: 'radial-gradient(circle, #ffffff 0%, #a3a3a3 100%)' },
  { id: 'fx-film', label: 'Film grain', preview: 'linear-gradient(135deg, #d4d4d4 0%, #737373 100%)' },
  { id: 'fx-warm', label: 'Warm tone', preview: 'linear-gradient(135deg, #fed7aa 0%, #fdba74 100%)' },
  { id: 'fx-cool', label: 'Cool tone', preview: 'linear-gradient(135deg, #bae6fd 0%, #7dd3fc 100%)' },
]

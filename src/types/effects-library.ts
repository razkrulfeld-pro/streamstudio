export interface EffectManifestEntry {
  id: string
  key: string
  label: string
  durationS?: number
}

export interface LibraryEffect extends EffectManifestEntry {
  imageUrl: string
  audioUrl: string
  durationS: number
}

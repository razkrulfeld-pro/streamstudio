import { decompressFrames, parseGIF } from 'gifuct-js'

interface GifuctFrame {
  dims: { top: number; left: number; width: number; height: number }
  patch: Uint8ClampedArray
  delay: number
  disposalType: number
}

const MIN_FRAME_DELAY_MS = 10
const DEFAULT_FRAME_DELAY_MS = 100

/** gifuct-js `delay` is already in milliseconds — do not rescale it. */
function frameDelayMs(delay: number): number {
  if (delay > 0) return Math.max(delay, MIN_FRAME_DELAY_MS)
  return DEFAULT_FRAME_DELAY_MS
}

export class AnimatedGifPlayer {
  private readonly frames: GifuctFrame[]
  private readonly patchCanvas: HTMLCanvasElement
  private readonly patchContext: CanvasRenderingContext2D
  readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly frameDelays: number[]
  private readonly totalDuration: number
  private lastFrameIndex = -1
  private ready = false

  private constructor(width: number, height: number, frames: GifuctFrame[]) {
    this.frames = frames
    this.frameDelays = frames.map((frame) => frameDelayMs(frame.delay))
    this.totalDuration = this.frameDelays.reduce((sum, delay) => sum + delay, 0)

    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height

    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available.')
    this.context = context

    this.patchCanvas = document.createElement('canvas')
    const patchContext = this.patchCanvas.getContext('2d')
    if (!patchContext) throw new Error('Canvas is not available.')
    this.patchContext = patchContext
  }

  get isReady(): boolean {
    return this.ready
  }

  static async fromUrl(url: string): Promise<AnimatedGifPlayer> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('Failed to load GIF.')
    }

    const buffer = await response.arrayBuffer()
    const gif = parseGIF(buffer)
    const frames = decompressFrames(gif, true) as GifuctFrame[]

    if (frames.length === 0) {
      throw new Error('GIF has no frames.')
    }

    const player = new AnimatedGifPlayer(gif.lsd.width, gif.lsd.height, frames)
    player.ready = true
    player.render(performance.now())
    return player
  }

  private getFrameIndex(timeMs: number): number {
    if (this.frames.length === 1) return 0
    if (this.totalDuration <= 0) return 0

    const elapsed = timeMs % this.totalDuration
    let accumulated = 0

    for (let index = 0; index < this.frameDelays.length; index += 1) {
      accumulated += this.frameDelays[index]
      if (elapsed < accumulated) return index
    }

    return this.frameDelays.length - 1
  }

  render(timeMs: number) {
    if (!this.ready || this.frames.length === 0) return

    const targetIndex = this.getFrameIndex(timeMs)
    if (targetIndex === this.lastFrameIndex) return

    if (targetIndex < this.lastFrameIndex) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
      this.lastFrameIndex = -1
    }

    for (let index = this.lastFrameIndex + 1; index <= targetIndex; index += 1) {
      this.drawFrame(index)
    }

    this.lastFrameIndex = targetIndex
  }

  private drawFrame(index: number) {
    const frame = this.frames[index]
    const { width, height, top, left } = frame.dims

    if (frame.disposalType === 2) {
      this.context.clearRect(left, top, width, height)
    }

    if (this.patchCanvas.width !== width || this.patchCanvas.height !== height) {
      this.patchCanvas.width = width
      this.patchCanvas.height = height
    }

    const imageData = this.patchContext.createImageData(width, height)
    imageData.data.set(frame.patch)
    this.patchContext.putImageData(imageData, 0, 0)
    this.context.drawImage(this.patchCanvas, left, top)
  }

  dispose() {
    this.ready = false
    this.lastFrameIndex = -1
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractFmp4InitSegment,
  iterFmp4TopBoxes,
  parseAvc1CodecFromInit,
} from './device-stream-fmp4.ts'
import { DEVICE_MSE_BUFFER_WINDOW_S, trimDeviceMseBuffer } from './device-stream-mse.ts'

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.byteLength)
  const size = 8 + payload.byteLength
  out[0] = (size >>> 24) & 0xff
  out[1] = (size >>> 16) & 0xff
  out[2] = (size >>> 8) & 0xff
  out[3] = size & 0xff
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  out.set(payload, 8)
  return out
}

test('extractFmp4InitSegment splits ftyp+moov from media', () => {
  const ftyp = box('ftyp', new Uint8Array([0, 0, 0, 0]))
  const moov = box('moov', new Uint8Array([1, 2, 3]))
  const moof = box('moof', new Uint8Array([9]))
  const buf = new Uint8Array(ftyp.byteLength + moov.byteLength + moof.byteLength)
  buf.set(ftyp, 0)
  buf.set(moov, ftyp.byteLength)
  buf.set(moof, ftyp.byteLength + moov.byteLength)
  const split = extractFmp4InitSegment(buf)
  assert.ok(split)
  assert.equal(split!.init.byteLength, ftyp.byteLength + moov.byteLength)
  assert.equal(split!.rest.byteLength, moof.byteLength)
})

test('iterFmp4TopBoxes lists complete boxes only until incomplete trailing', () => {
  const a = box('moof', new Uint8Array(4))
  const partial = new Uint8Array(a.byteLength + 4)
  partial.set(a, 0)
  // trailing incomplete size header
  partial[a.byteLength] = 0
  partial[a.byteLength + 1] = 0
  partial[a.byteLength + 2] = 1
  partial[a.byteLength + 3] = 0
  const boxes = iterFmp4TopBoxes(partial)
  assert.equal(boxes[0]?.type, 'moof')
  assert.ok(boxes.length >= 1)
})

test('parseAvc1CodecFromInit reads avcC profile bytes', () => {
  // Minimal nested moov/trak/.../avcC — enough for findBox recursion with avc1 preamble.
  const avcC = box('avcC', new Uint8Array([1, 0x64, 0x00, 0x1f, 0xff]))
  // Fake avc1 sample entry: 78-byte preamble then avcC
  const avc1Payload = new Uint8Array(78 + avcC.byteLength)
  avc1Payload.set(avcC, 78)
  const avc1 = box('avc1', avc1Payload)
  const stsdPayload = new Uint8Array(8 + avc1.byteLength)
  stsdPayload.set(avc1, 8)
  const stsd = box('stsd', stsdPayload)
  const stbl = box('stbl', stsd)
  const minf = box('minf', stbl)
  const mdia = box('mdia', minf)
  const trak = box('trak', mdia)
  const moov = box('moov', trak)
  const ftyp = box('ftyp', new Uint8Array(4))
  const init = new Uint8Array(ftyp.byteLength + moov.byteLength)
  init.set(ftyp, 0)
  init.set(moov, ftyp.byteLength)
  assert.equal(parseAvc1CodecFromInit(init), 'avc1.64001f')
})

test('trimDeviceMseBuffer seeks to live edge and keeps window constant intent', () => {
  assert.ok(DEVICE_MSE_BUFFER_WINDOW_S <= 2)
  const currentTime = { value: 0 }
  const removeCalls: Array<[number, number]> = []
  const video = {
    get currentTime() {
      return currentTime.value
    },
    set currentTime(v: number) {
      currentTime.value = v
    },
    readyState: 2,
    buffered: {
      length: 1,
      start: () => 100,
      end: () => 110,
    },
  } as unknown as HTMLVideoElement
  const sourceBuffer = {
    updating: false,
    remove(start: number, end: number) {
      removeCalls.push([start, end])
    },
  } as unknown as SourceBuffer
  const lag = trimDeviceMseBuffer(video, sourceBuffer, { windowS: 1.5, marginS: 0.05 })
  assert.ok(lag > 9)
  assert.ok(Math.abs(currentTime.value - 109.95) < 0.001)
  assert.equal(removeCalls.length, 1)
  assert.equal(removeCalls[0]![0], 100)
  assert.ok(removeCalls[0]![1] <= 108.5 + 0.01)
})

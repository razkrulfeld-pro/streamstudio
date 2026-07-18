import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAvcDecoderConfig,
  codecStringFromSps,
  concatLengthPrefixed,
  parseWsNalMessage,
} from './device-h264-ws.ts'

test('parseWsNalMessage reads framed H.264 payload', () => {
  const payload = new Uint8Array([0, 0, 0, 1, 0x65, 1, 2])
  const buf = new ArrayBuffer(16 + payload.byteLength)
  const view = new DataView(buf)
  view.setUint8(0, 0x48) // H
  view.setUint8(1, 0x32) // 2
  view.setUint8(2, 1) // version
  view.setUint8(3, 1) // key flag
  view.setUint8(4, 5) // nal type
  view.setUint32(8, 0)
  view.setUint32(12, 12345)
  new Uint8Array(buf, 16).set(payload)

  const parsed = parseWsNalMessage(buf)
  assert.equal(parsed.nalType, 5)
  assert.equal(parsed.isKey, true)
  assert.equal(parsed.wallMs, 12345)
  assert.deepEqual(Array.from(parsed.data), Array.from(payload))
})

test('codecStringFromSps builds avc1 string', () => {
  const sps = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0xaa])
  assert.equal(codecStringFromSps(sps), 'avc1.64001f')
})

test('buildAvcDecoderConfig produces avcC with sps/pps lengths', () => {
  const sps = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0x01])
  const pps = new Uint8Array([0, 0, 0, 1, 0x68, 0xee, 0x06, 0xe2])
  const cfg = buildAvcDecoderConfig(sps, pps)
  assert.equal(cfg[0], 1)
  assert.equal(cfg[1], 0x64)
  assert.ok(cfg.byteLength > 11)
})

test('concatLengthPrefixed joins multiple NALs', () => {
  const a = new Uint8Array([0, 0, 0, 1, 0x67, 1])
  const b = new Uint8Array([0, 0, 0, 1, 0x68, 2])
  const out = concatLengthPrefixed([a, b])
  assert.equal(out.byteLength, 12)
  assert.equal(out[3], 2) // first NAL length
  assert.equal(out[4], 0x67)
  assert.equal(out[9], 2) // second NAL length
  assert.equal(out[10], 0x68)
})

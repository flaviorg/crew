import { expect, test } from 'claude-code/testing'
import {
  base64, encodeCells, frameAt, framesFor, kindOf, paletteFor, spriteSvg,
  SPRITE_COLUMNS, SPRITE_H, SPRITE_ROWS, SPRITE_W, type Kind, type Pose,
} from '../hooks/sprites.ts'

const KINDS: Kind[] = ['general', 'explore', 'plan', 'custom']
const POSES: Pose[] = ['idle', 'working', 'done', 'failed']
const KEYS = new Set('.bhdewmcaAsfxkt'.split(''))

// Bytes from standard base64, without relying on atob.
function unbase64(s: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = s.replace(/=+$/, '')
  const out: number[] = []
  let bits = 0, value = 0
  for (const ch of clean) {
    value = (value << 6) | alphabet.indexOf(ch)
    bits += 6
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 0xff) }
  }
  return new Uint8Array(out)
}

function cellWords(cells: string, index: number): number[] {
  const bytes = unbase64(cells)
  const view = new DataView(bytes.buffer)
  return [0, 1, 2].map((w) => view.getUint32(index * 12 + w * 4, true))
}

test('every frame has the right size', () => {
  for (const kind of KINDS) {
    for (const pose of POSES) {
      for (const frame of framesFor(kind, pose)) {
        expect(frame).toHaveLength(SPRITE_H)
        for (const row of frame) {
          expect(row).toHaveLength(SPRITE_W)
          for (const ch of row) expect(KEYS.has(ch), `unknown pixel key ${ch} in ${kind}/${pose}`).toBe(true)
        }
      }
    }
  }
})

test('poses have their lengths', () => {
  for (const kind of KINDS) {
    expect(framesFor(kind, 'idle')).toHaveLength(8)
    expect(framesFor(kind, 'working')).toHaveLength(4)
    expect(framesFor(kind, 'done')).toHaveLength(4)
    expect(framesFor(kind, 'failed')).toHaveLength(8)
  }
})

test('kinds by agent type', () => {
  expect(kindOf('general-purpose')).toBe('general')
  expect(kindOf('Explore')).toBe('explore')
  expect(kindOf('Plan')).toBe('plan')
  expect(kindOf('fork')).toBe('general')
  expect(kindOf('code-reviewer')).toBe('custom')
  expect(kindOf(undefined)).toBe('general')
})

test('custom coats are stable per name', () => {
  expect(paletteFor('code-reviewer', 'working').b).toBe(paletteFor('code-reviewer', 'idle').b)
  expect(paletteFor('code-reviewer', 'working').b).toBe(paletteFor('code-reviewer', 'working').b)
  expect(paletteFor('code-reviewer', 'working').b).not.toBe(paletteFor('test-runner', 'working').b)
})

test('failed is grey', () => {
  expect(paletteFor('Explore', 'failed').b).toBe('#8E8C96')
  expect(paletteFor('Explore', 'working').b).toBe('#35B5AC')
  expect(paletteFor('general-purpose', 'working').b).toBe('#D97757')
})

test('base64 vectors', () => {
  const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
  expect(base64(bytes('Man'))).toBe('TWFu')
  expect(base64(bytes('Ma'))).toBe('TWE=')
  expect(base64(bytes('M'))).toBe('TQ==')
  expect(base64(new Uint8Array([]))).toBe('')
})

test('cells encode 55 cells of 12 bytes', () => {
  const cells = encodeCells(frameAt('general', 'working', 0), paletteFor('general-purpose', 'working'))
  expect(SPRITE_COLUMNS * SPRITE_ROWS).toBe(55)
  expect(cells).toHaveLength(880)
  expect(unbase64(cells)).toHaveLength(660)
})

test('first cell of working general is the antenna tip', () => {
  const cells = encodeCells(frameAt('general', 'working', 0), paletteFor('general-purpose', 'working'))
  // The top-middle cell: row 0, column 5. Its top pixel is the lit tip, its bottom the stalk.
  expect(cellWords(cells, 5)).toEqual([0x2580, 0xffe38a, 0x6e3423])
  // The top-left cell is clear: a space on the terminal's default colors.
  expect(cellWords(cells, 0)).toEqual([0x20, 0x01000000, 0x01000000])
})

test('svg animates every frame', () => {
  const svg = spriteSvg('plan', 'working', paletteFor('Plan', 'working'))
  expect(svg.match(/<g /g)).toHaveLength(4)
  expect(svg.match(/<animate /g)).toHaveLength(4)
  expect(svg).toContain('repeatCount="indefinite"')
  expect(svg).toStartWith('<svg ')
  expect(svg.length).toBeLessThan(131072)
})

test('repeated frames are drawn once', () => {
  // idle holds its rest frame by repeating it: two distinct looks, rest and blink.
  const idle = spriteSvg('general', 'idle', paletteFor('general-purpose', 'idle'))
  expect(idle.match(/<g /g)).toHaveLength(2)
  expect(idle).toContain('values="1;1;1;1;1;0;1;1"')
  expect(spriteSvg('explore', 'done', paletteFor('Explore', 'done')).match(/<g /g)).toHaveLength(2)
  expect(spriteSvg('custom', 'failed', paletteFor('x', 'failed')).match(/<g /g)).toHaveLength(2)
})

test('svgs stay small enough for a pane of thirty', () => {
  // A drawn tree is bounded at 100,000 characters; a mascot must not eat that alone.
  for (const kind of KINDS) {
    for (const pose of POSES) {
      expect(spriteSvg(kind, pose, paletteFor(kind === 'custom' ? 'x' : kind, pose)).length).toBeLessThan(3_500)
    }
  }
})

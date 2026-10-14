import { expect, test } from 'claude-code/testing'
import {
  base64, encodeCells, frameAt, framesFor, kindOf, paletteFor, phaseOf, spriteSvg,
  SPRITE_COLUMNS, SPRITE_H, SPRITE_ROWS, SPRITE_W, SVG_PIXEL, type Kind, type Pose,
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

test('the mascot is 9 x 8: 9 columns by 4 rows, one per line of a card', () => {
  expect([SPRITE_W, SPRITE_H]).toEqual([9, 8])
  expect([SPRITE_COLUMNS, SPRITE_ROWS]).toEqual([9, 4])
  // In the Desktop app, about two lines of text tall.
  expect([SPRITE_W * SVG_PIXEL, SPRITE_H * SVG_PIXEL]).toEqual([36, 32])
  expect(spriteSvg('general', 'idle', paletteFor('general-purpose', 'idle'))).toContain('viewBox="0 0 9 8" width="36" height="32"')
})

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

test('phases spread agents over the loop', () => {
  const phases = new Set(['ag-1', 'ag-2', 'ag-3', 'ag-4', 'ag-5', 'ag-6'].map(phaseOf))
  expect(phases.size).toBeGreaterThan(2)
  for (const p of phases) expect(p >= 0 && p < 8).toBe(true)
  expect(phaseOf('ag-1')).toBe(phaseOf('ag-1'))
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

test('cells encode 36 cells of 12 bytes', () => {
  const cells = encodeCells(frameAt('general', 'working', 0), paletteFor('general-purpose', 'working'))
  expect(SPRITE_COLUMNS * SPRITE_ROWS).toBe(36)
  expect(cells).toHaveLength(576)
  expect(unbase64(cells)).toHaveLength(432)
})

test('first cell of working general is the antenna tip', () => {
  const cells = encodeCells(frameAt('general', 'working', 0), paletteFor('general-purpose', 'working'))
  // The top-middle cell: row 0, column 4. Its top pixel is the lit tip, its bottom the stalk.
  expect(cellWords(cells, 4)).toEqual([0x2580, 0xe0a100, 0xa0522d])
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
  // failed: the tear on three rows, then none.
  expect(spriteSvg('custom', 'failed', paletteFor('x', 'failed')).match(/<g /g)).toHaveLength(4)
})

test('the smile mirrors the frown', () => {
  // Mouth pixels of the face looking ahead: a V when done, the same turned over when failed.
  const mouth = (f: readonly string[]) => f.flatMap((row, y) => [...row].flatMap((c, x) => (c === 'm' ? [[x, y]] : [])))
  expect(mouth(frameAt('general', 'done', 2))).toEqual([[3, 5], [5, 5], [4, 6]])
  expect(mouth(frameAt('general', 'failed', 0))).toEqual([[4, 5], [3, 6], [5, 6]])
})

test('the tear rolls down', () => {
  const tearRow = (f: readonly string[]) => f.findIndex((row) => row.includes('t'))
  expect(framesFor('explore', 'failed').map(tearRow)).toEqual([4, 4, 5, 5, 6, 6, -1, -1])
})

test('a turned face keeps the outline: no eye on the body\'s edge', () => {
  // Looking aside, the far eye narrows instead of sliding onto the edge, where it would cut
  // the outline and leave a tapping hand hanging off nothing.
  const eyesAt = (f: readonly string[]) => f.flatMap((row) => [...row].flatMap((c, x) => (c === 'e' || c === 'w' ? [x] : [])))
  for (const kind of KINDS) {
    for (const pose of POSES) {
      for (const frame of framesFor(kind, pose)) {
        for (const x of eyesAt(frame)) expect(x > 1 && x < SPRITE_W - 2, `${kind}/${pose} eye at column ${x}`).toBe(true)
      }
    }
  }
  // The look still shows: the eyes sit left, then right, of where they rest.
  const working = framesFor('general', 'working')
  expect(Math.min(...eyesAt(working[0]!))).toBeLessThan(Math.min(...eyesAt(working[2]!)))
  expect(eyesAt(working[0]!)).not.toEqual(eyesAt(frameAt('general', 'idle', 0)))
})

test('sparkles twinkle in both done frames, never beside a tip', () => {
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  for (const kind of KINDS) {
    const done = framesFor(kind, 'done')
    for (const i of [0, 2]) {
      const frame = done[i]!
      const sparks = frame.flatMap((row, y) => [...row].flatMap((c, x) => (c === 'k' ? [[x, y] as const] : [])))
      expect(sparks.length, `${kind} done ${i}`).toBeGreaterThan(0)
      for (const [x, y] of sparks) {
        for (const [dx, dy] of sides) expect(frame[y + dy]?.[x + dx] ?? '.', `${kind} sparkle at ${x},${y}`).not.toMatch(/[aA]/)
      }
    }
    // They move between the two frames.
    expect(done[0]!.join('/').replace(/[^k]/g, '.')).not.toBe(done[2]!.join('/').replace(/[^k]/g, '.'))
  }
})

// WCAG contrast of two #RRGGBB colors.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

test('head pieces, feet, tips and sparkles show on dark and light themes', () => {
  // These stand on the terminal's own background, which a Raster cannot follow.
  const types = ['general-purpose', 'Explore', 'Plan', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  // The custom names among them wear all four coats.
  expect(new Set(types.slice(3).map((t) => paletteFor(t, 'idle').b)).size).toBe(4)
  for (const type of types) {
    for (const pose of POSES) {
      const palette = paletteFor(type, pose)
      for (const key of ['s', 'f', 'a', 'A', 'k', 't']) {
        for (const bg of ['#1E1E1E', '#FFFFFF']) {
          expect(contrast(palette[key]!, bg), `${type} ${pose} ${key} on ${bg}`).toBeGreaterThanOrEqual(2.2)
        }
      }
    }
  }
})

test('svgs stay small enough for a pane of thirty', () => {
  // A drawn tree is bounded at 100,000 characters; a mascot must not eat that alone.
  for (const kind of KINDS) {
    for (const pose of POSES) {
      expect(spriteSvg(kind, pose, paletteFor(kind === 'custom' ? 'x' : kind, pose)).length).toBeLessThan(3_500)
    }
  }
})

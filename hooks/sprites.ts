// crew's mascots: an original dome-shaped critter, one head piece per agent kind.
// Pure data and encoders, no mods API. The art is one table, ART: 9 x 8 pixels, drawn as
// 9 columns x 4 rows of half blocks in the terminal (Raster), one row per line of an agent's
// card, and as an animated SVG in the Desktop app.
//
// Pixel keys: . clear · b body · h highlight · d shade · e eye · w eye shine · m mouth
//             c cheek · a lit tip · A dim tip · s stalk/hat · f feet · x hands · k sparkle · t tear

export type Pose = 'idle' | 'working' | 'done' | 'failed'
export type Kind = 'general' | 'explore' | 'plan' | 'custom'
export type Frame = readonly string[]
export type Palette = Readonly<Record<string, string>>

type Head = 'antenna' | 'feelers' | 'cap' | 'sprout'
type Pixels = ReadonlyArray<readonly [number, number]>

/**
 * The drawing at one size, part by part. Rows run from the top and may be shorter than the
 * grid; a '.' in them leaves the pixel below as it was.
 */
type Art = {
  w: number
  h: number
  /** The dome with its highlight and shade, the whole grid. */
  body: readonly string[]
  /** Each head piece over the body, T its tip (lit or dim); `droop` when failed. */
  heads: Record<Head, { up: readonly string[]; droop: readonly string[] }>
  /**
   * The eyes' top row, each eye's [left column, width] by where the face looks (turned, the
   * eye nearer the edge narrows), and the eye as rows, cut to that width.
   */
  eyes: {
    y: number
    at: Record<'left' | 'ahead' | 'right', ReadonlyArray<readonly [number, number]>>
    open: readonly string[]
    blink: readonly string[]
    tired: readonly string[]
  }
  /** Cheeks follow the look, on the body only: a face turned aside hides the far one. */
  cheeks: { x: readonly number[]; y: number }
  /** The mouth's middle with the face ahead, and each mouth as offsets from it. */
  mouth: { x: number; y: number; dot: Pixels; smile: Pixels; flat: Pixels }
  hands: Record<'rest' | 'tapL' | 'tapR' | 'up', Pixels>
  feet: Record<'in' | 'L' | 'R' | 'none', Pixels>
  /** Where sparkles twinkle when done, one set per frame; they take clear pixels only. */
  sparks: readonly [Pixels, Pixels]
  /** The column a tear rolls down when failed, and the three rows it passes. */
  tear: { x: number; rows: readonly [number, number, number] }
}

// The one place the size lives: every pixel the mascot places, at 9 x 8.
const ART: Art = {
  w: 9,
  h: 8,
  body: [
    '.........',
    '.........',
    '..hhbbb..',
    '.hbbbbbb.',
    '.bbbbbbd.',
    '.bbbbbbd.',
    '.ddddddd.',
    '.........',
  ],
  heads: {
    antenna: { up: ['....T', '....s'], droop: ['.....T', '....s'] },
    feelers: { up: ['.T.....T', '..s...s'], droop: ['', '.Ts...sT'] },
    cap: { up: ['...sss', '.sssssss', '.......T'], droop: ['...sss', '.sssssss', '.......T'] },
    sprout: { up: ['..TT.T', '....s'], droop: ['..TT.T', '....s'] },
  },
  eyes: {
    y: 3,
    at: { left: [[2, 1], [4, 2]], ahead: [[2, 2], [5, 2]], right: [[3, 2], [6, 1]] },
    open: ['we', 'ee'],
    blink: ['', 'ee'],
    tired: ['dd', 'ee'],
  },
  cheeks: { x: [2, 6], y: 5 },
  // A smile is a small V; the frown the same shape turned over.
  mouth: { x: 4, y: 5, dot: [[0, 0]], smile: [[-1, 0], [0, 1], [1, 0]], flat: [[-1, 1], [0, 0], [1, 1]] },
  hands: { rest: [[0, 5], [8, 5]], tapL: [[0, 4], [8, 5]], tapR: [[0, 5], [8, 4]], up: [[0, 2], [0, 3], [8, 2], [8, 3]] },
  feet: { in: [[2, 7], [6, 7]], L: [[1, 7], [6, 7]], R: [[2, 7], [7, 7]], none: [] },
  sparks: [[[0, 0], [8, 0], [5, 0]], [[0, 2], [8, 1], [3, 0]]],
  tear: { x: 7, rows: [4, 5, 6] },
}

export const SPRITE_W = ART.w
export const SPRITE_H = ART.h
export const SPRITE_COLUMNS = SPRITE_W
export const SPRITE_ROWS = SPRITE_H / 2
/** CSS pixels per mascot pixel in the Desktop app: 9 x 8 is 36 x 32, about two lines of text. */
export const SVG_PIXEL = 4
/** Every pose plays at this rate; poses repeat frames to go slower. */
export const FRAME_MS = 250

type FrameSpec = {
  look?: -1 | 0 | 1
  eyes?: 'open' | 'blink' | 'tired'
  hands?: keyof Art['hands']
  feet?: keyof Art['feet']
  tip?: 'on' | 'off'
  mouth?: 'dot' | 'smile' | 'flat' | 'none'
  /** Which set of sparkles shows, if any. */
  spark?: 0 | 1
  droop?: boolean
  /** How far the tear has rolled, if one shows. */
  tear?: 0 | 1 | 2
}

const isBody = (c: string | undefined) => c === 'b' || c === 'h' || c === 'd'
const SIDES: Pixels = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function draw(head: Head, spec: FrameSpec): Frame {
  const { look = 0, eyes = 'open', hands = 'rest', feet = 'in', tip = 'on', mouth = 'dot', spark, droop = false, tear } = spec
  const g: string[][] = Array.from({ length: ART.h }, (_, y) => [...(ART.body[y] ?? '').padEnd(ART.w, '.')].slice(0, ART.w))
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && x < ART.w && y >= 0 && y < ART.h) g[y]![x] = c
  }
  const stamp = (rows: readonly string[], x0: number, y0: number) =>
    rows.forEach((row, dy) => [...row].forEach((c, dx) => c !== '.' && set(x0 + dx, y0 + dy, c === 'T' ? (tip === 'on' ? 'a' : 'A') : c)))
  stamp(ART.heads[head][droop ? 'droop' : 'up'], 0, 0)
  // the face turns with `look`
  for (const [x, w] of ART.eyes.at[look < 0 ? 'left' : look > 0 ? 'right' : 'ahead']) {
    stamp(ART.eyes[eyes].map((row) => row.slice(0, w)), x, ART.eyes.y)
  }
  for (const x of ART.cheeks.x) if (isBody(g[ART.cheeks.y]?.[x + look])) set(x + look, ART.cheeks.y, 'c')
  if (mouth !== 'none') for (const [dx, dy] of ART.mouth[mouth]) set(ART.mouth.x + look + dx, ART.mouth.y + dy, 'm')
  for (const [x, y] of ART.hands[hands]) set(x, y, 'x')
  for (const [x, y] of ART.feet[feet]) set(x, y, 'f')
  // A sparkle beside a tip, the same gold, would read as a bigger tip: it skips that spot.
  const byTip = (x: number, y: number) => SIDES.some(([dx, dy]) => /[aA]/.test(g[y + dy]?.[x + dx] ?? ''))
  if (spark !== undefined) for (const [x, y] of ART.sparks[spark]) if (g[y]?.[x] === '.' && !byTip(x, y)) set(x, y, 'k')
  if (tear !== undefined) set(ART.tear.x, ART.tear.rows[tear], 't')
  return g.map((row) => row.join(''))
}

const HEADS: Record<Kind, Head> = { general: 'antenna', explore: 'feelers', plan: 'cap', custom: 'sprout' }

function posesOf(head: Head): Record<Pose, Frame[]> {
  const f = (spec: FrameSpec = {}) => draw(head, spec)
  const rest = f()
  const done1 = f({ hands: 'up', mouth: 'smile', feet: 'none', spark: 0 })
  const done2 = f({ hands: 'rest', mouth: 'smile', spark: 1 })
  const sad = (tear?: 0 | 1 | 2) => f({ eyes: 'tired', mouth: 'flat', droop: true, tip: 'off', tear })
  const [sad0, sad1, sad2, dry] = [sad(0), sad(1), sad(2), sad()]
  return {
    // 2 s loop with one blink
    idle: [rest, rest, rest, rest, rest, f({ eyes: 'blink' }), rest, rest],
    // looks left and right, taps, steps, the tip pulses
    working: [
      f({ look: -1, hands: 'tapL', feet: 'L', tip: 'on' }),
      f({ look: -1, hands: 'tapR', feet: 'R', tip: 'off', mouth: 'none' }),
      f({ look: 1, hands: 'tapL', feet: 'L', tip: 'on' }),
      f({ look: 1, hands: 'tapR', feet: 'R', tip: 'off', mouth: 'none' }),
    ],
    // throws its hands up and cheers, sparkles twinkle
    done: [done1, done1, done2, done2],
    // grey and drooping; a tear rolls down, then another
    failed: [sad0, sad0, sad1, sad1, sad2, sad2, dry, dry],
  }
}

const POSES: Record<Kind, Record<Pose, Frame[]>> = {
  general: posesOf(HEADS.general),
  explore: posesOf(HEADS.explore),
  plan: posesOf(HEADS.plan),
  custom: posesOf(HEADS.custom),
}


/** The frames of one kind in one pose, each SPRITE_H rows of SPRITE_W characters. */
export function framesFor(kind: Kind, pose: Pose): readonly Frame[] {
  return POSES[kind][pose]
}

/** Which mascot an agent type gets: built-ins by name, anything else is custom. */
export function kindOf(agentType: string | undefined): Kind {
  const t = (agentType ?? '').toLowerCase()
  if (t === '' || t === 'general-purpose' || t === 'general' || t === 'fork') return 'general'
  if (t === 'explore') return 'explore'
  if (t === 'plan') return 'plan'
  return 'custom'
}

// The pieces that stand on the terminal's own background (stalks, caps, tips, feet, sparkles,
// the tear) keep to middle tones, so they show on dark and light themes alike: a Raster takes
// fixed colors and cannot follow the theme.
const SHARED: Palette = { e: '#1E1B2E', w: '#FFFFFF', m: '#1E1B2E', k: '#E0A100', t: '#4FA3D9', c: '#F58FA0' }

const BODIES: Record<Exclude<Kind, 'custom'>, Palette> = {
  general: { b: '#D97757', h: '#F2A98C', d: '#B05A3E', s: '#A0522D', a: '#E0A100', A: '#9C6B3A', f: '#A0522D', x: '#D97757' },
  explore: { b: '#35B5AC', h: '#8FE6DE', d: '#23847D', s: '#1F8A80', a: '#E0A100', A: '#5E8F75', f: '#1F8A80', x: '#35B5AC' },
  plan: { b: '#9B7BEA', h: '#CDBBF8', d: '#7155C0', s: '#6B4FD8', a: '#E0A100', A: '#8D7A3D', f: '#6B4FD8', x: '#9B7BEA' },
}

// Custom agent types share the sprout and take one of these coats by name.
const CUSTOM_COATS: readonly Palette[] = [
  { b: '#E9B248', h: '#F8D993', d: '#BA862C', s: '#4E7A2A', a: '#66B83A', A: '#4E7A2A', f: '#7A561A', x: '#E9B248' },
  { b: '#E77FA8', h: '#F6B6CF', d: '#B9577F', s: '#4E7A2A', a: '#66B83A', A: '#4E7A2A', f: '#A0507A', x: '#E77FA8' },
  { b: '#5B9BEA', h: '#A6C9F6', d: '#3D73B8', s: '#4E7A2A', a: '#66B83A', A: '#4E7A2A', f: '#2F6DB0', x: '#5B9BEA' },
  { b: '#7DC57A', h: '#B9E5B6', d: '#559A52', s: '#3E6B2A', a: '#E0A100', A: '#8D8A4A', f: '#3F7A3A', x: '#7DC57A' },
]

const GREY: Palette = { b: '#8E8C96', h: '#B9B7C0', d: '#66646E', s: '#76747E', a: '#6B6973', A: '#6B6973', f: '#76747E', x: '#8E8C96', c: '#8E8C96' }

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

/** The colors for one agent: by kind (custom coats by type name), grey when failed. */
export function paletteFor(agentType: string | undefined, pose: Pose): Palette {
  const kind = kindOf(agentType)
  const coat = kind === 'custom' ? CUSTOM_COATS[hash(agentType ?? '') % CUSTOM_COATS.length]! : BODIES[kind]
  return pose === 'failed' ? { ...SHARED, ...coat, ...GREY } : { ...SHARED, ...coat }
}

/**
 * Where in its loop an agent's animation starts, from its id: cards side by side then look,
 * tap and blink each in their own time instead of in step.
 */
export function phaseOf(id: string): number {
  return hash(id) % 8
}

/** The frame shown at a tick of the shared FRAME_MS clock. */
export function frameAt(kind: Kind, pose: Pose, tick: number): Frame {
  const frames = framesFor(kind, pose)
  return frames[((tick % frames.length) + frames.length) % frames.length]!
}

const DEFAULT = 0x01000000
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const SPACE = 0x20

function rgb(hex: string | undefined): number {
  if (!hex) return DEFAULT
  return parseInt(hex.slice(1), 16) & 0xffffff
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 of bytes; no reliance on btoa or Uint8Array.toBase64. */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!
    out += c === undefined ? '=' : B64[n & 63]!
  }
  return out
}

/**
 * A frame as Raster `cells`: SPRITE_COLUMNS x SPRITE_ROWS cells, each two stacked pixels as
 * a half block (top pixel the foreground of ▀, bottom pixel its background), clear pixels
 * left to the terminal's default color.
 */
export function encodeCells(frame: Frame, palette: Palette): string {
  const words = new Uint32Array(SPRITE_COLUMNS * SPRITE_ROWS * 3)
  let i = 0
  for (let row = 0; row < SPRITE_ROWS; row++) {
    for (let x = 0; x < SPRITE_COLUMNS; x++) {
      const top = frame[row * 2]?.[x] ?? '.'
      const bottom = frame[row * 2 + 1]?.[x] ?? '.'
      const t = top === '.' ? null : rgb(palette[top])
      const b = bottom === '.' ? null : rgb(palette[bottom])
      let glyph = SPACE, fg = DEFAULT, bg = DEFAULT
      if (t !== null && b !== null) { glyph = UPPER; fg = t; bg = b }
      else if (t !== null) { glyph = UPPER; fg = t }
      else if (b !== null) { glyph = LOWER; fg = b }
      words[i++] = glyph; words[i++] = fg; words[i++] = bg
    }
  }
  // Uint32Array is little-endian on every platform Claude Code runs on; pin it anyway.
  const bytes = new Uint8Array(words.length * 4)
  const view = new DataView(bytes.buffer)
  words.forEach((w, k) => view.setUint32(k * 4, w, true))
  return base64(bytes)
}

// One <path> per color with a subpath per horizontal run: a fraction of the size of a <rect>
// per run, which matters because a drawn tree is bounded at 100,000 characters.
function paths(frame: Frame, palette: Palette): string {
  const byFill = new Map<string, string>()
  const fillAt = (row: string, x: number) => (row[x] === '.' ? undefined : palette[row[x]!])
  frame.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const fill = fillAt(row, x)
      let end = x + 1
      while (end < row.length && fillAt(row, end) === fill) end++
      if (fill) byFill.set(fill, (byFill.get(fill) ?? '') + `M${x} ${y}h${end - x}v1H${x}z`)
      x = end
    }
  })
  return [...byFill].map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join('')
}

/**
 * The pose as one self-animating SVG (SMIL, discrete frames at FRAME_MS), for surfaces that
 * draw `Svg` with `isInteractive: true`. A single frame when the pose has one distinct frame.
 */
export function spriteSvg(kind: Kind, pose: Pose, palette: Palette, pixel = SVG_PIXEL): string {
  const frames = framesFor(kind, pose)
  const n = frames.length
  const w = SPRITE_W * pixel, h = SPRITE_H * pixel
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPRITE_W} ${SPRITE_H}" width="${w}" height="${h}" shape-rendering="crispEdges">`
  // Poses hold a frame by repeating it; each distinct frame is drawn once, shown in all its slots.
  const slotsOf = new Map<string, number[]>()
  frames.forEach((frame, i) => {
    const k = frame.join('/')
    slotsOf.set(k, [...(slotsOf.get(k) ?? []), i])
  })
  if (slotsOf.size === 1) return head + paths(frames[0]!, palette) + '</svg>'
  const dur = (n * FRAME_MS) / 1000
  const keyTimes = frames.map((_, i) => (i / n).toFixed(4)).join(';')
  const body = [...slotsOf.values()]
    .map((slots) => {
      const values = frames.map((_, j) => (slots.includes(j) ? 1 : 0)).join(';')
      return `<g opacity="${slots.includes(0) ? 1 : 0}"><animate attributeName="opacity" values="${values}" keyTimes="${keyTimes}" dur="${dur}s" calcMode="discrete" repeatCount="indefinite"/>${paths(frames[slots[0]!]!, palette)}</g>`
    })
    .join('')
  return head + body + '</svg>'
}

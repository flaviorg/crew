// Prices, model names and number formats. Pure, no mods API.
//
// Per-agent cost is an estimate: Claude Code reports the session's real cost, but not each
// subagent's, so crew multiplies an agent's tokens by this table and labels the result ≈.

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
/** $ per million tokens. */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type Family = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'mythos'

/** The usage fields a model response reports (TurnUsage), all optional here. */
export type UsageLike = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export const ZERO: Tokens = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

const rate = (input: number, output: number, cacheRead: number, cacheWrite: number): Price =>
  Object.freeze({ input, output, cacheRead, cacheWrite })
const T15_75 = rate(15, 75, 1.5, 18.75)
const T10_50 = rate(10, 50, 1, 12.5)
const T10_50_READ_025 = rate(10, 50, 0.25, 12.5)
const T5_25 = rate(5, 25, 0.5, 6.25)
const T3_15 = rate(3, 15, 0.3, 3.75)

/**
 * List prices by release (`opus 5.5`, as release() names it): the model catalog Claude
 * Code 2.1.296 ships, which its own session cost is priced from. Prices change between
 * releases of one family: Opus 5.5 costs less than Opus 5, Opus 4.1 three times more.
 *
 * A cache write is the 5-minute kind, 1.25× input: what a subagent writes unless its
 * settings ask for an hour (2× input). Hooks get a response's four token counts and no
 * more, so an hour's writes, fast mode and US-only inference (1.1×) cost more than this
 * says. So does a Haiku 5.5 request past 100k prompt tokens (5×): crew sums tokens, not
 * requests.
 */
export const PRICES: Readonly<Record<string, Price>> = Object.freeze({
  'opus 5.5': rate(4, 20, 0.2, 5),
  'opus 5': T5_25,
  'opus 4.8': T5_25,
  'opus 4.7': T5_25,
  'opus 4.6': T5_25,
  'opus 4.5': T5_25,
  'opus 4.1': T15_75,
  'opus 4': T15_75,
  'sonnet 5.5': rate(2, 10, 0.1, 2.5),
  'sonnet 5': rate(2, 10, 0.2, 2.5),
  'sonnet 4.6': T3_15,
  'sonnet 4.5': T3_15,
  'sonnet 4': T3_15,
  'sonnet 3.7': T3_15,
  'sonnet 3.5': T3_15,
  'haiku 5.5': rate(0.1, 0.5, 0.01, 0.125),
  'haiku 4.5': rate(1, 5, 0.1, 1.25),
  'haiku 3.5': rate(0.8, 4, 0.08, 1),
  'fable 5.1': T10_50_READ_025,
  'fable 5': T10_50,
  'mythos 5.1': T10_50_READ_025,
  'mythos 5': T10_50,
})

/** Each family's newest release: the price of one the table does not know yet. */
const NEWEST: Readonly<Record<Family, string>> = Object.freeze({
  opus: 'opus 5.5', sonnet: 'sonnet 5.5', haiku: 'haiku 5.5', fable: 'fable 5.1', mythos: 'mythos 5.1',
})

const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

export function family(model: string): Family | null {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('fable')) return 'fable'
  if (m.includes('mythos')) return 'mythos'
  return null
}

/**
 * The release a model id names, in any provider's spelling: `claude-opus-4-5-20251101`,
 * `us.anthropic.claude-opus-4-5-20251101-v1:0` and `claude-opus-4-5@20251101` are all
 * `opus 4.5`; `claude-opus-4-20250514` is `opus 4`, `claude-3-5-haiku-…` is `haiku 3.5`.
 * Null when the id carries no version.
 */
export function release(model: string): string | null {
  const m = model.toLowerCase()
  // claude-<name>-<major>[-<minor>], then a date or a suffix: a minor is at most two digits.
  const modern = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(m)
  // claude-<major>[-<minor>]-<name>, the older order
  const older = modern ? null : /claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)/.exec(m)
  const [name, major, minor] = modern ? [modern[1], modern[2], modern[3]] : older ? [older[3], older[1], older[2]] : []
  if (name === undefined || major === undefined) return null
  // `claude-opus-4-0` is Opus 4.
  return `${name} ${Number(major)}${minor !== undefined && Number(minor) > 0 ? '.' + Number(minor) : ''}`
}

function isPrice(v: unknown): v is Price {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return FIELDS.every((f) => typeof o[f] === 'number' && Number.isFinite(o[f]) && (o[f] as number) >= 0)
}

/**
 * The `prices` option: `{ "<family or model-id substring>": Price }`. Invalid JSON or a
 * non-object gives `{}`; an entry with a missing, non-number or negative field is dropped.
 */
export function parsePrices(json: string): Record<string, Price> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const out: Record<string, Price> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (key.trim() === '' || !isPrice(value)) continue
    out[key.toLowerCase()] = { input: value.input, output: value.output, cacheRead: value.cacheRead, cacheWrite: value.cacheWrite }
  }
  return out
}

/**
 * The price of a model: the longest override key the id contains (so `opus-5-5` beats
 * `opus`, and a family name works as a key), then the table's row for its release, then
 * its family's newest release, else null.
 */
export function priceFor(model: string, overrides: Record<string, Price>): Price | null {
  const m = model.toLowerCase()
  let best: string | null = null
  for (const key of Object.keys(overrides)) {
    if (m.includes(key) && (best === null || key.length > best.length)) best = key
  }
  if (best !== null) return overrides[best] ?? null
  const r = release(m)
  const listed = r === null ? undefined : PRICES[r]
  if (listed !== undefined) return listed
  const f = family(m)
  return f ? PRICES[NEWEST[f]] ?? null : null
}

export function cost(t: Tokens, p: Price): number {
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1e6
}

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite }
}

export function totalTokens(t: Tokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite
}

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

/** A response's usage as Tokens; anything missing, null or not a number counts 0. */
export function fromUsage(u: UsageLike | null | undefined): Tokens {
  if (!u) return { ...ZERO }
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    cacheWrite: count(u.cache_creation_input_tokens),
  }
}

/** How much of the window one request filled: everything it sent, cached or not. */
export function contextOf(u: UsageLike | null | undefined): number {
  const t = fromUsage(u)
  return t.input + t.cacheRead + t.cacheWrite
}

/**
 * An agent's context window. Claude Code only reports the main model's, so an agent on the
 * same model shares it; a `[1m]` id has a million; anything else gets the standard 200k.
 */
export function contextWindow(model: string, sessionWindow: number, mainModel: string): number {
  if (model !== '' && model === mainModel && sessionWindow > 0) return sessionWindow
  if (model.toLowerCase().includes('[1m]')) return 1_000_000
  return 200_000
}

/** `claude-haiku-4-5-20251001` → `haiku 4.5`, `claude-sonnet-4-5[1m]` → `sonnet 4.5 1M`. */
export function shortModel(model: string): string {
  const oneM = /\[1m\]/i.test(model)
  const bare = model.replace(/\[[^\]]*\]/g, '').trim()
  const suffix = oneM ? ' 1M' : ''
  // claude-<name>-<major>[-<minor>][-<yyyymmdd>]
  const modern = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(bare)
  if (modern) return `${modern[1]!.toLowerCase()} ${modern[2]}${modern[3] ? '.' + modern[3] : ''}${suffix}`
  // claude-<major>[-<minor>]-<name>[-<yyyymmdd>], the older order
  const older = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-\d{8})?$/i.exec(bare)
  if (older) return `${older[3]!.toLowerCase()} ${older[1]}${older[2] ? '.' + older[2] : ''}${suffix}`
  return bare + suffix
}

/** `999`, `1.5k`, `206.5k`, `2.0M`. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  // 999,950 would print as 1000.0k; say 1.0M instead.
  if (n < 999_950) return (n / 1000).toFixed(1) + 'k'
  return (n / 1e6).toFixed(1) + 'M'
}

/** `$0.41`; `≈` marks an estimate; a non-zero amount under a cent is `<$0.01`. */
export function formatUsd(usd: number, approx: boolean): string {
  const prefix = approx ? '≈' : ''
  const v = Number.isFinite(usd) && usd > 0 ? usd : 0
  if (v > 0 && v < 0.005) return prefix + '<$0.01'
  return prefix + '$' + v.toFixed(2)
}

/** `0:42`, `5:35`, `1:02:03`. */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

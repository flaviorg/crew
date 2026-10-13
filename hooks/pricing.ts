// Prices, model names and number formats. Pure, no mods API.
//
// Per-agent cost is an estimate: Claude Code reports the session's real cost, but not each
// subagent's, so crew multiplies an agent's tokens by this table and labels the result ≈.

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
/** $ per million tokens. */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type Family = 'opus' | 'sonnet' | 'haiku'

/** The usage fields a model response reports (TurnUsage), all optional here. */
export type UsageLike = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export const ZERO: Tokens = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

export const PRICES: Readonly<Record<Family, Price>> = Object.freeze({
  opus: Object.freeze({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }),
  sonnet: Object.freeze({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }),
  haiku: Object.freeze({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }),
})

const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

export function family(model: string): Family | null {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return null
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
 * `opus`, and a family name works as a key), then the built-in table, else null.
 */
export function priceFor(model: string, overrides: Record<string, Price>): Price | null {
  const m = model.toLowerCase()
  let best: string | null = null
  for (const key of Object.keys(overrides)) {
    if (m.includes(key) && (best === null || key.length > best.length)) best = key
  }
  if (best !== null) return overrides[best] ?? null
  const f = family(m)
  return f ? PRICES[f] : null
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

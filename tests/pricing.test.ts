import { expect, test } from 'claude-code/testing'
import {
  addTokens, contextOf, contextWindow, cost, family, formatClock, formatTokens, formatUsd,
  fromUsage, LONG_PROMPT, parsePrices, priceFor, PRICES, release, shortModel, totalTokens, ZERO,
} from '../hooks/pricing.ts'

const FABLE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }

test('families by model id', () => {
  expect(family('claude-opus-5-5')).toBe('opus')
  expect(family('claude-sonnet-4-5[1m]')).toBe('sonnet')
  expect(family('claude-haiku-4-5-20251001')).toBe('haiku')
  expect(family('Opus')).toBe('opus')
  expect(family('claude-fable-5-1')).toBe('fable')
  expect(family('claude-mythos-5')).toBe('mythos')
  expect(family('gpt-x')).toBe(null)
  expect(family('')).toBe(null)
})

test('releases by model id, in every provider spelling', () => {
  expect(release('claude-opus-5-5')).toBe('opus 5.5')
  expect(release('claude-opus-5-5[1m]')).toBe('opus 5.5')
  expect(release('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
  expect(release('us.anthropic.claude-opus-4-5-20251101-v1:0')).toBe('opus 4.5')
  expect(release('claude-opus-4-5@20251101')).toBe('opus 4.5')
  expect(release('us.anthropic.claude-opus-4-6-v1')).toBe('opus 4.6')
  // A major release alone; a date is not a minor version.
  expect(release('claude-opus-4-20250514')).toBe('opus 4')
  expect(release('claude-opus-4@20250514')).toBe('opus 4')
  expect(release('claude-opus-4-0')).toBe('opus 4')
  expect(release('claude-fable-5')).toBe('fable 5')
  // The older order: version first.
  expect(release('claude-3-5-haiku-20241022')).toBe('haiku 3.5')
  expect(release('claude-3-5-sonnet-v2@20241022')).toBe('sonnet 3.5')
  expect(release('opus')).toBe(null)
  expect(release('')).toBe(null)
})

// Claude Code's own model catalog (2.1.296), in $ per million tokens.
const OPUS_55 = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }
const SONNET_55 = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }
// Haiku 5.5 also has long-prompt rates, 5× its own, for a request past 100k prompt tokens.
const HAIKU_55 = {
  input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125,
  longPrompt: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
}
const FABLE_51 = { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }

test('the price table is Claude Code\'s list prices', () => {
  expect(priceFor('claude-opus-5-5', {})).toEqual(OPUS_55)
  expect(priceFor('claude-sonnet-5-5', {})).toEqual(SONNET_55)
  expect(priceFor('claude-haiku-5-5', {})).toEqual(HAIKU_55)
  expect(priceFor('claude-fable-5-1', {})).toEqual(FABLE_51)
  expect(priceFor('claude-fable-5', {})).toEqual({ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 })
  expect(priceFor('claude-mythos-5-1', {})).toEqual(FABLE_51)
  expect(priceFor('claude-opus-5', {})).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 })
  expect(priceFor('claude-opus-4-5-20251101', {})).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 })
  expect(priceFor('claude-opus-4-1-20250805', {})).toEqual({ input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 })
  expect(priceFor('claude-opus-4-20250514', {})).toEqual({ input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 })
  expect(priceFor('claude-sonnet-5', {})).toEqual({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 })
  expect(priceFor('claude-sonnet-4-5-20250929', {})).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 })
  expect(priceFor('claude-haiku-4-5-20251001', {})).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 })
  expect(priceFor('claude-3-5-haiku-20241022', {})).toEqual({ input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 })
  expect(priceFor('us.anthropic.claude-opus-5-5', {})).toEqual(OPUS_55)
  expect(priceFor('claude-opus-5-5[1m]', {})).toEqual(OPUS_55)
  // A cache write is the 5-minute kind, 1.25× input, in every row and every long-prompt rate.
  for (const p of Object.values(PRICES)) {
    expect(p.cacheWrite).toBe(p.input * 1.25)
    if (p.longPrompt) expect(p.longPrompt.cacheWrite).toBe(p.longPrompt.input * 1.25)
  }
  expect(cost({ input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, OPUS_55)).toBe(4)
  expect(Math.abs(cost({ input: 0, output: 2e6, cacheRead: 1e6, cacheWrite: 1e6 }, OPUS_55) - 45.2)).toBeLessThan(1e-9)
})

// Claude Code picks a request's rates on its own: past 100k prompt tokens (input and cache,
// read or written) a release with long-prompt rates charges those for all of it.
test('long requests are priced at their release\'s long-prompt rates', () => {
  expect(LONG_PROMPT).toBe(100_000)
  const t = { input: 2, output: 1_000, cacheRead: 150_000, cacheWrite: 0 }
  const haiku = priceFor('claude-haiku-5-5', {})!
  expect(Math.abs(cost(t, haiku) - 0.0020002)).toBeLessThan(1e-12)
  // `long` is the share of the tokens that long requests sent: here all of them.
  expect(Math.abs(cost(t, haiku, t) - 0.010001)).toBeLessThan(1e-12)
  const half = { input: 1, output: 500, cacheRead: 75_000, cacheWrite: 0 }
  expect(Math.abs(cost(t, haiku, half) - (0.0010001 + 0.0050005))).toBeLessThan(1e-12)
  // A release without them prices its long requests like the rest.
  expect(cost(t, OPUS_55, t)).toBe(cost(t, OPUS_55))
})

test('a release the table does not know is priced as its family\'s newest', () => {
  expect(priceFor('claude-opus-6', {})).toEqual(OPUS_55)
  expect(priceFor('opus', {})).toEqual(OPUS_55)
  expect(priceFor('claude-sonnet', {})).toEqual(SONNET_55)
  expect(priceFor('haiku', {})).toEqual(HAIKU_55)
  expect(priceFor('claude-fable-9', {})).toEqual(FABLE_51)
  expect(priceFor('gpt-x', {})).toBe(null)
  expect(priceFor('', {})).toBe(null)
})

// A real Explore agent on Opus 5.5, two tool calls in: 42.0k tokens, nearly all of them
// the system prompt and tools written to the cache by the first request and read back by
// the second. At Opus 4.5's prices it showed ≈$0.13; at Opus 5.5's it is ≈$0.10.
test('two steps of an Explore agent on Opus 5.5', () => {
  const steps = [
    { input_tokens: 2, output_tokens: 190, cache_read_input_tokens: 4_975, cache_creation_input_tokens: 13_983 },
    { input_tokens: 2, output_tokens: 195, cache_read_input_tokens: 18_958, cache_creation_input_tokens: 3_695 },
  ]
  const t = steps.map(fromUsage).reduce(addTokens, ZERO)
  expect(t).toEqual({ input: 4, output: 385, cacheRead: 23_933, cacheWrite: 17_678 })
  expect(formatTokens(totalTokens(t))).toBe('42.0k')
  const usd = cost(t, priceFor('claude-opus-5-5', {})!)
  expect(Math.abs(usd - 0.1008926)).toBeLessThan(1e-9)
  expect(formatUsd(usd, true)).toBe('≈$0.10')
  expect(formatUsd(cost(t, { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }), true)).toBe('≈$0.13')
})

test('parsePrices keeps valid entries only', () => {
  expect(parsePrices('{"opus":{"input":4,"output":20,"cacheRead":0.4,"cacheWrite":5}}')).toEqual({
    opus: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  })
  expect(parsePrices('not json')).toEqual({})
  expect(parsePrices('')).toEqual({})
  expect(parsePrices('[1,2]')).toEqual({})
  expect(parsePrices('null')).toEqual({})
  expect(parsePrices('{"opus":{"input":"4","output":20,"cacheRead":0.4,"cacheWrite":5},"fable":' + JSON.stringify(FABLE) + '}')).toEqual({ fable: FABLE })
  expect(parsePrices('{"opus":{"input":-1,"output":20,"cacheRead":0.4,"cacheWrite":5}}')).toEqual({})
})

test('priceFor: overrides, then the table, else null', () => {
  expect(priceFor('claude-fable-5-1', { fable: FABLE })).toEqual(FABLE)
  expect(priceFor('claude-nova-1', {})).toBe(null)
  expect(priceFor('claude-nova-1', { nova: FABLE })).toEqual(FABLE)
  expect(priceFor('claude-haiku-4-5', {})).toEqual(PRICES['haiku 4.5'])
  const cheapOpus = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }
  expect(priceFor('claude-opus-5-5', { opus: cheapOpus })).toEqual(cheapOpus)
  // A longer, more specific id wins over its family.
  const pinned = { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 }
  expect(priceFor('claude-opus-5-5', { opus: cheapOpus, 'opus-5-5': pinned })).toEqual(pinned)
  expect(priceFor('claude-opus-4-1', { opus: cheapOpus, 'opus-5-5': pinned })).toEqual(cheapOpus)
})

test('tokens from usage', () => {
  const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }
  expect(fromUsage(u)).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 })
  expect(fromUsage(null)).toEqual(ZERO)
  expect(fromUsage(undefined)).toEqual(ZERO)
  expect(fromUsage({ input_tokens: 3 })).toEqual({ input: 3, output: 0, cacheRead: 0, cacheWrite: 0 })
  expect(contextOf(u)).toBe(130)
  expect(contextOf(null)).toBe(0)
  expect(addTokens(fromUsage(u), fromUsage(u))).toEqual({ input: 20, output: 10, cacheRead: 200, cacheWrite: 40 })
  expect(totalTokens(fromUsage(u))).toBe(135)
})

test('context windows', () => {
  expect(contextWindow('claude-opus-5-5', 1_000_000, 'claude-opus-5-5')).toBe(1_000_000)
  expect(contextWindow('claude-sonnet-4-5[1m]', 200_000, 'claude-opus-5-5')).toBe(1_000_000)
  expect(contextWindow('claude-haiku-4-5', 1_000_000, 'claude-opus-5-5')).toBe(200_000)
})

test('short model names', () => {
  expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
  expect(shortModel('claude-opus-5-5')).toBe('opus 5.5')
  expect(shortModel('claude-fable-5-1')).toBe('fable 5.1')
  expect(shortModel('claude-sonnet-4-5[1m]')).toBe('sonnet 4.5 1M')
  expect(shortModel('claude-opus-4-20250514')).toBe('opus 4')
  expect(shortModel('sonnet')).toBe('sonnet')
  expect(shortModel('gpt-x')).toBe('gpt-x')
  expect(shortModel('')).toBe('')
})

test('token counts', () => {
  expect(formatTokens(0)).toBe('0')
  expect(formatTokens(999)).toBe('999')
  expect(formatTokens(1_500)).toBe('1.5k')
  expect(formatTokens(206_500)).toBe('206.5k')
  expect(formatTokens(999_960)).toBe('1.0M')
  expect(formatTokens(2_000_000)).toBe('2.0M')
  expect(formatTokens(12_345_678)).toBe('12.3M')
})

test('dollars', () => {
  expect(formatUsd(0.413, false)).toBe('$0.41')
  expect(formatUsd(0.004, true)).toBe('≈<$0.01')
  expect(formatUsd(0, true)).toBe('≈$0.00')
  expect(formatUsd(12.5, true)).toBe('≈$12.50')
})

test('clock', () => {
  expect(formatClock(42_000)).toBe('0:42')
  expect(formatClock(335_000)).toBe('5:35')
  expect(formatClock(3_723_000)).toBe('1:02:03')
  expect(formatClock(-5)).toBe('0:00')
})

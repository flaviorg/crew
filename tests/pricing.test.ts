import { expect, test } from 'claude-code/testing'
import {
  addTokens, contextOf, contextWindow, cost, family, formatClock, formatTokens, formatUsd,
  fromUsage, parsePrices, priceFor, PRICES, shortModel, totalTokens, ZERO,
} from '../hooks/pricing.ts'

const FABLE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }

test('families by model id', () => {
  expect(family('claude-opus-5-5')).toBe('opus')
  expect(family('claude-sonnet-4-5[1m]')).toBe('sonnet')
  expect(family('claude-haiku-4-5-20251001')).toBe('haiku')
  expect(family('Opus')).toBe('opus')
  expect(family('claude-fable-5-1')).toBe(null)
  expect(family('')).toBe(null)
})

test('the price table', () => {
  expect(PRICES.opus).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 })
  expect(PRICES.sonnet).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 })
  expect(PRICES.haiku).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 })
  expect(cost({ input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, PRICES.opus)).toBe(5)
  expect(Math.abs(cost({ input: 0, output: 2e6, cacheRead: 1e6, cacheWrite: 1e6 }, PRICES.haiku) - 11.35)).toBeLessThan(1e-9)
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
  expect(priceFor('claude-fable-5-1', {})).toBe(null)
  expect(priceFor('claude-fable-5-1', { fable: FABLE })).toEqual(FABLE)
  expect(priceFor('claude-haiku-4-5', {})).toEqual(PRICES.haiku)
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

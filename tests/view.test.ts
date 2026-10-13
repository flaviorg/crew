import { expect, test } from 'claude-code/testing'
import { completed, EMPTY, spawned, stepped, type AgentRow } from '../hooks/roster.ts'
import {
  ACCENT, bandFacts, bar, cards, cardsLine, ctxLabel, DOTS, EMPTY_TEXT, FINISHED_CAP, finishedRight,
  glyphOf, headerFacts, metaLine, statsLine, truncate,
} from '../hooks/view.ts'

function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'a1', description: 'Scan the repo', type: 'Explore', model: 'claude-haiku-4-5-20251001',
    background: false, workflow: false, startedAt: 0, status: 'running', steps: 7, tools: 3,
    tokens: { input: 9_000, output: 200_000, cacheRead: 0, cacheWrite: 0 }, context: 42_000, ...over,
  }
}

test('constants', () => {
  expect(ACCENT).toBe('#9B7BEA')
  expect(DOTS).toEqual(['●', '◉', '○', '◉'])
  expect(FINISHED_CAP).toBe(50)
  expect(EMPTY_TEXT).toBe('No subagents yet — they appear here when Claude delegates work.')
})

test('truncate', () => {
  expect(truncate('hello', 10)).toBe('hello')
  expect(truncate('hello', 5)).toBe('hello')
  expect(truncate('hello world', 6)).toBe('hello…')
  expect(truncate('hello', 1)).toBe('…')
  expect(truncate('hello', 0)).toBe('')
  expect(truncate('hello', -3)).toBe('')
  // Never splits a surrogate pair.
  expect(truncate('a😀b😀c', 3)).toBe('a😀…')
})

test('header facts', () => {
  expect(headerFacts({ running: 1, done: 15, failed: 0 })).toBe('1 running · 15 done')
  expect(headerFacts({ running: 1, done: 15, failed: 2 })).toBe('1 running · 15 done · 2 failed')
  expect(headerFacts({ running: 0, done: 0, failed: 1, stopped: 1 })).toBe('1 failed · 1 stopped')
  expect(headerFacts({ running: 0, done: 0, failed: 0 })).toBe('idle')
})

test('meta line', () => {
  expect(metaLine(row({ effort: 'high', lastTool: 'Bash' }), 80)).toBe('Explore · haiku 4.5 · high · step 7 · Bash')
  expect(metaLine(row(), 80)).toBe('Explore · haiku 4.5 · step 7')
  expect(metaLine(row({ steps: 0, model: '' }), 80)).toBe('Explore · starting')
  const cut = metaLine(row({ effort: 'high', lastTool: 'Bash' }), 20)
  expect(cut).toHaveLength(20)
  expect(cut).toEndWith('…')
})

test('bar', () => {
  const b = bar(21, 20)
  expect(b.filled).toBe('━━━━')
  expect(b.track).toBe('─'.repeat(16))
  expect(bar(150, 20)).toEqual({ filled: '━'.repeat(20), track: '' })
  expect(bar(-5, 20)).toEqual({ filled: '', track: '─'.repeat(20) })
  expect(bar(NaN, 4)).toEqual({ filled: '', track: '────' })
  expect(bar(50, 0)).toEqual({ filled: '', track: '' })
})

test('ctx label', () => {
  expect(ctxLabel(21)).toBe('ctx 21%')
  expect(ctxLabel(20.6)).toBe('ctx 21%')
  expect(ctxLabel(130)).toBe('ctx 100%')
  expect(ctxLabel(-1)).toBe('ctx 0%')
})

test('stats line', () => {
  expect(statsLine(row(), 335_000, 0.04)).toBe('209.0k tok · 3 tools · ≈$0.04 · 5:35')
  expect(statsLine(row({ tools: 1 }), 335_000, null)).toBe('209.0k tok · 1 tool · — · 5:35')
  expect(statsLine(row({ tools: 0 }), 1_000, null)).toBe('209.0k tok · — · 0:01')
  // A finished agent's clock stops at its end.
  expect(statsLine(row({ status: 'done', endedAt: 42_000 }), 999_000, 0.04)).toBe('209.0k tok · 3 tools · ≈$0.04 · 0:42')
})

test('finished right', () => {
  const a = row({ status: 'done', endedAt: 130_000, tokens: { input: 50_000, output: 2_000, cacheRead: 0, cacheWrite: 0 } })
  expect(finishedRight(a, 0.31)).toBe('haiku 4.5 · 52.0k · ≈$0.31 · 2:10')
  expect(finishedRight({ ...a, model: '' }, null)).toBe('52.0k · — · 2:10')
})

test('cards', () => {
  expect(cards({ realUsd: 0.41, estUsd: 0.5, tokens: 206_500, sessionMs: 738_000 })).toEqual([
    { label: 'Cost', value: '$0.41' },
    { label: 'Tokens', value: '206.5k' },
    { label: 'Time', value: '12:18' },
  ])
  expect(cards({ realUsd: null, estUsd: 0.41, tokens: 0, sessionMs: 0 })[0]).toEqual({ label: 'Cost', value: '≈$0.41' })
  expect(cards({ realUsd: null, estUsd: null, tokens: 0, sessionMs: 0 })[0]).toEqual({ label: 'Cost', value: '—' })
  expect(cardsLine(cards({ realUsd: 0.41, estUsd: null, tokens: 206_500, sessionMs: 738_000 }))).toBe('Cost $0.41 · Tokens 206.5k · Time 12:18')
})

test('band facts', () => {
  const M = { input_tokens: 100_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }
  const base = { description: 'x', type: 'Explore', model: 'claude-haiku-4-5', background: false, workflow: false }
  let r = spawned(spawned(EMPTY, { ...base, id: 'a', at: 0 }), { ...base, id: 'b', at: 10_000 })
  expect(bandFacts(r, 42_000, {})).toBe('2 running · 0:42 · ≈$0.00')
  r = stepped(stepped(r, 'a', M, undefined, 1), 'b', M, undefined, 1)
  expect(bandFacts(r, 42_000, {})).toBe('2 running · 0:42 · ≈$0.20')
  // A celebrating agent still counts; one filed away does not.
  r = completed(r, 'a', { at: 40_000, reason: 'answer' })
  expect(bandFacts(r, 42_000, {})).toStartWith('1 running · 1 done · 0:42')
  expect(bandFacts(r, 43_000, {})).toStartWith('1 running · 0:33')
  expect(bandFacts(spawned(EMPTY, { ...base, id: 'c', model: 'mystery', at: 0 }), 5_000, {})).toBe('1 running · 0:05')
})

test('glyphs', () => {
  expect(glyphOf('running', 0)).toEqual({ char: '●', color: ACCENT })
  expect(glyphOf('running', 1)).toEqual({ char: '◉', color: ACCENT })
  expect(glyphOf('running', 6)).toEqual({ char: '○', color: ACCENT })
  expect(glyphOf('done', 3)).toEqual({ char: '✓', color: 'success' })
  expect(glyphOf('failed', 3)).toEqual({ char: '✗', color: 'error' })
  expect(glyphOf('stopped', 3)).toEqual({ char: '■', color: 'warning' })
})

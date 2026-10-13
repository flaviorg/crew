import { expect, test } from 'claude-code/testing'
import { completed, EMPTY, run, spawned, stepped, type AgentRow } from '../hooks/roster.ts'
import {
  foldLabel, ACCENT, bandFacts, bar, cards, cardsLine, ctxLabel, DOTS, EMPTY_TEXT, FINISHED_CAP, finishedLine, finishedRight,
  fit, glyphOf, headerFacts, metaLine, oneLine, runningTitle, statsLine, truncate, widthOf,
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
  // The pulse never shows ○, the family's glyph for idle.
  expect(DOTS).toEqual(['●', '●', '◉', '◉'])
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
  // Never splits a surrogate pair; an emoji takes two cells.
  expect(truncate('a😀b😀c', 4)).toBe('a😀…')
  expect(truncate('a😀b😀c', 3)).toBe('a…')
  // Wide characters count two cells each.
  expect(truncate('日本語のテキスト', 7)).toBe('日本語…')
  expect(widthOf(truncate('Fix 🐛 in auth 日本語 and more', 12))).toBeLessThanOrEqual(12)
  // Control characters are never drawn.
  expect(truncate('a\u001b[31mb\u0007c', 20)).toBe('a [31mb c')
  expect(truncate('a\u0085b\u007fc\u2028d', 20)).toBe('a b c d')
})

test('width in cells', () => {
  expect(widthOf('hello')).toBe(5)
  expect(widthOf('日本語')).toBe(6)
  expect(widthOf('Fix 🐛')).toBe(6)
  expect(widthOf('e\u0301')).toBe(1)
  // crew's own glyphs are one cell.
  expect(widthOf('◆●◉✓✗■≈…━─')).toBe(10)
})

test('one line', () => {
  expect(oneLine('Fix the parser\nthen run tests')).toBe('Fix the parser then run tests')
  expect(oneLine('  col\tcol\r\n  ')).toBe('col col')
  expect(oneLine('Paint \u001b[31mred\u0007!')).toBe('Paint [31mred !')
  expect(oneLine('x'.repeat(500))).toHaveLength(200)
  expect(oneLine('x'.repeat(500), 20)).toBe('x'.repeat(19) + '…')
  expect(oneLine('')).toBe('')
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
  // Short of room, whole parts go before anything is cut: the last tool, then the effort.
  expect(metaLine(row({ effort: 'high', lastTool: 'Bash' }), 36)).toBe('Explore · haiku 4.5 · high · step 7')
  expect(metaLine(row({ effort: 'high', lastTool: 'Bash' }), 30)).toBe('Explore · haiku 4.5 · step 7')
})

test('fit drops whole parts, lowest rank first', () => {
  const parts = [{ text: 'a' }, { text: 'bb', drop: 1 }, { text: 'ccc', drop: 0 }]
  expect(fit(parts, 99)).toBe('a · bb · ccc')
  expect(fit(parts, 6)).toBe('a · bb')
  expect(fit(parts, 1)).toBe('a')
  expect(fit([{ text: 'abcdef' }], 4)).toBe('abc…')
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
  // Short of room the tool count goes, then the tokens; the cost and the time stay.
  expect(statsLine(row(), 335_000, 0.04, 30)).toBe('209.0k tok · ≈$0.04 · 5:35')
  expect(statsLine(row(), 335_000, 0.04, 20)).toBe('≈$0.04 · 5:35')
})

test('finished right', () => {
  const a = row({ status: 'done', endedAt: 130_000, tokens: { input: 50_000, output: 2_000, cacheRead: 0, cacheWrite: 0 } })
  expect(finishedRight(a, 0.31)).toBe('haiku 4.5 · 52.0k · ≈$0.31 · 2:10')
  expect(finishedRight({ ...a, model: '' }, null)).toBe('52.0k · — · 2:10')
})

test('finished line', () => {
  const a = row({
    description: 'Run the flaky test suite', status: 'failed', endedAt: 291_000, model: 'claude-sonnet-4-5',
    tokens: { input: 118_400, output: 0, cacheRead: 0, cacheWrite: 0 },
  })
  // Glyph, space, title, space, right side: exactly the width.
  const at = (w: number) => {
    const l = finishedLine(a, 0.12, w)
    expect(2 + widthOf(l.title) + 1 + widthOf(l.right)).toBeLessThanOrEqual(w)
    return l
  }
  expect(at(70)).toEqual({ title: 'Run the flaky test suite', right: 'sonnet 4.5 · 118.4k · ≈$0.12 · 4:51' })
  expect(at(60)).toEqual({ title: 'Run the flaky test su…', right: 'sonnet 4.5 · 118.4k · ≈$0.12 · 4:51' })
  // The title keeps 16 cells: the model goes, then the tokens, then the time.
  expect(at(44)).toEqual({ title: 'Run the flaky test…', right: '118.4k · ≈$0.12 · 4:51' })
  expect(at(35)).toEqual({ title: 'Run the flaky test…', right: '≈$0.12 · 4:51' })
  expect(at(30)).toEqual({ title: 'Run the flaky test s…', right: '≈$0.12' })
  expect(at(24).right).toBe('≈$0.12')
  // A short title needs less, so more of the right side stays.
  expect(finishedLine({ ...a, description: 'One' }, 0.12, 30)).toEqual({ title: 'One', right: '118.4k · ≈$0.12 · 4:51' })
})

test('cards', () => {
  expect(cards({ realUsd: 0.41, estUsd: 0.5, tokens: 206_500, sessionMs: 738_000 })).toEqual([
    { label: 'Cost', title: 'Session cost', value: '$0.41' },
    { label: 'Tokens', title: 'Session tokens', value: '206.5k' },
    { label: 'Time', title: 'Session time', value: '12:18' },
  ])
  expect(cards({ realUsd: null, estUsd: 0.41, tokens: 0, sessionMs: 0 })[0]).toEqual({ label: 'Cost', title: 'Session cost', value: '≈$0.41' })
  expect(cards({ realUsd: null, estUsd: null, tokens: 0, sessionMs: 0 })[0]).toEqual({ label: 'Cost', title: 'Session cost', value: '—' })
  expect(cardsLine(cards({ realUsd: 0.41, estUsd: null, tokens: 206_500, sessionMs: 738_000 }))).toBe('Cost $0.41 · Tokens 206.5k · Time 12:18')
  // Narrower, the compact form keeps all three values.
  expect(cardsLine(cards({ realUsd: 0.41, estUsd: null, tokens: 206_500, sessionMs: 738_000 }), 30)).toBe('$0.41 · 206.5k tok · 12:18')
})

test('band facts', () => {
  const M = { input_tokens: 100_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }
  const base = { description: 'x', type: 'Explore', model: 'claude-haiku-4-5', background: false, workflow: false }
  let r = spawned(spawned(EMPTY, { ...base, id: 'a', at: 0 }), { ...base, id: 'b', at: 10_000 })
  expect(bandFacts(r, 42_000, {})).toBe('2 running · 0:42 · ≈$0.00')
  r = stepped(stepped(r, 'a', M, undefined, 1), 'b', M, undefined, 1)
  expect(bandFacts(r, 42_000, {})).toBe('2 running · 0:42 · ≈$0.20')
  // A celebrating agent counts, and so does one filed away while the run goes on.
  r = completed(r, 'a', { at: 40_000, reason: 'answer' })
  expect(bandFacts(r, 42_000, {})).toStartWith('1 running · 1 done · 0:42')
  expect(bandFacts(r, 43_000, {})).toBe('1 running · 1 done · 0:43 · ≈$0.20')
  expect(bandFacts(r, 90_000, {})).toBe('1 running · 1 done · 1:30 · ≈$0.20')
  // Short of room, the agents that just ended go first, then the clock; the cost stays.
  expect(bandFacts(r, 42_000, {})).toBe('1 running · 1 done · 0:42 · ≈$0.20')
  expect(bandFacts(r, 42_000, {}, 25)).toBe('1 running · 0:42 · ≈$0.20')
  expect(bandFacts(r, 42_000, {}, 20)).toBe('1 running · ≈$0.20')
  expect(bandFacts(spawned(EMPTY, { ...base, id: 'c', model: 'mystery', at: 0 }), 5_000, {})).toBe('1 running · 0:05')
  // Once nothing runs, the clock stops at the last end while the last one celebrates.
  const last = completed(r, 'b', { at: 95_000, reason: 'answer' })
  expect(bandFacts(last, 96_000, {})).toBe('2 done · 1:35 · ≈$0.20')
  expect(bandFacts(last, 97_900, {})).toBe('2 done · 1:35 · ≈$0.20')
  // A run that ended before the next spawn is not added to it.
  const next = spawned(last, { ...base, id: 'c', at: 200_000 })
  expect(bandFacts(next, 205_000, {})).toBe('1 running · 0:05 · ≈$0.00')
})

test('the run behind the band', () => {
  const base = { description: 'x', type: 'Explore', model: 'claude-haiku-4-5', background: false, workflow: false }
  let r = spawned(spawned(EMPTY, { ...base, id: 'a', at: 0 }), { ...base, id: 'b', at: 10_000 })
  r = completed(r, 'a', { at: 20_000 })
  // Spawned while a still celebrated: the band never went away, so a stays in the run.
  r = completed(r, 'b', { at: 21_000 })
  r = spawned(r, { ...base, id: 'c', at: 23_500 })
  expect(run(r, 60_000).map((a) => a.id)).toEqual(['a', 'b', 'c'])
  // Spawned after the band went: a run of its own.
  r = completed(r, 'c', { at: 70_000 })
  r = spawned(r, { ...base, id: 'd', at: 73_000 })
  expect(run(r, 80_000).map((a) => a.id)).toEqual(['d'])
  r = completed(r, 'd', { at: 81_000 })
  expect(run(r, 90_000)).toEqual([])
})

test('the title over the cards counts every card under it', () => {
  expect(runningTitle(3, 0)).toBe('RUNNING · 3')
  expect(runningTitle(1, 2)).toBe('RUNNING · 1 · JUST FINISHED · 2')
  expect(runningTitle(0, 1)).toBe('JUST FINISHED · 1')
  // Short of room, the celebrating count goes first.
  expect(runningTitle(1, 2, 20)).toBe('RUNNING · 1')
})

test('glyphs', () => {
  expect(glyphOf('running', 0)).toEqual({ char: '●', color: ACCENT })
  expect(glyphOf('running', 2)).toEqual({ char: '◉', color: ACCENT })
  expect(glyphOf('running', 7)).toEqual({ char: '◉', color: ACCENT })
  for (let f = 0; f < 8; f++) expect(glyphOf('running', f).char).not.toBe('○')
  expect(glyphOf('done', 3)).toEqual({ char: '✓', color: 'success' })
  expect(glyphOf('failed', 3)).toEqual({ char: '✗', color: 'error' })
  expect(glyphOf('stopped', 3)).toEqual({ char: '■', color: 'warning' })
})

test('the fold button keeps its full label while it fits beside the title', async () => {
  expect(foldLabel(4, false, 60)).toBe('Collapse')
  expect(foldLabel(4, true, 60)).toBe('Expand')
  // 'FINISHED · 4' and 'c: Collapse' need 12 + 1 + 11 cells.
  expect(foldLabel(4, false, 24)).toBe('Collapse')
  expect(foldLabel(4, false, 23)).toBe('Hide')
  expect(foldLabel(40, true, 20)).toBe('Show')
})

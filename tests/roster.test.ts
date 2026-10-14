import { expect, test } from 'claude-code/testing'
import {
  anyLive, CELEBRATE_MS, completed, counts, EMPTY, estimate, finished, live, MAX_AGENTS, poseOf,
  QUIET_MS, reconciled, spawned, stepped, toolUsed, totals, type Roster,
} from '../hooks/roster.ts'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, model: 'claude-haiku-4-5' }

function agent(id: string, at = 0, type = 'Explore') {
  return { id, description: 'scan ' + id, type, model: 'claude-haiku-4-5', background: false, workflow: false, at }
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze((v as any)[k])
    Object.freeze(v)
  }
  return v
}

const one = (r: Roster, id = 'a1') => r.agents.find((a) => a.id === id)!

test('spawn adds a running agent', () => {
  const r = spawned(EMPTY, agent('a1', 1_000))
  expect(r.agents).toHaveLength(1)
  expect(one(r)).toEqual({
    id: 'a1', description: 'scan a1', type: 'Explore', model: 'claude-haiku-4-5', background: false, workflow: false,
    startedAt: 1_000, status: 'running', steps: 0, tools: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, context: 0,
  })
  expect(EMPTY.agents).toHaveLength(0)
})

test('duplicate spawn is ignored', () => {
  const r = spawned(spawned(EMPTY, agent('a1', 1)), { ...agent('a1', 2), description: 'other' })
  expect(r.agents).toHaveLength(1)
  expect(one(r).description).toBe('scan a1')
  expect(one(r).startedAt).toBe(1)
})

test('steps add tokens and context', () => {
  let r = spawned(EMPTY, { ...agent('a1'), model: '' })
  r = stepped(r, 'a1', USAGE, 'high', 10)
  r = stepped(r, 'a1', USAGE, 'high', 20)
  expect(one(r).tokens).toEqual({ input: 20, output: 10, cacheRead: 200, cacheWrite: 40 })
  expect(one(r).context).toBe(130)
  expect(one(r).steps).toBe(2)
  expect(one(r).model).toBe('claude-haiku-4-5')
  expect(one(r).effort).toBe('high')
  expect(stepped(r, 'a1', USAGE, 3, 30).agents[0]!.effort).toBe('3')
})

test('main steps go to main', () => {
  const r = stepped(spawned(EMPTY, agent('a1')), undefined, USAGE, undefined, 5)
  expect(r.main).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 })
  expect(r.mainSteps).toBe(1)
  expect(one(r).steps).toBe(0)
})

test('an unknown agent creates nothing', () => {
  const r = stepped(EMPTY, 'ghost', USAGE, undefined, 5)
  expect(r.agents).toHaveLength(0)
  expect(r.main).toEqual(EMPTY.main)
  expect(toolUsed(EMPTY, 'ghost', 'Bash').agents).toHaveLength(0)
  expect(completed(EMPTY, 'ghost', { at: 1, reason: 'answer' }).agents).toHaveLength(0)
})

test('null usage is ignored', () => {
  let r = stepped(spawned(EMPTY, agent('a1')), 'a1', USAGE, undefined, 1)
  r = stepped(r, 'a1', null, undefined, 2)
  r = stepped(r, 'a1', undefined, undefined, 3)
  expect(one(r).steps).toBe(3)
  expect(one(r).tokens).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 })
  expect(one(r).context).toBe(130)
  const m = stepped(EMPTY, undefined, null, undefined, 1)
  expect(m.mainSteps).toBe(1)
  expect(m.main).toEqual(EMPTY.main)
  expect(Number.isNaN(m.main.input)).toBe(false)
})

test('tools count and remember the last', () => {
  let r = spawned(EMPTY, agent('a1'))
  r = toolUsed(r, 'a1', 'Read')
  r = toolUsed(r, 'a1', 'Bash')
  expect(one(r).tools).toBe(2)
  expect(one(r).lastTool).toBe('Bash')
})

test('complete reasons', () => {
  const r = spawned(EMPTY, agent('a1'))
  expect(one(completed(r, 'a1', { at: 9, reason: 'answer' })).status).toBe('done')
  expect(one(completed(r, 'a1', { at: 9 })).status).toBe('done')
  expect(one(completed(r, 'a1', { at: 9, reason: 'error' })).status).toBe('failed')
  expect(one(completed(r, 'a1', { at: 9, reason: 'refusal' })).status).toBe('failed')
  expect(one(completed(r, 'a1', { at: 9, reason: 'aborted' })).status).toBe('stopped')
  expect(one(completed(r, 'a1', { at: 9, reason: 'answer', isAborted: true })).status).toBe('stopped')
  expect(one(completed(r, 'a1', { at: 9 })).endedAt).toBe(9)
})

test('complete does not double count', () => {
  let r = stepped(spawned(EMPTY, agent('a1')), 'a1', USAGE, undefined, 1)
  // turn.complete carries the turn's summed usage; completed() takes none, so tokens stay.
  r = completed(r, 'a1', { at: 2, reason: 'answer' })
  expect(one(r).tokens).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 })
})

test("a teammate's next step runs it again", () => {
  let r = completed(spawned(EMPTY, agent('a1')), 'a1', { at: 5, reason: 'answer' })
  r = stepped(r, 'a1', USAGE, undefined, 100)
  expect(one(r).status).toBe('running')
  expect('endedAt' in one(r)).toBe(false)
  // It worked 5 ms before, so its clock picks up at 5 ms rather than counting the idle gap.
  expect(one(r).startedAt).toBe(95)
})

test('a stopped or failed agent that is resumed runs again', () => {
  for (const end of [{ isAborted: true }, { reason: 'error' }, { reason: 'refusal' }]) {
    let r = stepped(spawned(EMPTY, agent('a1')), 'a1', USAGE, undefined, 4, 't1')
    r = completed(r, 'a1', { at: 5, turnId: 't1', ...end })
    expect(one(r).status).not.toBe('running')
    // A late result of the turn that just ended does not revive it.
    expect(one(stepped(r, 'a1', USAGE, undefined, 6, 't1')).status).toBe(one(r).status)
    // A message resumes it under the same id, in a new turn: it runs again.
    r = stepped(r, 'a1', USAGE, undefined, 5_005, 't2')
    expect(one(r).status).toBe('running')
    expect('endedAt' in one(r)).toBe(false)
    expect(one(r).startedAt).toBe(5_000)
    expect(one(r).tokens.input).toBe(20)
  }
  // An agent the list called failed or killed runs again on its next step too.
  const k = reconciled(spawned(EMPTY, agent('a1')), [{ id: 'a1', status: 'killed' }], 10)
  expect(one(stepped(k, 'a1', USAGE, undefined, 20, 't9')).status).toBe('running')
})

test('reconcile marks failed and killed', () => {
  let r = spawned(spawned(spawned(EMPTY, agent('a1')), agent('a2')), agent('a3'))
  r = reconciled(r, [{ id: 'a1', status: 'failed' }, { id: 'a2', status: 'killed' }, { id: 'a3', status: 'completed' }], 50)
  expect(one(r, 'a1').status).toBe('failed')
  expect(one(r, 'a2').status).toBe('stopped')
  expect(one(r, 'a3').status).toBe('done')
  expect(one(r, 'a1').endedAt).toBe(50)
  // A done agent the list later calls completed keeps its own end time.
  const d = completed(spawned(EMPTY, agent('a1')), 'a1', { at: 7, reason: 'answer' })
  expect(one(reconciled(d, [{ id: 'a1', status: 'completed' }], 99)).endedAt).toBe(7)
})

test('reconcile ends a running agent the list calls idle', () => {
  // A teammate in a terminal pane of its own runs no loop here: the list is all we hear.
  const r = spawned(spawned(EMPTY, agent('scout@team', 0, 'teammate')), agent('a1'))
  const after = reconciled(r, [{ id: 'scout@team', status: 'idle' }, { id: 'a1', status: 'running' }], 360_000)
  expect(one(after, 'scout@team').status).toBe('done')
  expect(one(after, 'scout@team').endedAt).toBe(360_000)
  expect(one(after, 'a1').status).toBe('running')
  // An idle teammate already marked done by its turn end keeps its own end time.
  const d = completed(r, 'a1', { at: 7, reason: 'answer' })
  expect(one(reconciled(d, [{ id: 'a1', status: 'idle' }], 99), 'a1').endedAt).toBe(7)
  // Waiting and pending are not ends.
  expect(reconciled(r, [{ id: 'a1', status: 'waiting' }, { id: 'scout@team', status: 'pending' }], 9)).toBe(r)
})

test('an unlisted agent silent for a long time is stopped', () => {
  // A workflow agent is never listed; one never heard from (a remote one, a stalled one
  // retried under a new id) would otherwise run forever.
  let r = spawned(spawned(EMPTY, { ...agent('wf', 0), workflow: true }), { ...agent('wf2', 0), workflow: true })
  r = stepped(r, 'wf2', USAGE, undefined, 60_000)
  expect(reconciled(r, [], QUIET_MS - 1)).toBe(r)
  const after = reconciled(r, [], QUIET_MS)
  expect(one(after, 'wf').status).toBe('stopped')
  // It ended when it was last heard from.
  expect(one(after, 'wf').endedAt).toBe(0)
  expect(one(after, 'wf2').status).toBe('running')
  expect(one(reconciled(r, [], 60_000 + QUIET_MS), 'wf2').status).toBe('stopped')
  expect(one(reconciled(r, [], 60_000 + QUIET_MS), 'wf2').endedAt).toBe(60_000)
  // A listed agent is the list's to judge, however quiet it is.
  expect(one(reconciled(r, [{ id: 'wf', status: 'waiting' }], QUIET_MS * 2), 'wf').status).toBe('running')
  // One that works again after all picks up where it went quiet.
  const back = stepped(after, 'wf', USAGE, undefined, QUIET_MS + 10_000, 't2')
  expect(one(back, 'wf').status).toBe('running')
  expect(one(back, 'wf').startedAt).toBe(QUIET_MS + 10_000)
})

test('reconcile leaves unlisted agents alone', () => {
  const r = spawned(spawned(EMPTY, { ...agent('wf'), workflow: true }), agent('a1'))
  const after = reconciled(r, [{ id: 'a1', status: 'running' }], 50)
  expect(one(after, 'wf').status).toBe('running')
  expect(one(after, 'a1').status).toBe('running')
  // Nothing changed, so the same roster comes back and nothing needs writing.
  expect(after).toBe(r)
  expect(reconciled(r, [], 50)).toBe(r)
})

test('live keeps a finished agent for 3 s', () => {
  const t = 10_000
  let r = spawned(spawned(EMPTY, agent('a1', 0)), agent('a2', 1))
  r = completed(r, 'a1', { at: t, reason: 'answer' })
  expect(live(r, t + CELEBRATE_MS - 1).map((a) => a.id)).toEqual(['a1', 'a2'])
  expect(live(r, t + CELEBRATE_MS).map((a) => a.id)).toEqual(['a2'])
  expect(finished(r, t + CELEBRATE_MS - 1)).toHaveLength(0)
  expect(finished(r, t + CELEBRATE_MS).map((a) => a.id)).toEqual(['a1'])
  expect(anyLive(r, t + CELEBRATE_MS)).toBe(true)
  r = completed(r, 'a2', { at: t + 1, reason: 'answer' })
  expect(anyLive(r, t + 1 + CELEBRATE_MS)).toBe(false)
  // Finished is newest first.
  expect(finished(r, t + 1 + CELEBRATE_MS).map((a) => a.id)).toEqual(['a2', 'a1'])
})

test('poseOf', () => {
  const r = spawned(EMPTY, agent('a1'))
  expect(poseOf(one(r))).toBe('working')
  expect(poseOf(one(completed(r, 'a1', { at: 1, reason: 'answer' })))).toBe('done')
  expect(poseOf(one(completed(r, 'a1', { at: 1, reason: 'error' })))).toBe('failed')
  expect(poseOf(one(completed(r, 'a1', { at: 1, isAborted: true })))).toBe('failed')
})

test('counts', () => {
  let r = EMPTY
  for (const id of ['a', 'b', 'c', 'd', 'e']) r = spawned(r, agent(id))
  r = completed(r, 'a', { at: 1, reason: 'answer' })
  r = completed(r, 'b', { at: 1, reason: 'answer' })
  r = completed(r, 'c', { at: 1, reason: 'error' })
  r = completed(r, 'd', { at: 1, isAborted: true })
  expect(counts(r)).toEqual({ running: 1, done: 2, failed: 1, stopped: 1 })
  expect(counts(EMPTY)).toEqual({ running: 0, done: 0, failed: 0, stopped: 0 })
})

test('estimate uses the price table', () => {
  let r = spawned(EMPTY, agent('a1'))
  r = stepped(r, 'a1', { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' }, undefined, 1)
  expect(estimate(one(r), {})).toBe(1)
  expect(estimate({ ...one(r), model: 'claude-fable-5-1' }, {})).toBe(10)
  expect(estimate({ ...one(r), model: 'claude-fable-5-1' }, { fable: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 } })).toBe(2)
  expect(estimate({ ...one(r), model: 'mystery' }, {})).toBe(null)
})

// Three agents of a real session on Opus 5.5, two steps each (the outputs rounded), beside
// a Session cost card of $0.49: the main loop's two requests, its cache writes the 1-hour
// kind, were about $0.19 of it, which leaves the agents about $0.30. At Opus 4.5's prices
// each showed ≈$0.13 and the three ≈$0.40.
test('three Opus 5.5 agents two steps in', () => {
  const steps: Record<string, [number, number, number][]> = {
    a1: [[190, 4_975, 13_983], [195, 18_958, 3_695]],
    a2: [[190, 4_975, 14_020], [195, 18_995, 3_691]],
    a3: [[190, 5_098, 14_126], [195, 19_224, 3_717]],
  }
  let r = EMPTY
  for (const [id, list] of Object.entries(steps)) {
    r = spawned(r, { ...agent(id), model: 'claude-opus-5-5' })
    for (const [out, read, write] of list) {
      r = stepped(r, id, { input_tokens: 2, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: write, model: 'claude-opus-5-5' }, undefined, 1)
    }
  }
  expect(r.agents.map((a) => a.tokens.cacheWrite)).toEqual([17_678, 17_711, 17_843])
  const usd = r.agents.map((a) => estimate(a, {})!)
  expect(usd.map((u) => u.toFixed(2))).toEqual(['0.10', '0.10', '0.10'])
  expect(Math.abs(usd.reduce((a, b) => a + b, 0) - 0.303753)).toBeLessThan(1e-9)
})

test('totals adds main and agents', () => {
  const M = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  let r = spawned(EMPTY, agent('a1'))
  r = stepped(r, 'a1', { ...M, model: 'claude-haiku-4-5' }, undefined, 1)
  r = stepped(r, undefined, { ...M, model: 'claude-opus-5-5' }, undefined, 2)
  expect(totals(r, {}, 'claude-opus-5-5')).toEqual({ tokens: 2_000_000, estUsd: 5 })
  // The main loop on an unknown model is left out of the estimate, not counted as zero.
  expect(totals(r, {}, 'mystery')).toEqual({ tokens: 2_000_000, estUsd: 1 })
  expect(totals(EMPTY, {}, '').estUsd).toBe(null)
})

// One Haiku 5.5 request with 150k tokens read from the cache: Claude Code prices it at the
// long-prompt rates, (2 × 0.5 + 1,000 × 2.5 + 150,000 × 0.05) / 1e6, 5× the base rates.
test('a request past 100k prompt tokens is priced at its long-prompt rates', () => {
  const long = { input_tokens: 2, output_tokens: 1_000, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' }
  let r = spawned(EMPTY, { ...agent('a1'), model: 'claude-haiku-5-5' })
  r = stepped(r, 'a1', long, undefined, 1)
  expect(Math.abs(estimate(one(r), {})! - 0.010001)).toBeLessThan(1e-12)
  // A prompt of exactly 100k is not past it: that request is at the base rates.
  r = stepped(r, 'a1', { ...long, cache_read_input_tokens: 99_998 }, undefined, 2)
  expect(Math.abs(estimate(one(r), {})! - (0.010001 + 0.00150018))).toBeLessThan(1e-12)
  expect(one(r).tokens).toEqual({ input: 4, output: 2_000, cacheRead: 249_998, cacheWrite: 0 })
  // The main loop's requests too.
  const main = stepped(EMPTY, undefined, long, undefined, 1)
  expect(Math.abs(totals(main, {}, 'claude-haiku-5-5').estUsd! - 0.010001)).toBeLessThan(1e-12)
  // A `prices` override has no long-prompt rates: every request is at its price.
  const flat = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }
  expect(estimate(one(r), { haiku: flat })).toBe(0.252002)
})

test('drops oldest finished past MAX_AGENTS', () => {
  let r = spawned(spawned(EMPTY, agent('old-1', 0)), agent('old-2', 1))
  r = completed(r, 'old-1', { at: 2, reason: 'answer' })
  for (let i = 0; i < MAX_AGENTS - 1; i++) r = spawned(r, agent('n' + i, 10 + i))
  expect(r.agents).toHaveLength(MAX_AGENTS)
  expect(r.agents.some((a) => a.id === 'old-1')).toBe(false)
  // A running agent is never dropped, even when it is the oldest.
  expect(r.agents[0]!.id).toBe('old-2')
})

test('inputs are never changed', () => {
  const r = deepFreeze(stepped(spawned(EMPTY, agent('a1')), 'a1', USAGE, 'low', 1))
  const ops = [
    () => spawned(r, agent('a2')),
    () => stepped(r, 'a1', USAGE, 'high', 2),
    () => stepped(r, undefined, USAGE, undefined, 2),
    () => toolUsed(r, 'a1', 'Bash'),
    () => completed(r, 'a1', { at: 3, reason: 'answer' }),
    () => reconciled(r, [{ id: 'a1', status: 'failed' }], 4),
  ]
  for (const op of ops) expect(op).not.toThrow()
  expect(one(r).steps).toBe(1)
})

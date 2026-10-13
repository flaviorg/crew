import { expect, mock, test } from 'claude-code/testing'
import { widthOf } from '../hooks/view.ts'

const PANE = {
  plugin: 'crew',
  component: 'Pane',
  requestId: 'crew',
  viewport: { columns: 120, rows: 60 },
  props: { title: 'Crew', isFocused: false, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 200 }, view: {} },
} as const

/** The pane seated beside a fullscreen transcript. */
const DOCK = { ...PANE, props: { ...PANE.props, placement: 'dock' } } as const

const BAND = {
  plugin: 'crew',
  component: 'AbovePrompt',
  viewport: { columns: 120, rows: 60 },
  props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

const SURFACES = ['terminal', 'desktop'] as const

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, model: 'claude-haiku-4-5' }

type Stubs = {
  clock: any
  opens: any[]
  closes: string[]
  /** `open` and `close`, in the order the mod asked for them. */
  calls: string[]
  /** Crew's open pane is a tab behind another plugin's, as in a fullscreen dock. */
  behind: boolean
  toasts: string[]
  stored: Record<string, unknown>
  usage: any
  answer: any
  broken: boolean
  periods: number
}

type StubOptions = {
  placed?: boolean
  list?: any[]
  cost?: number
  store?: Record<string, unknown>
  /** Answer `$.ui.panes()` or `$.ui.close()` with a refusal. */
  deny?: ('ui.panes' | 'ui.close')[]
  /** Refuse the first `clock.every` period, which ends that interval. */
  refuseFirstPeriod?: boolean
}

// Everything the mod may call on $, answered in memory, plus the engine beneath its hooks.
function stubs(on: any, o: StubOptions = {}): Stubs {
  const s: Stubs = { clock: null, opens: [], closes: [], calls: [], behind: false, toasts: [], stored: { ...(o.store ?? {}) }, usage: USAGE, answer: null, broken: false, periods: 0 }
  const deny = new Set(o.deny ?? [])
  const open = new Set<string>()
  let n = 0
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], ...(o.cost === undefined ? {} : { cost: { usd: o.cost } }) } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('agent.list', () => ({ value: o.list ?? [] }))
  on('ui.open', ($: any, e: any) => {
    s.opens.push(e)
    s.calls.push('open')
    // A pane that opens comes to the front; a second open of an open id only retitles it.
    if (!open.has(e.id)) s.behind = false
    open.add(e.id)
    return { value: o.placed === false ? { isPlaced: false, reason: 'the terminal is 100 columns; 144 are needed' } : { isPlaced: true } }
  })
  on('ui.close', ($: any, e: any) => {
    s.closes.push(e.id)
    s.calls.push('close')
    if (deny.has('ui.close')) return { deny: 'kept open' }
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () =>
    deny.has('ui.panes')
      ? { deny: 'panes down' }
      : { value: [...open].map((id) => ({ id, title: 'Crew', isShown: o.placed !== false && !s.behind, isFocused: false, isPlaced: o.placed !== false })) })
  on('ui.toast', ($: any, e: any) => { s.toasts.push(e.text); return { value: undefined } })
  on('command.register', () => ({ value: { command: 'crew' } }))
  on('store.get', ($: any, e: any) => ({ value: s.stored[e.key] }))
  on('store.set', ($: any, e: any) => { s.stored[e.key] = e.value; return { value: undefined } })
  // mock.clock answers the timers; this wrapper counts each clock.every period it is asked
  // for, and can refuse the first one.
  let refuse = o.refuseFirstPeriod === true
  const counted = (event: string, ...rest: any[]) => {
    const fn = rest[rest.length - 1]
    if (event !== 'clock.every') return on(event, ...rest)
    return on(event, ...rest.slice(0, -1), (...a: any[]) => {
      s.periods++
      if (refuse) {
        refuse = false
        return { deny: 'period refused' }
      }
      return fn(...a)
    })
  }
  s.clock = mock.clock(counted as any, { now: 0 })
  on('agent.spawn', () => s.answer ?? { model: 'claude-haiku-4-5', agentId: 'ag-' + ++n })
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.step', async function* ($: any, e: any) {
    if (s.broken) {
      // A response that breaks off partway: an overload, a dropped connection.
      yield { kind: 'text', index: 0, text: 'he' }
      yield { kind: 'tool', index: 1, id: 'tu1', name: 'Bash' }
      yield { kind: 'input', index: 1, json: '{"command":"ls"}' }
      throw new Error('stream broke')
    }
    yield { kind: 'stop', stopReason: 'end_turn', usage: s.usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: s.usage }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return s
}

function spawn($: any, description: string, type = 'Explore') {
  return $.agent.spawn({ prompt: 'go', description, subagentType: type, parentModel: 'claude-opus-5-5', background: false, fork: false })
}

async function step($: any, s: Stubs, agentId: string | undefined, usage: any, turnId = 't1') {
  s.usage = usage
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-haiku-4-5', messageCount: 1, effort: 'high', ...(agentId ? { agentId } : {}) })
  let r = await stream.next()
  while (r.done !== true) r = await stream.next()
  return r.value
}

function complete($: any, agentId: string, more: Record<string, unknown> = { reason: 'answer' }) {
  return $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1_000, isAborted: false, agentId, ...more })
}

const textOf = async (ui: any, query: any) => (await ui.find(query))?.text

// The cells a drawn element needs to sit on its lines without wrapping: a row adds up its
// children, a column takes the widest, a Box with a width takes that.
function needs(n: any): number {
  if (typeof n === 'string') return widthOf(n)
  if (n === null || typeof n !== 'object') return 0
  const p = n.props ?? {}
  const kids = [n.children ?? []].flat(Infinity).filter((c: any) => c !== null && c !== undefined && c !== false)
  if (n.type === 'Text') return widthOf(kids.map((c: any) => (typeof c === 'string' ? c : '')).join(''))
  if (n.type === 'Raster') return p.columns
  if (n.type === 'Button') return widthOf(`${p.hotkey}: ${p.label}`)
  if (n.type !== 'Box') return 0
  const margin = p.marginLeft ?? 0
  if (typeof p.width === 'number') return p.width + margin
  const frame = 2 * (p.paddingX ?? 0) + (p.paddingLeft ?? 0) + (p.paddingRight ?? 0) + (p.borderStyle ? 2 : 0) + margin
  const ws = kids.map(needs)
  if ((p.flexDirection ?? 'row') !== 'row') return frame + Math.max(0, ...ws)
  return frame + ws.reduce((a: number, b: number) => a + b, 0) + (p.gap ?? 0) * Math.max(0, kids.length - 1)
}

// Boxes whose key starts with a prefix (find matches a key exactly).
const keyed = async (ui: any, prefix: string) => (await ui.findAll({ type: 'Box' })).filter((x: any) => String(x.key ?? '').startsWith(prefix))

test('a spawn shows a card with a mascot', async ($, on) => {
  stubs(on)
  const r: any = await spawn($, 'Scan the repo')
  expect(r).toEqual({ model: 'claude-haiku-4-5', agentId: 'ag-1' })
  for (const surface of [...SURFACES, 'mobile'] as const) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Scan the repo' })).toBeDefined()
    expect(await ui.find({ text: /◆ crew · 1 running/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'RUNNING · 1' })).toBeDefined()
    expect(await ui.find({ key: 'agent:ag-1' })).toBeDefined()
    if (surface === 'terminal') {
      const raster = await ui.find({ type: 'Raster', key: 'm:ag-1' })
      expect(raster.props.columns).toBe(11)
      expect(raster.props.rows).toBe(5)
    } else {
      const svg = await ui.find({ type: 'Svg' })
      expect(svg.props.isInteractive).toBe(true)
      expect(svg.props.alt).toBe('Scan the repo — working')
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('the empty pane says what will happen', async ($, on) => {
  stubs(on)
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'No subagents yet — they appear here when Claude delegates work.' })).toBeDefined()
    expect(await ui.find({ text: /◆ crew · idle/ })).toBeDefined()
    expect(await textOf(ui, { key: 'card:tokens' })).toBe('Session tokens0')
    expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined()
    await ui.unmount()
  }
})

test('denied spawn adds nothing', async ($, on) => {
  const s = stubs(on)
  s.answer = { deny: 'no' }
  const r: any = await spawn($, 'Scan the repo')
  expect(r).toEqual({ deny: 'no' })
  expect(s.opens).toHaveLength(0)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
  expect(await ui.find({ text: /RUNNING/ })).toBeUndefined()
})

test('a spawn without an agent id adds nothing', async ($, on) => {
  const s = stubs(on)
  s.answer = { model: 'claude-haiku-4-5' }
  expect(await spawn($, 'Scan the repo')).toEqual({ model: 'claude-haiku-4-5' })
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
})

test('steps fill tokens and the context bar', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Scan the repo')
  const result: any = await step($, s, 'ag-1', USAGE)
  expect(result.usage).toEqual(USAGE)
  let ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'ctx 0%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^135 tok · / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Explore · haiku 4.5 · high · step 1' })).toBeDefined()
  await ui.unmount()
  await step($, s, 'ag-1', { input_tokens: 2_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'ctx 21%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^42\.6k tok · / })).toBeDefined()
  // The gauge and its label fill the text column (70 less the mascot and its margin), so
  // the label ends under the status glyph: 50 cells of bar, 21% of them filled.
  expect(await textOf(ui, { type: 'Text', text: /^━+$/ })).toBe('━'.repeat(Math.round(0.21 * 50)))
  expect(await textOf(ui, { type: 'Text', text: /^─+$/ })).toHaveLength(50 - 11)
})

// The chunks a step's stream delivers, in order, and how it ended.
async function chunks($: any, agentId?: string) {
  const seen: string[] = []
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-4-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
  try {
    for (let r = await stream.next(); r.done !== true; r = await stream.next()) seen.push(r.value.kind + ':' + (r.value.text ?? r.value.name ?? r.value.json ?? ''))
    seen.push('returned')
  } catch {
    seen.push('threw')
  }
  return seen
}

test('a stream that breaks off passes each chunk once', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Scan the repo')
  s.broken = true
  const once = ['text:he', 'tool:Bash', 'input:{"command":"ls"}', 'threw']
  expect(await chunks($, 'ag-1')).toEqual(once)
  expect(await chunks($)).toEqual(once)
  // The broken step adds nothing; the next whole one counts as usual.
  s.broken = false
  await step($, s, 'ag-1', USAGE)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /step 1$/ })).toBeDefined()
})

test('outside text is drawn on one line, free of control characters', async ($, on) => {
  const s = stubs(on)
  // A surface refuses a whole tree whose text holds one: the mount would reject.
  await spawn($, 'Paint \u001b[31mred\u0007 and\nthen\ttest\u0085 it', 'code\u001breviewer')
  await ($.tool.call as any)({ tool: 'Bash', command: 'ls', agentId: 'ag-1' })
  const clean = 'Paint [31mred and then test it'
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: clean })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^code reviewer · / })).toBeDefined()
    if (surface === 'desktop') expect((await ui.find({ type: 'Svg' })).props.alt).toBe(clean + ' — working')
    await ui.unmount()
  }
  await complete($, 'ag-1')
  await s.clock.advance(3_000)
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    expect(await textOf(ui, { key: 'done:ag-1' })).toContain('✓ ' + clean)
    await ui.unmount()
  }
})

test('long descriptions keep the tree small', async ($, on) => {
  stubs(on)
  for (let i = 0; i < 12; i++) await spawn($, 'Check every file under src/ for stale imports '.repeat(200) + i)
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(80_000)
    for (const svg of await ui.findAll({ type: 'Svg' })) expect(svg.props.alt.length).toBeLessThanOrEqual(90)
    await ui.unmount()
  }
})

test('main-loop steps count toward the Tokens card only', async ($, on) => {
  const s = stubs(on)
  await step($, s, undefined, USAGE)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await textOf(ui, { key: 'card:tokens' })).toBe('Session tokens135')
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
})

test('null usage keeps tokens', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Scan the repo')
  await step($, s, 'ag-1', USAGE)
  await step($, s, 'ag-1', null)
  await complete($, 'ag-1', { reason: 'answer', usage: null })
  await complete($, 'ag-1', { reason: 'answer' })
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^135 tok · / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /step 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /NaN/ })).toBeUndefined()
})

test('tool calls show the last tool', async ($, on) => {
  stubs(on)
  await spawn($, 'Scan the repo')
  const out = await ($.tool.call as any)({ tool: 'Bash', command: 'ls', agentId: 'ag-1' })
  expect(out).toEqual({ result: 'ok' })
  await ($.tool.call as any)({ tool: 'Read', file_path: '/w/a.ts' })
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /· Bash$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / · 1 tool · / })).toBeDefined()
})

test('a finished agent celebrates, then files away', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Scan the repo')
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await complete($, 'ag-1')
  await s.clock.advance(250)
  expect(await ui.find({ type: 'Text', text: '✓' })).toBeDefined()
  // The card stays to celebrate, counted apart from the running ones.
  expect(await ui.find({ key: 'agent:ag-1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'JUST FINISHED · 1' })).toBeDefined()
  expect(await ui.find({ text: /◆ crew · 1 done/ })).toBeDefined()
  await s.clock.advance(2_750)
  expect(await ui.find({ type: 'Text', text: /^RUNNING|^JUST FINISHED/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'FINISHED · 1' })).toBeDefined()
  expect(await textOf(ui, { key: 'done:ag-1' })).toMatch(/^✓ Scan the repo.*haiku 4\.5 · 0 · ≈\$0\.00 · 0:00$/)
  expect(await ui.find({ text: /◆ crew · 1 done/ })).toBeDefined()
})

test('a turn end that comes before the spawn\'s row still ends the agent', async ($, on) => {
  const s = stubs(on)
  // The agent fails on its first request, before the spawn hook has written its row.
  await complete($, 'ag-1', { reason: 'error' })
  await spawn($, 'Fast fail')
  await s.clock.advance(3_000)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'agent:ag-1' })).toBeUndefined()
  expect(await textOf(ui, { key: 'done:ag-1' })).toMatch(/^✗ Fast fail/)
  expect(await ui.find({ text: /◆ crew · 1 failed/ })).toBeDefined()
})

test('failed and stopped', async ($, on) => {
  stubs(on)
  await spawn($, 'One')
  await spawn($, 'Two')
  await complete($, 'ag-1', { reason: 'error' })
  await complete($, 'ag-2', { reason: 'answer', isAborted: true })
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    expect(await textOf(ui, { key: 'agent:ag-1' })).toContain('✗')
    expect(await textOf(ui, { key: 'agent:ag-2' })).toContain('■')
    expect(await ui.find({ text: /◆ crew · 1 failed · 1 stopped/ })).toBeDefined()
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).map((x: any) => x.props.alt)).toEqual(['One — failed', 'Two — failed'])
    await ui.unmount()
  }
})

test('the mascot animates', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Scan the repo')
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const before = (await ui.find({ type: 'Raster' })).props.cells
  const dot = await textOf(ui, { type: 'Text', text: /^[●◉○]$/ })
  await s.clock.advance(250)
  const after = (await ui.find({ type: 'Raster' })).props.cells
  expect(after).not.toBe(before)
  // The dot pulses every other frame.
  await s.clock.advance(250)
  expect(await textOf(ui, { type: 'Text', text: /^[●◉]$/ })).not.toBe(dot)
})

test('agents animate out of step', async ($, on) => {
  stubs(on)
  for (let i = 0; i < 6; i++) await spawn($, 'Agent ' + i)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Six Explore agents in the same pose, not all on the same frame.
  const cells = (await ui.findAll({ type: 'Raster' })).map((x: any) => x.props.cells)
  expect(cells).toHaveLength(6)
  expect(new Set(cells).size).toBeGreaterThan(1)
})

test('the first card sits right under its title', async ($, on) => {
  stubs(on)
  await spawn($, 'One')
  await spawn($, 'Two')
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'agent:ag-1' })).props.marginTop).toBe(0)
  expect((await ui.find({ key: 'agent:ag-2' })).props.marginTop).toBe(1)
})

test('once every agent has finished, the idle mascot comes back', async ($, on) => {
  const s = stubs(on)
  await $.command.run({ command: 'crew', args: '' })
  await spawn($, 'Scan the repo')
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'm:idle' })).toBeUndefined()
  await complete($, 'ag-1')
  await s.clock.advance(3_000)
  expect(await ui.find({ type: 'Text', text: 'All quiet — new subagents appear here when Claude delegates work.' })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'm:idle' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeUndefined()
  // It blinks while the pane is shown.
  const seen = new Set<string>()
  for (let i = 0; i < 8; i++) {
    seen.add((await ui.find({ type: 'Raster', key: 'm:idle' })).props.cells)
    await s.clock.advance(250)
  }
  expect(seen.size).toBe(2)
})

test('auto-opens once, toasts once when it cannot place', async ($, on) => {
  const s = stubs(on, { placed: false })
  await spawn($, 'One')
  await spawn($, 'Two')
  expect(s.opens).toEqual([{ id: 'crew', title: 'Crew', columns: 60 }])
  expect(s.toasts).toEqual(['crew: run /crew to watch your subagents'])
})

test('auto-open placed shows no toast', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'One')
  expect(s.opens).toHaveLength(1)
  expect(s.toasts).toHaveLength(0)
})

test('autoOpen off', { options: { autoOpen: 'off' } }, async ($, on) => {
  const s = stubs(on)
  await spawn($, 'One')
  expect(s.opens).toHaveLength(0)
  expect(s.toasts).toHaveLength(0)
})

test('the band shows while agents run', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Scan the repo')
  await spawn($, 'Plan it', 'Plan')
  await s.clock.advance(10_000)
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '◆ crew ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 2 running · 0:10 · ≈\$0\.00 / })).toBeDefined()
    const button = await ui.find({ type: 'Button', key: 'band-open' })
    expect(button.props.hotkey).toBe('o')
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    // One dot per live agent, in its mascot's color.
    expect((await ui.findAll({ type: 'Text', text: /^[●◉]$/ })).map((x: any) => x.props.color)).toEqual(['#35B5AC', '#9B7BEA'])
    await ui.unmount()
  }
  const ui: any = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'band-open' })
  expect(s.opens.length).toBe(2)
  await complete($, 'ag-1')
  await complete($, 'ag-2')
  await s.clock.advance(3_000)
  expect(await ui.find({ text: /◆ crew/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('the band yields to a survey', async ($, on) => {
  stubs(on)
  await spawn($, 'Scan the repo')
  const ui: any = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })
  expect(await ui.find({ text: /◆ crew/ })).toBeUndefined()
})

test('band off', { options: { band: 'off' } }, async ($, on) => {
  stubs(on)
  await spawn($, 'Scan the repo')
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /◆ crew/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await ui.unmount()
  }
})

test('/crew toggles', async ($, on) => {
  const s = stubs(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(await $.command.run({ command: 'crew', args: '' })).toEqual({})
  expect(s.opens).toEqual([{ id: 'crew', title: 'Crew', columns: 60 }])
  expect(await $.command.run({ command: 'crew', args: '' })).toEqual({})
  expect(s.closes).toEqual(['crew'])
  await $.command.run({ command: 'crew', args: '' })
  expect(s.opens).toHaveLength(2)
})

test('/crew brings the pane to the front from behind another tab', async ($, on) => {
  const s = stubs(on)
  await $.command.run({ command: 'crew', args: '' })
  // Another plugin's pane opens in the dock: crew's is a tab behind it.
  s.behind = true
  expect(await $.command.run({ command: 'crew', args: '' })).toEqual({})
  // An open of an open id only retitles it, so crew closes its tab and opens it again.
  expect(s.calls).toEqual(['open', 'close', 'open'])
  expect(s.opens[1]).toEqual({ id: 'crew', title: 'Crew', columns: 60 })
  expect(s.behind).toBe(false)
  // In front, the next /crew hides it.
  await $.command.run({ command: 'crew', args: '' })
  expect(s.calls).toEqual(['open', 'close', 'open', 'close'])
})

test('the band\'s Open brings the pane to the front, and never hides it', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Scan the repo')
  s.behind = true
  const ui: any = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'band-open' })
  expect(s.calls).toEqual(['open', 'close', 'open'])
  expect(s.behind).toBe(false)
  await ui.press({ key: 'band-open' })
  expect(s.calls).toEqual(['open', 'close', 'open', 'open'])
})

test('a spawn leaves an open pane where it is', async ($, on) => {
  const s = stubs(on)
  await $.command.run({ command: 'crew', args: '' })
  s.behind = true
  await spawn($, 'Scan the repo')
  // Opened unasked, it does not take the front from the pane the person is looking at.
  expect(s.closes).toEqual([])
  expect(s.behind).toBe(true)
})

test('/crew opens the pane when the pane list cannot be read', async ($, on) => {
  const s = stubs(on, { deny: ['ui.panes'] })
  expect(await $.command.run({ command: 'crew', args: '' })).toEqual({})
  expect(s.opens).toEqual([{ id: 'crew', title: 'Crew', columns: 60 }])
})

test('/crew answers in words when the pane cannot be closed', async ($, on) => {
  const s = stubs(on, { deny: ['ui.close'] })
  await $.command.run({ command: 'crew', args: '' })
  const answer: any = await $.command.run({ command: 'crew', args: '' })
  expect(s.closes).toEqual(['crew'])
  expect(answer.text).toMatch(/^crew: /)
})

test('the clock comes back after a refused period', async ($, on) => {
  const s = stubs(on, { refuseFirstPeriod: true })
  await spawn($, 'Scan the repo')
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const before = (await ui.find({ type: 'Raster' })).props.cells
  await s.clock.advance(1_000)
  // A refused period ends an interval without a word; the next spawn or drawing notices.
  await spawn($, 'Plan it', 'Plan')
  await s.clock.advance(500)
  expect((await ui.find({ type: 'Raster', key: 'm:ag-1' })).props.cells).not.toBe(before)
  // And it still files agents away and clears the band.
  await complete($, 'ag-1')
  await complete($, 'ag-2')
  await s.clock.advance(10_000)
  const band: any = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: /◆ crew/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'FINISHED · 2' })).toBeDefined()
})

test('the clock stops when nothing is live and the pane list cannot be read', { options: { autoOpen: 'off' } }, async ($, on) => {
  const s = stubs(on, { deny: ['ui.panes'] })
  await spawn($, 'Scan the repo')
  await complete($, 'ag-1')
  await s.clock.advance(5_000)
  const periods = s.periods
  await s.clock.advance(60_000)
  expect(s.periods - periods).toBeLessThan(4)
})

test('collapse sticks', async ($, on) => {
  const s = stubs(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await spawn($, 'Scan the repo')
  await complete($, 'ag-1')
  await s.clock.advance(3_000)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'done:ag-1' })).toBeDefined()
  const button = await ui.find({ type: 'Button', key: 'collapse' })
  expect(button.props.hotkey).toBe('c')
  expect(button.props.label).toBe('Collapse')
  await ui.press({ key: 'collapse' })
  expect(await ui.find({ key: 'done:ag-1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'FINISHED · 1' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'collapse' })).props.hotkey).toBe('e')
  expect(s.stored.collapsed).toBe(true)
})

test('a collapsed choice is read at start', async ($, on) => {
  const s = stubs(on, { store: { collapsed: true } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await spawn($, 'Scan the repo')
  await complete($, 'ag-1')
  await s.clock.advance(3_000)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'done:ag-1' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'collapse' })).props.label).toBe('Expand')
})

test('reconcile picks up failures', async ($, on) => {
  const s = stubs(on, { list: [{ id: 'ag-1', status: 'failed', description: 'x', type: 'Explore' }] })
  await spawn($, 'Scan the repo')
  await spawn($, 'Run the workflow step', 'general-purpose')
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await s.clock.advance(2_000)
  expect(await textOf(ui, { key: 'agent:ag-1' })).toContain('✗')
  // ag-2 is not listed (as a workflow agent never is): still running.
  expect(await textOf(ui, { key: 'agent:ag-2' })).not.toContain('✗')
  expect(await ui.find({ text: /◆ crew · 1 running · 1 failed/ })).toBeDefined()
})

test('a stopped agent that is resumed gets its card back', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Scan the repo')
  await step($, s, 'ag-1', USAGE)
  await complete($, 'ag-1', { reason: 'aborted', isAborted: true })
  await s.clock.advance(5_000)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await textOf(ui, { key: 'done:ag-1' })).toMatch(/^■ Scan the repo/)
  // The person says "go on": the same agent works again, in a new turn.
  await step($, s, 'ag-1', USAGE, 't2')
  await ($.tool.call as any)({ tool: 'Bash', command: 'ls', agentId: 'ag-1' })
  await s.clock.advance(250)
  expect(await ui.find({ key: 'done:ag-1' })).toBeUndefined()
  expect(await textOf(ui, { key: 'agent:ag-1' })).toMatch(/[●◉]Explore · haiku 4\.5 · high · step 2 · Bash/)
  expect(await ui.find({ text: /◆ crew · 1 running/ })).toBeDefined()
})

test('a teammate the agent list calls idle files away', async ($, on) => {
  // A teammate in a terminal pane of its own runs no loop here: no step, no turn end.
  const s = stubs(on, { list: [{ id: 'ag-1', status: 'idle', description: 'Scout the API', type: 'teammate' }] })
  await spawn($, 'Scout the API', 'teammate')
  await s.clock.advance(2_000)
  await s.clock.advance(3_000)
  for (const surface of SURFACES) {
    const band: any = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ text: /◆ crew/ })).toBeUndefined()
    await band.unmount()
  }
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await textOf(ui, { key: 'done:ag-1' })).toMatch(/^✓ Scout the API/)
})

test('real cost wins in the Cost card', async ($, on) => {
  stubs(on, { cost: 1.5 })
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await textOf(ui, { key: 'card:cost' })).toBe('Session cost$1.50')
})

test('without a real cost the card shows the estimate', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Scan the repo')
  await step($, s, 'ag-1', { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' })
  const ui: any = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await textOf(ui, { key: 'card:cost' })).toBe('Session cost≈$1.00')
  expect(await textOf(ui, { key: 'card:tokens' })).toBe('Session tokens1.0M')
})

test('the Time card ticks while the pane is shown', async ($, on) => {
  const s = stubs(on)
  await $.command.run({ command: 'crew', args: '' })
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await textOf(ui, { key: 'card:time' })).toBe('Session time0:00')
  await s.clock.advance(5_000)
  expect(await textOf(ui, { key: 'card:time' })).toBe('Session time0:05')
})

test('every line fits a narrow pane', async ($, on) => {
  const s = stubs(on)
  await spawn($, 'Draft the migration plan for the billing service and every consumer of it', 'Plan')
  await step($, s, 'ag-1', { input_tokens: 4_000, output_tokens: 3_000, cache_read_input_tokens: 148_000, cache_creation_input_tokens: 2_000, model: 'claude-opus-5-5' })
  await ($.tool.call as any)({ tool: 'Read', file_path: '/w/a.ts', agentId: 'ag-1' })
  for (let i = 0; i < 3; i++) await spawn($, 'Run the flaky test suite ' + i, 'general-purpose')
  await complete($, 'ag-2', { reason: 'error' })
  await complete($, 'ag-3', { reason: 'answer', isAborted: true })
  await complete($, 'ag-4')
  await spawn($, 'Scan the repo for TODO markers', 'Explore')
  await s.clock.advance(358_000)
  for (const cols of [26, 30, 44, 60, 70, 100]) {
    const ui: any = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: cols }, surface: 'terminal' })
    expect(needs(await ui.drawn())).toBeLessThanOrEqual(cols)
    // The header never wraps: the family mark stays whole, the facts are cut.
    expect(widthOf(await textOf(ui, { type: 'Text', text: /^ · \d+ running/ }))).toBeLessThanOrEqual(cols - 6)
    // Narrower than a mascot and a readable line, a card gets a dot.
    expect(await ui.findAll({ type: 'Raster' })).toHaveLength(cols >= 28 ? 2 : 0)
    await ui.unmount()
  }
  const ui: any = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 20 }, surface: 'terminal' })
  expect(widthOf(await textOf(ui, { type: 'Text', text: /^ · / }))).toBeLessThanOrEqual(14)
  expect(await textOf(ui, { type: 'Text', text: /^ctx \d+%$|^ ctx/ })).toBeDefined()
  // The band keeps the cost when it runs short: the counts of agents just ended go first.
  const band: any = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 50 }, surface: 'terminal' })
  expect(needs(await band.drawn())).toBeLessThanOrEqual(50)
})

test('a docked pane keeps a column clear of the dock\'s border', async ($, on) => {
  const s = stubs(on, { cost: 12.5 })
  await spawn($, 'Scan the repo for TODO markers')
  await step($, s, 'ag-1', { input_tokens: 2_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' })
  const cardCells = async (ui: any) =>
    (await Promise.all(['cost', 'tokens', 'time'].map(async (k) => (await ui.find({ key: 'card:' + k })).props.width))).reduce((a, b) => a + b, 2)
  const gaugeCells = async (ui: any) =>
    widthOf((await textOf(ui, { type: 'Text', text: /^━+$/ })) + (await textOf(ui, { type: 'Text', text: /^─+$/ })))
  for (const surface of SURFACES) {
    // Docked, the engine draws the body flush against its borders: crew pads a cell on
    // each side and lays out to the 68 the padding leaves.
    let ui: any = await $.ui.mount({ ...DOCK, surface })
    let root = await ui.drawn()
    expect(root.props.paddingLeft).toBe(1)
    expect(root.props.paddingRight).toBe(1)
    expect(await cardCells(ui)).toBe(68)
    expect(await gaugeCells(ui)).toBe(48)
    expect(needs(root)).toBeLessThanOrEqual(70)
    await ui.unmount()
    // Inline the frame has its own space: no padding, all 70 cells.
    ui = await $.ui.mount({ ...PANE, surface })
    root = await ui.drawn()
    expect(root.props.paddingLeft).toBeUndefined()
    expect(root.props.paddingRight).toBeUndefined()
    expect(await cardCells(ui)).toBe(70)
    expect(await gaugeCells(ui)).toBe(50)
    await ui.unmount()
  }
  for (const cols of [26, 30, 44]) {
    const ui: any = await $.ui.mount({ ...DOCK, props: { ...DOCK.props, bodyColumns: cols }, surface: 'terminal' })
    expect(needs(await ui.drawn())).toBeLessThanOrEqual(cols)
    await ui.unmount()
  }
})

test('at the dock\'s narrowest the Finished title and its button share one line', async ($, on) => {
  const s = stubs(on)
  for (let i = 0; i < 12; i++) await spawn($, 'Agent ' + i)
  await complete($, 'ag-1')
  await s.clock.advance(3_000)
  // The engine's narrowest dock leaves 23 cells; crew pads one on each side.
  for (const cols of [23, 24, 26]) {
    const ui: any = await $.ui.mount({ ...DOCK, props: { ...DOCK.props, bodyColumns: cols }, surface: 'terminal' })
    expect(needs(await ui.drawn())).toBeLessThanOrEqual(cols)
    await ui.unmount()
  }
  for (let i = 2; i <= 12; i++) await complete($, 'ag-' + i)
  await s.clock.advance(3_000)
  for (const cols of [23, 24]) {
    const ui: any = await $.ui.mount({ ...DOCK, props: { ...DOCK.props, bodyColumns: cols }, surface: 'terminal' })
    // The idle line below is prose in a shrinking box and wraps; the title row must not.
    expect(await ui.find({ type: 'Text', text: 'FINISHED · 12' })).toBeDefined()
    const button = await ui.find({ key: 'collapse' })
    expect(button.props.label).toBe('Hide')
    expect(widthOf('FINISHED · 12') + 1 + needs(button)).toBeLessThanOrEqual(cols - 2)
    await ui.unmount()
  }
})

test('stat cards share the width evenly', async ($, on) => {
  stubs(on, { cost: 12.5 })
  for (const cols of [36, 70, 100]) {
    const ui: any = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: cols }, surface: 'terminal' })
    const widths = await Promise.all(['cost', 'tokens', 'time'].map(async (k) => (await ui.find({ key: 'card:' + k })).props.width))
    expect(widths[0]).toBe(widths[1])
    expect(widths[2]! - widths[0]!).toBeLessThanOrEqual(2)
    expect(widths[0]! + widths[1]! + widths[2]! + 2).toBe(cols)
    // The cards are the session's totals and say so, when they have the room.
    expect(await textOf(ui, { key: 'card:cost' })).toStartWith(cols >= 60 ? 'Session cost' : 'Cost')
    await ui.unmount()
  }
})

test('a narrow pane draws the cards as one line', async ($, on) => {
  stubs(on, { cost: 0.41 })
  const ui: any = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 34 }, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Cost $0.41 · Tokens 0 · Time 0:00' })).toBeDefined()
  expect(await ui.find({ key: 'card:cost' })).toBeUndefined()
})

test('draws thirty running agents', async ($, on) => {
  const s = stubs(on)
  for (let i = 0; i < 30; i++) await spawn($, 'Agent number ' + i, i % 3 === 0 ? 'Plan' : 'Explore')
  for (let i = 0; i < 200; i++) await spawn($, 'Done ' + i)
  for (let i = 31; i <= 230; i++) await complete($, 'ag-' + i)
  await s.clock.advance(3_000)
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    expect(await keyed(ui, 'agent:')).toHaveLength(30)
    expect(await ui.find({ type: 'Text', text: 'RUNNING · 30' })).toBeDefined()
    // A drawn tree is bounded at 100,000 characters; stay well inside it.
    expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(80_000)
    // Mascot art has a budget: every Raster fits it, while SVGs past it fall back to dots.
    if (surface === 'terminal') expect(await ui.findAll({ type: 'Raster' })).toHaveLength(30)
    else expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(8)
    await ui.unmount()
  }
})

test('caps running cards', async ($, on) => {
  stubs(on)
  for (let i = 0; i < 35; i++) await spawn($, 'Agent ' + i)
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    expect(await keyed(ui, 'agent:')).toHaveLength(30)
    expect(await ui.find({ type: 'Text', text: 'RUNNING · 35' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '… 5 more running' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(80_000)
    await ui.unmount()
  }
})

test('caps finished rows', async ($, on) => {
  const s = stubs(on)
  for (let i = 0; i < 60; i++) await spawn($, 'Agent ' + i)
  for (let i = 1; i <= 60; i++) await complete($, 'ag-' + i)
  await s.clock.advance(3_000)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await keyed(ui, 'done:')).toHaveLength(50)
  expect(await ui.find({ type: 'Text', text: '… 10 more' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'FINISHED · 60' })).toBeDefined()
})

test('mascot off draws a dot', { options: { mascot: 'off' } }, async ($, on) => {
  stubs(on)
  await spawn($, 'Scan the repo')
  for (const surface of SURFACES) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    // The mascot's place holds a dot in its coat's color.
    expect((await ui.findAll({ type: 'Text', text: '●' })).some((x: any) => x.props.color === '#35B5AC')).toBe(true)
    await ui.unmount()
  }
})

test('observers pass results through untouched', async ($, on) => {
  const s = stubs(on)
  const spawned: any = await spawn($, 'Scan the repo')
  expect(spawned).toEqual({ model: 'claude-haiku-4-5', agentId: 'ag-1' })
  expect(await ($.tool.call as any)({ tool: 'Bash', command: 'ls', agentId: 'ag-1' })).toEqual({ result: 'ok' })
  expect(await step($, s, 'ag-1', USAGE)).toEqual({ turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE })
  expect(await complete($, 'ag-1')).toEqual({ text: '' })
  expect(await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })).toEqual({ cwd: '/w' })
})

// crew — a live panel of the subagents Claude delegates to.
//
// This is the only file that touches the mods API ($). It observes the agents' events,
// keeps the roster in one $.state atom, runs one animation clock, and arranges the pure
// modules' output into elements: sprites.ts (the mascots), pricing.ts (prices and
// formats), roster.ts (the agents' lifecycle) and view.ts (the text of every line).

import { atom, read, update } from 'claude-code'
import { contextWindow, parsePrices, type Price } from './pricing.ts'
import {
  anyLive, completed, counts, EMPTY, estimate, finished, live, poseOf, reconciled, spawned, stepped,
  toolUsed, totals, type AgentRow, type Roster,
} from './roster.ts'
import { encodeCells, FRAME_MS, frameAt, kindOf, paletteFor, spriteSvg, SPRITE_COLUMNS, SPRITE_ROWS, type Pose } from './sprites.ts'
import {
  ACCENT, bandFacts, bar, cards, cardsLine, ctxLabel, EMPTY_TEXT, FINISHED_CAP, finishedRight, glyphOf,
  headerFacts, metaLine, oneLine, statsLine, truncate,
} from './view.ts'

const PANE = 'crew'
const OPEN = { id: PANE, title: 'Crew', columns: 60 } as const

// A drawn tree is bounded at 100,000 characters. Mascot art may take this much of it
// (thirty terminal mascots, about ten SVG ones); past it, mascots are dots.
const ART_BUDGET = 32_000
/** Running cards drawn; past this, one line says how many more. */
const RUNNING_CAP = 30
/** Dots in the band, one per live agent. */
const BAND_DOTS = 8
/** Ticks between two looks at $.agent.list(): every 2 s while an agent runs. */
const RECONCILE_EVERY = 8
/** With no period for this long, the interval is gone: a refused period ends it silently. */
const STALL_MS = 4 * FRAME_MS

type Options = { autoOpen: 'on' | 'off'; band: 'on' | 'off'; mascot: 'on' | 'off'; prices: string }
type View = { width: number; window: number; mainModel: string; now: number; art: { left: number } }

const rosterAtom = atom({ plugin: 'crew', key: 'roster' } as const, EMPTY)

let settings: Options = { autoOpen: 'on', band: 'on', mascot: 'on', prices: '' }
let overrides: Record<string, Price> = {}

// Throwaway values: nothing here needs to survive a reload.
let frame = 0 // the animation frame, one per FRAME_MS
let ticker: { cancel(): void } | null = null
let beat = { at: 0, frame: 0 } // the last time ensureTicker saw the frame counter, and its value
let busy = false // a tick still waiting on the host makes the next one skip its work
let wasLive = false // so the tick after the last agent files away redraws once more
let paneShown = true // as last seen by the ticker
let opened = false // the pane opens by itself once per session
let collapsed = false // the Finished section, folded; kept in $.store so the choice sticks

// Turn ends for agents with no row yet: one that fails on its first request can end before
// its spawn hook has written the row. The spawn applies its own; the oldest go past EARLY_MAX.
type End = { at: number; reason?: string; isAborted?: boolean; turnId?: string }
const early = new Map<string, End>()
const EARLY_MAX = 20

function keepEarly(id: string, end: End) {
  early.delete(id)
  early.set(id, end)
  if (early.size > EARLY_MAX) early.delete(early.keys().next().value!)
}

// ── the clock ──────────────────────────────────────────────────────────────────────────

// One clock drives everything that moves: every frame while an agent is live (4 a second,
// under the redraw cap), once a second for the Time card while only the pane is shown,
// and nothing at all otherwise.
//
// A refused period ends an interval and its handle does not say so. Whoever calls this
// passes the time: when no period has come for STALL_MS, the old interval is replaced.
function ensureTicker($: any, now: number) {
  if (ticker && now - beat.at >= STALL_MS) {
    if (frame === beat.frame) stopTicker()
    beat = { at: now, frame }
  }
  if (ticker) return
  paneShown = true
  beat = { at: now, frame }
  try {
    ticker = $.clock.every(FRAME_MS, () => onTick($))
  } catch {
    ticker = null
  }
}

function stopTicker() {
  try {
    ticker?.cancel()
  } catch {}
  ticker = null
}

async function clockNow($: any): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return beat.at
  }
}

// Whether crew's pane is shown; null when the host cannot say.
async function paneIsShown($: any): Promise<boolean | null> {
  try {
    return (await $.ui.panes()).some((p: any) => p.id === PANE && p.isShown)
  } catch {
    return null
  }
}

async function onTick($: any) {
  frame++
  if (busy) return
  busy = true
  try {
    if (frame % RECONCILE_EVERY === 0) await reconcile($)
    const r = await read($, rosterAtom)
    const isLive = anyLive(r, await $.clock.now())
    if (isLive || wasLive) $.ui.invalidate('ui.render')
    wasLive = isLive
    if (isLive) return
    if (frame % 4 === 0) {
      // A pane list the host cannot give counts as no pane: the clock stops, not spins.
      paneShown = (await paneIsShown($)) === true
      if (!paneShown) return stopTicker()
    }
    // The empty pane's idle mascot blinks: draw just the frames where it changes.
    const blinked = r.agents.length === 0 && frameAt('general', 'idle', frame) !== frameAt('general', 'idle', frame - 1)
    if (paneShown && (frame % 4 === 0 || blinked)) $.ui.invalidate('ui.render')
  } catch {
    // A failed tick is skipped; the next one tries again.
  } finally {
    busy = false
  }
}

// $.agent.list() is the only word on a failure or a kill that no turn.complete reports.
// Workflow agents are never listed, so an unlisted agent is left alone.
async function reconcile($: any) {
  const r = await read($, rosterAtom)
  if (!r.agents.some((a) => a.status === 'running')) return
  let list: any[]
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  const at = await $.clock.now()
  if (reconciled(r, list, at) !== r) await update($, rosterAtom, (x) => reconciled(x, list, at))
}

// ── the pane ───────────────────────────────────────────────────────────────────────────

async function openPane($: any) {
  try {
    await $.ui.open(OPEN)
  } catch {}
  ensureTicker($, await clockNow($))
}

// The first spawn opens the pane by itself. Unasked, a pane is seated only on a wide
// terminal; when it is not, say once how to see it.
async function autoOpen($: any) {
  if (settings.autoOpen !== 'on' || opened) return
  opened = true
  try {
    const placed = await $.ui.open(OPEN)
    if (placed?.isPlaced === false) $.ui.toast('crew: run /crew to watch your subagents')
  } catch {}
}

async function toggleCollapsed($: any) {
  collapsed = !collapsed
  try {
    await $.store.set('collapsed', collapsed)
  } catch {}
  $.ui.invalidate('ui.render')
}

// Takes `size` characters from the tree's art budget, if they are left.
function spend(art: { left: number }, size: number): boolean {
  if (size > art.left) return false
  art.left -= size
  return true
}

// One agent's mascot for the surface drawing it: half-block pixels in the terminal, a
// self-animating SVG where Svg exists, a dot in its coat's color otherwise (and once the
// art budget is spent).
function mascot($: any, e: any, id: string, type: string, pose: Pose, alt: string, art: { left: number }) {
  const palette = paletteFor(type, pose)
  if (settings.mascot === 'on') {
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      const cells = encodeCells(frameAt(kindOf(type), pose, frame), palette)
      if (Raster && spend(art, cells.length)) return Raster({ key: 'm:' + id, columns: SPRITE_COLUMNS, rows: SPRITE_ROWS, cells })
    } else if (e.surface === 'desktop' || e.surface === 'vscode' || e.surface === 'mobile') {
      const { Svg } = $.ui.resolve(e)
      const source = spriteSvg(kindOf(type), pose, palette)
      if (Svg && spend(art, source.length + alt.length)) return Svg({ source, alt, width: 44, height: 40, isInteractive: true })
    }
  }
  const { Text } = $.ui.resolve(e)
  return Text({ color: palette.b!, children: ['●'] })
}

function header($: any, e: any, r: Roster) {
  const { Box, Text } = $.ui.resolve(e)
  return Box({
    flexDirection: 'row',
    children: [Text({ bold: true, children: ['◆ crew'] }), Text({ dimColor: true, children: [' · ' + headerFacts(counts(r))] })],
  })
}

// Three round cards, or one dim line when three would not fit.
function statCards($: any, e: any, list: { label: string; value: string }[], width: number) {
  const { Box, Text } = $.ui.resolve(e)
  if (width < 36) return Text({ dimColor: true, children: [truncate(cardsLine(list), width)] })
  const card = (c: { label: string; value: string }) =>
    Box({
      key: 'card:' + c.label.toLowerCase(),
      borderStyle: 'round',
      borderColor: 'subtle',
      flexDirection: 'column',
      paddingX: 1,
      flexGrow: 1,
      children: [
        Text({ dimColor: true, children: [c.label] }),
        Text({ bold: true, ...(c.label === 'Cost' ? { color: ACCENT } : {}), children: [c.value] }),
      ],
    })
  return Box({ flexDirection: 'row', gap: 1, marginTop: 1, children: list.map(card) })
}

// Mascot on the left; description and status, meta, context bar and stats on the right.
function agentCard($: any, e: any, a: AgentRow, view: View) {
  const { Box, Text } = $.ui.resolve(e)
  const pose = poseOf(a)
  const glyph = glyphOf(a.status, frame)
  const art = settings.mascot === 'on' ? SPRITE_COLUMNS : 1
  const width = Math.max(10, view.width - art - 1)
  const pct = (100 * a.context) / contextWindow(a.model, view.window, view.mainModel)
  const gauge = bar(pct, Math.max(6, view.width - art - 12))
  const lit = a.status === 'running' ? ACCENT : 'subtle'
  return Box({
    key: 'agent:' + a.id,
    flexDirection: 'row',
    marginTop: 1,
    children: [
      mascot($, e, a.id, a.type, pose, `${truncate(a.description || a.type, 80)} — ${pose}`, view.art),
      Box({
        flexDirection: 'column',
        marginLeft: 1,
        flexGrow: 1,
        children: [
          Box({
            flexDirection: 'row',
            children: [
              Text({ bold: true, children: [truncate(a.description || a.type, width - 2)] }),
              Box({ flexGrow: 1 }),
              Text({ color: glyph.color, children: [glyph.char] }),
            ],
          }),
          Text({ dimColor: true, children: [metaLine(a, width)] }),
          Box({
            flexDirection: 'row',
            children: [
              gauge.filled !== '' && Text({ color: lit, children: [gauge.filled] }),
              gauge.track !== '' && Text({ color: 'subtle', children: [gauge.track] }),
              Text({ dimColor: true, children: [' ' + ctxLabel(pct)] }),
            ],
          }),
          Text({ dimColor: true, children: [truncate(statsLine(a, view.now, estimate(a, overrides)), width)] }),
        ],
      }),
    ],
  })
}

function runningSection($: any, e: any, agents: AgentRow[], view: View) {
  const { Box, Text } = $.ui.resolve(e)
  const more = agents.length > RUNNING_CAP ? [Text({ dimColor: true, children: [`… ${agents.length - RUNNING_CAP} more running`] })] : []
  return [
    Box({ marginTop: 1, children: [Text({ dimColor: true, bold: true, children: [`RUNNING · ${agents.length}`] })] }),
    ...agents.slice(0, RUNNING_CAP).map((a) => agentCard($, e, a, view)),
    ...more,
  ]
}

function finishedRow($: any, e: any, a: AgentRow, width: number) {
  const { Box, Text } = $.ui.resolve(e)
  const glyph = glyphOf(a.status, 0)
  const right = truncate(finishedRight(a, estimate(a, overrides)), Math.max(0, width - 12))
  return Box({
    key: 'done:' + a.id,
    flexDirection: 'row',
    children: [
      Text({ color: glyph.color, children: [glyph.char] }),
      Text({ children: [' ' + truncate(a.description || a.type, width - right.length - 4)] }),
      Box({ flexGrow: 1 }),
      Text({ dimColor: true, children: [' ' + right] }),
    ],
  })
}

function finishedSection($: any, e: any, done: AgentRow[], width: number) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const head = Box({
    flexDirection: 'row',
    marginTop: 1,
    children: [
      Text({ dimColor: true, bold: true, children: [`FINISHED · ${done.length}`] }),
      Box({ flexGrow: 1 }),
      Button({
        key: 'collapse',
        plain: true,
        hotkey: collapsed ? 'e' : 'c',
        label: collapsed ? 'Expand' : 'Collapse',
        onPress: () => toggleCollapsed($),
      }),
    ],
  })
  if (collapsed) return [head]
  const rows = done.slice(0, FINISHED_CAP).map((a) => finishedRow($, e, a, width))
  const more = done.length > FINISHED_CAP ? [Text({ dimColor: true, children: [`… ${done.length - FINISHED_CAP} more`] })] : []
  return [head, ...rows, ...more]
}

// Never a blank pane: an idle mascot and what will happen.
function emptyState($: any, e: any, art: { left: number }) {
  const { Box, Text } = $.ui.resolve(e)
  return Box({
    flexDirection: 'row',
    marginTop: 1,
    children: [
      mascot($, e, 'idle', 'general-purpose', 'idle', 'crew mascot, waiting', art),
      Box({
        flexDirection: 'column',
        justifyContent: 'center',
        marginLeft: 1,
        flexShrink: 1,
        children: [Text({ dimColor: true, children: [EMPTY_TEXT] })],
      }),
    ],
  })
}

async function sessionUsage($: any): Promise<any> {
  try {
    return await $.session.usage()
  } catch {
    return null
  }
}

async function sessionModel($: any): Promise<string> {
  try {
    return (await $.session.model()) ?? ''
  } catch {
    return ''
  }
}

async function drawPane($: any, e: any) {
  const { Box } = $.ui.resolve(e)
  const r = await read($, rosterAtom)
  const now = await $.clock.now()
  const usage = await sessionUsage($)
  const mainModel = await sessionModel($)
  const width = Math.max(20, e.props?.bodyColumns ?? 60)
  const view: View = { width, now, mainModel, window: usage?.context?.window ?? 200_000, art: { left: ART_BUDGET } }
  const sum = totals(r, overrides, mainModel)
  const startedAt = typeof usage?.startedAt === 'number' ? usage.startedAt : now
  const values = cards({ realUsd: usage?.cost?.usd ?? null, estUsd: sum.estUsd, tokens: sum.tokens, sessionMs: now - startedAt })
  const running = live(r, now)
  const done = finished(r, now)
  ensureTicker($, now)
  return Box({
    flexDirection: 'column',
    children: [
      header($, e, r),
      statCards($, e, values, width),
      ...(r.agents.length === 0 ? [emptyState($, e, view.art)] : []),
      ...(running.length > 0 ? runningSection($, e, running, view) : []),
      ...(done.length > 0 ? finishedSection($, e, done, width) : []),
    ],
  })
}

// ── the band ───────────────────────────────────────────────────────────────────────────

// One line while anything is live: a dot per agent, the facts, and o: Open. Whatever the
// mods after this one draw stays beneath it.
async function drawBand($: any, e: any, next: any) {
  if (settings.band === 'off' || e.props?.hasSurvey) return next(e)
  const r = await read($, rosterAtom)
  const now = await $.clock.now()
  const agents = live(r, now)
  if (agents.length === 0) return next(e)
  ensureTicker($, now)
  const { Box, Text, Button } = $.ui.resolve(e)
  const dots = agents.slice(0, BAND_DOTS).map((a) =>
    Text({ color: paletteFor(a.type, poseOf(a)).b!, children: [a.status === 'running' && frame % 2 === 1 ? '◉' : '●'] }),
  )
  const room = (e.props?.bodyColumns ?? 80) - 7 - dots.length - 10
  const row = Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: ['◆ crew '] }),
      ...dots,
      Text({ dimColor: true, children: [' ' + truncate(bandFacts(r, now, overrides), room) + '  '] }),
      Button({ key: 'band-open', plain: true, hotkey: 'o', label: 'Open', onPress: () => openPane($) }),
    ],
  })
  return Box({ flexDirection: 'column', children: [row, await next(e)] })
}

// ── wiring ─────────────────────────────────────────────────────────────────────────────

export function register(on: any, options: any) {
  settings = { ...settings, ...options }
  overrides = parsePrices(String(settings.prices ?? ''))

  on('session.start', async ($: any, e: any, next: any) => {
    try {
      await $.command.register({ name: 'crew', description: 'Show or hide the subagent panel', immediate: true })
    } catch {}
    try {
      collapsed = (await $.store.get('collapsed')) === true
    } catch {}
    return next(e)
  }).catch(($: any, e: any, next: any) => next(e))

  // The spawn resolves once the agent has started, with the id its own events carry.
  // A refused spawn, or one without an id, adds nothing. The result passes untouched.
  // Its text comes from the model, a workflow script or another plugin: it is kept as one
  // clean line, since a surface refuses a whole tree whose text holds a control character.
  on('agent.spawn', async ($: any, e: any, next: any) => {
    const r = await next(e)
    if (r && !r.deny && r.agentId) {
      const at = await $.clock.now()
      const row = {
        id: r.agentId,
        description: oneLine(e.description ?? ''),
        type: oneLine(e.subagentType ?? '', 60) || 'general-purpose',
        model: oneLine(r.model ?? e.model ?? e.parentModel ?? '', 80),
        background: e.background === true,
        workflow: !!e.workflow,
        at,
      }
      await update($, rosterAtom, (x) => {
        const end = early.get(row.id)
        return end ? completed(spawned(x, row), row.id, end) : spawned(x, row)
      })
      early.delete(row.id)
      ensureTicker($, at)
      await autoOpen($)
    }
    return r
  }).catch(($: any, e: any, next: any) => next(e))

  on('tool.call', async ($: any, e: any, next: any) => {
    if (e.agentId) await update($, rosterAtom, (x) => toolUsed(x, e.agentId, oneLine(String(e.tool ?? ''), 60)))
    return next(e)
  }).catch(($: any, e: any, next: any) => next(e))

  // Tokens come from the steps alone; turn.complete repeats their sum, so it adds none.
  // No .catch here: a stream that breaks off fails this hook after its chunks went out,
  // and a catch's next(e) would replay them. Without one the engine passes the rest on;
  // the counting after the stream is wrapped so the hook never fails on its own.
  on('turn.step', async function* ($: any, e: any, next: any) {
    const r = yield* next(e)
    try {
      const at = await $.clock.now()
      await update($, rosterAtom, (x) => stepped(x, e.agentId, r?.usage, e.effort, at, e.turnId))
    } catch {
      // A step left uncounted; the response itself is untouched.
    }
    return r
  })

  on('turn.complete', async ($: any, e: any, next: any) => {
    if (e.agentId) {
      const at = await $.clock.now()
      const end: End = { at, reason: e.reason, isAborted: e.isAborted, turnId: e.turnId }
      await update($, rosterAtom, (x) => {
        if (!x.agents.some((a) => a.id === e.agentId)) keepEarly(e.agentId, end)
        return completed(x, e.agentId, end)
      })
      ensureTicker($, at) // the celebration needs frames
    }
    return next(e)
  }).catch(($: any, e: any, next: any) => next(e))

  // Hides the pane when it is shown; otherwise opens it (or seats one waiting undrawn). When
  // the pane list cannot be read, opening is the useful guess. A registered command has no
  // core beneath it, so a failure answers in words instead of passing on.
  on('command.run', { command: 'crew' }, async ($: any) => {
    if ((await paneIsShown($)) === true) await $.ui.close({ id: PANE })
    else await openPane($)
    return {}
  }).catch(($: any, e: any, next: any) => (next.called ? next(e) : { text: 'crew: could not show or hide the panel' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($: any, e: any) => drawPane($, e))

  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next: any) => drawBand($, e, next))
}

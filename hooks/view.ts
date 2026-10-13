// The text of every line crew draws. Pure, no mods API: register.ts only arranges these
// strings into elements.

import { formatClock, formatTokens, formatUsd, shortModel, totalTokens, type Price } from './pricing.ts'
import { counts, estimate, live, type AgentRow, type AgentStatus, type Roster } from './roster.ts'

/** crew's one accent, used only for what is live. */
export const ACCENT = '#9B7BEA'

/** The running dot's pulse, one step per animation frame. */
export const DOTS: readonly string[] = ['●', '◉', '○', '◉']

export const FINISHED_CAP = 50

export const EMPTY_TEXT = 'No subagents yet — they appear here when Claude delegates work.'

const SEP = ' · '

// C0 and C1 controls, DEL and the Unicode line and paragraph separators. A surface refuses a
// whole tree whose text holds a control character, so none is ever drawn.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g

// Marks, joiners and variation selectors take no cell of their own.
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\u200b-\u200f\ufe00-\ufe0f]$/u
// East Asian wide and fullwidth ranges: two cells each in a terminal.
const WIDE =
  /^[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]$/u
const PICTOGRAPH = /^\p{Extended_Pictographic}$/u

function cellsOf(ch: string): number {
  if (ZERO_WIDTH.test(ch)) return 0
  // Emoji past U+1F000 are wide; older symbols (©, ✓, ●) are one cell unless asked otherwise.
  if (ch.codePointAt(0)! >= 0x1f000 && PICTOGRAPH.test(ch)) return 2
  return WIDE.test(ch) ? 2 : 1
}

/** How many terminal cells `s` takes: two for wide characters and emoji, none for marks. */
export function widthOf(s: string): number {
  let w = 0
  for (const ch of s) w += cellsOf(ch)
  return w
}

/**
 * Cuts to `width` cells with a trailing `…`, never splitting a character. Control
 * characters become spaces, so whatever it returns is safe to draw.
 */
export function truncate(s: string, width: number): string {
  if (width <= 0) return ''
  const clean = s.replace(CONTROL, ' ')
  if (widthOf(clean) <= width) return clean
  let out = ''
  let w = 0
  for (const ch of clean) {
    const c = cellsOf(ch)
    if (w + c > width - 1) break
    out += ch
    w += c
  }
  return out + '…'
}

/**
 * Text from outside crew (a description, an agent type, a tool name) made fit to keep:
 * one line, runs of whitespace and control characters as one space, at most `max` cells.
 */
export function oneLine(s: string, max = 200): string {
  return truncate(String(s).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim(), max)
}

/** `1 running · 15 done · 2 failed`, zero parts left out; `idle` when all are zero. */
export function headerFacts(c: { running: number; done: number; failed: number; stopped?: number }): string {
  const parts: string[] = []
  if (c.running > 0) parts.push(`${c.running} running`)
  if (c.done > 0) parts.push(`${c.done} done`)
  if (c.failed > 0) parts.push(`${c.failed} failed`)
  if ((c.stopped ?? 0) > 0) parts.push(`${c.stopped} stopped`)
  return parts.length > 0 ? parts.join(SEP) : 'idle'
}

/** `Explore · haiku 4.5 · high · step 7 · Bash`: the model, effort and last tool when known. */
export function metaLine(a: AgentRow, width: number): string {
  const parts = [a.type]
  if (a.model !== '') parts.push(shortModel(a.model))
  if (a.effort) parts.push(a.effort)
  parts.push(a.steps > 0 ? `step ${a.steps}` : 'starting')
  if (a.lastTool) parts.push(a.lastTool)
  return truncate(parts.join(SEP), width)
}

const clamp = (p: number): number => (Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0)

/** A thin gauge: `━` for the filled part, `─` for the track. */
export function bar(percent: number, width: number): { filled: string; track: string } {
  const w = Math.max(0, Math.floor(width))
  const n = Math.round((clamp(percent) / 100) * w)
  return { filled: '━'.repeat(n), track: '─'.repeat(w - n) }
}

export function ctxLabel(percent: number): string {
  return `ctx ${Math.round(clamp(percent))}%`
}

const usdOrDash = (usd: number | null): string => (usd === null ? '—' : formatUsd(usd, true))
const elapsed = (a: AgentRow, now: number): string => formatClock((a.endedAt ?? now) - a.startedAt)

/** `209.0k tok · 3 tools · ≈$0.04 · 5:35`; the clock stops when the agent ends. */
export function statsLine(a: AgentRow, now: number, usd: number | null): string {
  const parts = [`${formatTokens(totalTokens(a.tokens))} tok`]
  if (a.tools > 0) parts.push(`${a.tools} ${a.tools === 1 ? 'tool' : 'tools'}`)
  parts.push(usdOrDash(usd), elapsed(a, now))
  return parts.join(SEP)
}

/** The right side of a Finished row: `haiku 4.5 · 52.0k · ≈$0.31 · 2:10`. */
export function finishedRight(a: AgentRow, usd: number | null): string {
  const parts = a.model !== '' ? [shortModel(a.model)] : []
  parts.push(formatTokens(totalTokens(a.tokens)), usdOrDash(usd), elapsed(a, a.endedAt ?? a.startedAt))
  return parts.join(SEP)
}

/** The three stat cards. Claude Code's real session cost wins; else crew's estimate, marked ≈. */
export function cards(input: { realUsd: number | null; estUsd: number | null; tokens: number; sessionMs: number }): { label: string; value: string }[] {
  const costValue = input.realUsd !== null ? formatUsd(input.realUsd, false) : input.estUsd !== null ? formatUsd(input.estUsd, true) : '—'
  return [
    { label: 'Cost', value: costValue },
    { label: 'Tokens', value: formatTokens(input.tokens) },
    { label: 'Time', value: formatClock(input.sessionMs) },
  ]
}

/** The cards on one line, for panes too narrow for three boxes. */
export function cardsLine(list: { label: string; value: string }[]): string {
  return list.map((c) => `${c.label} ${c.value}`).join(SEP)
}

/** The band: `2 running · 0:42 · ≈$0.18`, over the agents still in Running. */
export function bandFacts(r: Roster, now: number, overrides: Record<string, Price>): string {
  const agents = live(r, now)
  const parts = [headerFacts(counts({ ...r, agents }))]
  if (agents.length > 0) parts.push(formatClock(now - Math.min(...agents.map((a) => a.startedAt))))
  let usd: number | null = null
  for (const a of agents) {
    const e = estimate(a, overrides)
    if (e !== null) usd = (usd ?? 0) + e
  }
  if (usd !== null) parts.push(formatUsd(usd, true))
  return parts.join(SEP)
}

/** An agent's status glyph and its color: the accent while running, theme keys after. */
export function glyphOf(status: AgentStatus, frame: number): { char: string; color: string } {
  if (status === 'done') return { char: '✓', color: 'success' }
  if (status === 'failed') return { char: '✗', color: 'error' }
  if (status === 'stopped') return { char: '■', color: 'warning' }
  return { char: DOTS[frame % DOTS.length]!, color: ACCENT }
}

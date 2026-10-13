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

/** Cuts to `width` characters with a trailing `…`; counts code points, never splits one. */
export function truncate(s: string, width: number): string {
  if (width <= 0) return ''
  const chars = Array.from(s)
  if (chars.length <= width) return s
  return chars.slice(0, width - 1).join('') + '…'
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

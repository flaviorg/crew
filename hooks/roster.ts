// The subagents' lifecycle as immutable updates. Pure, no mods API.
//
// Every function takes a roster and returns a new one (or the same one when nothing
// changed), so register.ts can hand them straight to `update($, atom, fn)`. Rows are plain
// JSON: they live in $.state.

import {
  addTokens, contextOf, cost, fromUsage, priceFor, totalTokens, ZERO,
  type Price, type Tokens, type UsageLike,
} from './pricing.ts'
import type { Pose } from './sprites.ts'

export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

export type AgentRow = {
  id: string
  description: string
  type: string
  model: string
  effort?: string
  background: boolean
  workflow: boolean
  startedAt: number
  endedAt?: number
  /** The turn whose end ended it: a late result of that turn does not revive it. */
  endedTurn?: string
  /** When a step of it last finished: what an agent nothing else reports on is judged by. */
  seenAt?: number
  status: AgentStatus
  steps: number
  tools: number
  lastTool?: string
  tokens: Tokens
  context: number
}

export type Roster = { agents: AgentRow[]; main: Tokens; mainSteps: number }

/** A turn.step result's usage: token counts plus the model that answered. */
export type TurnUsageLike = UsageLike & { model?: string }

export type Spawn = {
  id: string
  description: string
  type: string
  model: string
  background: boolean
  workflow: boolean
  at: number
}

export const EMPTY: Roster = Object.freeze({ agents: Object.freeze([]) as unknown as AgentRow[], main: ZERO, mainSteps: 0 })

/** How long a finished agent stays in Running, in its done or failed pose. */
export const CELEBRATE_MS = 3_000

/** Rows kept per session; past this the oldest finished ones go. */
export const MAX_AGENTS = 500

/**
 * How long a running agent that `$.agent.list()` does not list may go unheard before it
 * counts as stopped: nothing else would ever end it (a workflow's remote agent, or a stalled
 * one retried under a new id), and the band and the clock would run for the session.
 */
export const QUIET_MS = 30 * 60_000

const endOf = (a: AgentRow): number => a.endedAt ?? a.startedAt

function patch(r: Roster, id: string, change: (a: AgentRow) => AgentRow): Roster {
  const i = r.agents.findIndex((a) => a.id === id)
  if (i < 0) return r
  const agents = r.agents.slice()
  agents[i] = change(r.agents[i]!)
  return { ...r, agents }
}

function capped(agents: AgentRow[]): AgentRow[] {
  let excess = agents.length - MAX_AGENTS
  if (excess <= 0) return agents
  // Rows are in spawn order, so the first finished ones are the oldest. Running rows stay.
  return agents.filter((a) => {
    if (excess > 0 && a.status !== 'running') {
      excess--
      return false
    }
    return true
  })
}

export function spawned(r: Roster, a: Spawn): Roster {
  if (r.agents.some((x) => x.id === a.id)) return r
  const row: AgentRow = {
    id: a.id,
    description: a.description,
    type: a.type,
    model: a.model,
    background: a.background,
    workflow: a.workflow,
    startedAt: a.at,
    status: 'running',
    steps: 0,
    tools: 0,
    tokens: { ...ZERO },
    context: 0,
  }
  return { ...r, agents: capped([...r.agents, row]) }
}

/**
 * One model request finished. Without an agent id it was the main loop's. A null usage
 * (no response arrived) still counts the step but adds no tokens.
 *
 * An ended agent that steps in a new turn is running again: a teammate runs one turn per
 * message it receives, and a message may resume a stopped or failed agent under the same
 * id. Its clock resumes where it stopped, so the time shown is time spent working. A late
 * result of the very turn that ended it changes its numbers but not its status.
 */
export function stepped(
  r: Roster,
  agentId: string | undefined,
  usage: TurnUsageLike | null | undefined,
  effort: string | number | undefined,
  at: number,
  turnId?: string,
): Roster {
  if (agentId === undefined) {
    return { ...r, main: usage ? addTokens(r.main, fromUsage(usage)) : r.main, mainSteps: r.mainSteps + 1 }
  }
  return patch(r, agentId, (a) => {
    let next: AgentRow = { ...a, steps: a.steps + 1, seenAt: at }
    if (usage) {
      next.tokens = addTokens(a.tokens, fromUsage(usage))
      next.context = contextOf(usage)
      if (typeof usage.model === 'string' && usage.model !== '') next.model = usage.model
    }
    if (effort !== undefined && String(effort) !== '') next.effort = String(effort)
    const sameTurn = turnId !== undefined && turnId === a.endedTurn
    if (a.status !== 'running' && !sameTurn) {
      const { endedAt: _ended, endedTurn: _turn, ...open } = next
      next = { ...open, status: 'running', startedAt: at - (endOf(a) - a.startedAt) }
    }
    return next
  })
}

export function toolUsed(r: Roster, agentId: string, tool: string): Roster {
  return patch(r, agentId, (a) => ({ ...a, tools: a.tools + 1, lastTool: tool }))
}

/**
 * The agent's turn ended. Its usage is not added: turn.complete repeats the sum of the
 * steps already counted.
 */
export function completed(
  r: Roster,
  agentId: string,
  e: { at: number; reason?: string; isAborted?: boolean; turnId?: string },
): Roster {
  const status: AgentStatus =
    e.isAborted === true || e.reason === 'aborted' ? 'stopped'
      : e.reason === 'error' || e.reason === 'refusal' ? 'failed'
        : 'done'
  return patch(r, agentId, (a) => ({ ...a, status, endedAt: e.at, ...(e.turnId === undefined ? {} : { endedTurn: e.turnId }) }))
}

/**
 * Applies `$.agent.list()`: it is the only place a failure or a kill shows up when no
 * turn.complete comes, and the only word on a teammate in a terminal pane of its own, which
 * runs no loop here (`idle` is its turn's end). An agent it does not list (workflow agents
 * never are) is left alone until it has gone QUIET_MS unheard; then it counts as stopped,
 * from when it was last heard. Returns the same roster when nothing changed.
 */
export function reconciled(r: Roster, list: ReadonlyArray<{ id: string; status: string }>, at: number): Roster {
  const byId = new Map(list.map((x) => [x.id, x.status]))
  let changed = false
  const agents = r.agents.map((a) => {
    const status = byId.get(a.id)
    let next: AgentStatus | null = null
    let end = a.endedAt ?? at
    if (status === 'failed' && (a.status === 'running' || a.status === 'done')) next = 'failed'
    if (status === 'killed' && (a.status === 'running' || a.status === 'done')) next = 'stopped'
    if ((status === 'completed' || status === 'idle') && a.status === 'running') next = 'done'
    if (status === undefined && a.status === 'running' && at - (a.seenAt ?? a.startedAt) >= QUIET_MS) {
      next = 'stopped'
      end = a.seenAt ?? a.startedAt
    }
    if (next === null) return a
    changed = true
    return { ...a, status: next, endedAt: end }
  })
  return changed ? { ...r, agents } : r
}

/** Running, or finished less than CELEBRATE_MS ago; oldest first. */
export function live(r: Roster, now: number): AgentRow[] {
  return r.agents
    .filter((a) => a.status === 'running' || now - endOf(a) < CELEBRATE_MS)
    .sort((a, b) => a.startedAt - b.startedAt)
}

/** Finished at least CELEBRATE_MS ago; newest first. */
export function finished(r: Roster, now: number): AgentRow[] {
  return r.agents
    .filter((a) => a.status !== 'running' && now - endOf(a) >= CELEBRATE_MS)
    .sort((a, b) => endOf(b) - endOf(a))
}

export function anyLive(r: Roster, now: number): boolean {
  return r.agents.some((a) => a.status === 'running' || now - endOf(a) < CELEBRATE_MS)
}

/**
 * The run the live agents belong to: every agent since the band last appeared. An agent is
 * live from its spawn to CELEBRATE_MS after its end; the run is the unbroken stretch of
 * live time that reaches now, so one already filed under Finished still counts while the
 * others run. Empty when nothing is live.
 */
export function run(r: Roster, now: number): AgentRow[] {
  const shown = live(r, now)
  if (shown.length === 0) return []
  let start = Math.min(...shown.map((a) => a.startedAt))
  const ids = new Set(shown.map((a) => a.id))
  // Newest end first: each one still live when the run began joins it, and may move its
  // start earlier. The first that is not ends the search: every one after it ended sooner.
  const rest = r.agents.filter((a) => !ids.has(a.id)).sort((a, b) => endOf(b) - endOf(a))
  const joined: AgentRow[] = []
  for (const a of rest) {
    if (endOf(a) + CELEBRATE_MS <= start) break
    joined.push(a)
    start = Math.min(start, a.startedAt)
  }
  return [...joined, ...shown].sort((a, b) => a.startedAt - b.startedAt)
}

export function poseOf(a: AgentRow): Pose {
  if (a.status === 'running') return 'working'
  if (a.status === 'done') return 'done'
  return 'failed'
}

export function counts(r: Roster): { running: number; done: number; failed: number; stopped: number } {
  const c = { running: 0, done: 0, failed: 0, stopped: 0 }
  for (const a of r.agents) c[a.status]++
  return c
}

/** The agent's cost from its tokens and the price table; null when its model has no price. */
export function estimate(a: AgentRow, overrides: Record<string, Price>): number | null {
  const price = priceFor(a.model, overrides)
  return price ? cost(a.tokens, price) : null
}

/** All tokens the session reported, and their estimated cost (null when nothing had a price). */
export function totals(r: Roster, overrides: Record<string, Price>, mainModel: string): { tokens: number; estUsd: number | null } {
  let tokens = totalTokens(r.main)
  let estUsd: number | null = null
  const add = (usd: number | null) => {
    if (usd !== null) estUsd = (estUsd ?? 0) + usd
  }
  const mainPrice = priceFor(mainModel, overrides)
  add(mainPrice ? cost(r.main, mainPrice) : null)
  for (const a of r.agents) {
    tokens += totalTokens(a.tokens)
    add(estimate(a, overrides))
  }
  return { tokens, estUsd }
}

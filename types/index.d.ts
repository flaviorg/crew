// crew's state contract: the one value its drawings read from $.state.
// Same shapes as hooks/pricing.ts (Tokens) and hooks/roster.ts (AgentRow, Roster).

/** Token counts, summed over the model responses they came from. */
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

/** One subagent, from its spawn to its end. Times are ms epoch from $.clock.now(). */
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
  status: AgentStatus
  steps: number
  tools: number
  lastTool?: string
  tokens: Tokens
  context: number
}

/** Every subagent of the session, plus the main loop's own tokens and steps. */
export type Roster = { agents: AgentRow[]; main: Tokens; mainSteps: number }

declare module 'claude-code' {
  interface PluginState {
    crew: { roster: Roster }
  }
}

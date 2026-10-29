/** Bumped to redraw the band. */
export type Tick = number

declare module 'claude-code' {
  interface PluginState {
    'robo-bar': { tick: Tick; tldr: string | null }
  }
}

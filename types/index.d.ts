/** Bumped to redraw the band. */
export type Tick = number

declare module 'claude-code' {
  interface PluginState {
    'cache-heat': { tick: Tick }
  }
}

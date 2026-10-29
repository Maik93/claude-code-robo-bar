export type Ttl = '5m' | '1h'

declare module 'claude-code' {
  interface PluginState {
    'cache-heat': { tick: number }
  }
}

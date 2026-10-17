export type Queued = { text: string }

declare module 'claude-code' {
  interface PluginState {
    'cozy-bubbles': { queued: Queued[] }
  }
}

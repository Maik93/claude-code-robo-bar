import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ttl } from '../types'

// This session's cache state, kept in the mod's store so it survives restarts and resumes.
type Row = {
  at: number // last time the main loop talked to the model
  isBusy: boolean
}

const TTL_MS: Record<Ttl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
const KEEP_MS = 24 * 60 * 60_000

// Bumped on a timer and on every write, so the band redraws and its countdown moves.
const tick = atom({ plugin: 'cache-heat', key: 'tick' } as const, 0)

const rowKey = (id: string) => `s:${id}`
const shortTime = (ms: number) => {
  const m = Math.round(ms / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
}

async function save($: EngineInterface, patch: Partial<Row>) {
  const key = rowKey(await $.session.id())
  const old = ((await $.store.get(key)) ?? {}) as Partial<Row>
  const row: Row = { at: old.at ?? 0, isBusy: old.isBusy ?? false, ...patch }
  await $.store.set(key, row)
  await update($, tick, n => n + 1)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache-ttl',
      description: 'Set the prompt cache lifetime the band counts down from',
      argumentHint: '5m | 1h',
    })
    // Close the pane an earlier version of this mod opened.
    void $.ui.close({ id: 'cache-heat' })
    // Drop rows of sessions idle for over a day.
    const now = await $.clock.now()
    for (const key of await $.store.keys()) {
      if (!key.startsWith('s:')) continue
      const row = (await $.store.get(key)) as Row | undefined
      if (!row || now - row.at > KEEP_MS) await $.store.delete(key)
    }
    $.clock.every(15_000, () => void update($, tick, n => n + 1))

    return next(e)
  })

  on('command.run', { command: 'cache-ttl' }, async ($, e) => {
    const want = e.args.trim()
    if (want !== '5m' && want !== '1h') {
      const now = ((await $.store.get('ttl')) as Ttl | undefined) ?? '1h'
      return { text: `Cache lifetime is ${now}. Use /cache-ttl 5m or /cache-ttl 1h.` }
    }
    await $.store.set('ttl', want)
    await update($, tick, n => n + 1)
    return { text: `Cache lifetime set to ${want}.` }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await save($, { isBusy: true, at: await $.clock.now() })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const patch: Partial<Row> = { isBusy: false }
      // A turn that reached the model refreshed the cache; an interrupt or error before any request did not.
      if (e.usage) patch.at = await $.clock.now()
      await save($, patch)
    }
    return done
  })

  on('session.end', async ($, e, next) => {
    await save($, { isBusy: false })
    return next(e)
  })

  // One right-aligned line above the prompt with this session's cache state.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tick)
    const row = (await $.store.get(rowKey(await $.session.id()))) as Row | undefined
    if (e.props.hasSurvey || !row || row.at === 0 || row.isBusy) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const ttl = ((await $.store.get('ttl')) as Ttl | undefined) ?? '1h'
    const left = TTL_MS[ttl] - ((await $.clock.now()) - row.at)

    return (
      <Box justifyContent="flex-end">
        <Text dimColor>{left > 0 ? `hot · ${shortTime(left)} left` : 'cold'}</Text>
      </Box>
    )
  })
}

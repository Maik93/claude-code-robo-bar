import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ttl } from '../types'
import { HUE, INK, ROBO_SIZE, chipSvg, roboSvg } from './badge'
import type { Mode } from './badge'

// This session's cache state, kept in the mod's store so it survives restarts and resumes.
type Row = {
  at: number // last time a request read or wrote this chat's cache
  isBusy: boolean
  pings: number // hidden pings sent since the person's last message
  keepWarm: boolean // the person turned the hidden ping on with /keep-warm
}

const TTL_MS: Record<Ttl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
const KEEP_MS = 24 * 60 * 60_000
const TICK_MS = 15_000

// The hidden ping, off until /keep-warm turns it on for a session: this long before the cache expires, resend the chat's last request with a tiny question. The
// request reads the cached chat, which restarts the cache's clock; the reply is thrown away.
const PING_AT_MS = 2 * 60_000
const MAX_PINGS = 3
// Where a prompt from the person comes from: the prompt box, a remote client, the app.
const PERSON: readonly string[] = ['composer', 'bridge', 'sdk']
const PING_PROMPT = 'Keep-alive ping, not from the user. Reply with just "ok".'

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

async function readRow($: EngineInterface): Promise<Row> {
  const old = ((await $.store.get(rowKey(await $.session.id()))) ?? {}) as Partial<Row>
  return { at: old.at ?? 0, isBusy: old.isBusy ?? false, pings: old.pings ?? 0, keepWarm: old.keepWarm ?? false }
}

async function save($: EngineInterface, patch: Partial<Row>) {
  const row: Row = { ...(await readRow($)), ...patch }
  await $.store.set(rowKey(await $.session.id()), row)
  await update($, tick, n => n + 1)
}

async function readTtl($: EngineInterface): Promise<Ttl> {
  return ((await $.store.get('ttl')) as Ttl | undefined) ?? '1h'
}

let isPinging = false

/** Sends a hidden ping when keep-warm is on, the cache is about to expire, the session is idle and pings are left. */
async function maybePing($: EngineInterface) {
  if (isPinging) return
  const row = await readRow($)
  if (!row.keepWarm || row.at === 0 || row.isBusy || row.pings >= MAX_PINGS) return
  const left = TTL_MS[await readTtl($)] - ((await $.clock.now()) - row.at)
  if (left <= 0 || left > PING_AT_MS) return

  isPinging = true
  try {
    const r = await $.model.fork({ prompt: PING_PROMPT })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') return
    const read = r.usage.cache_read_input_tokens
    const wrote = r.usage.cache_creation_input_tokens
    // Only a request that found the chat in the cache restarts its clock.
    if (read > 0 && read >= wrote) {
      await save($, { at: await $.clock.now(), pings: row.pings + 1 })
      $.ui.toast(`Cache kept warm (ping ${row.pings + 1}/${MAX_PINGS})`)
    } else {
      $.ui.toast(`Cache ping missed the cache (read ${read}, wrote ${wrote} tokens); pings paused`)
      await save($, { pings: MAX_PINGS })
    }
  } catch (err) {
    $.ui.toast(`Cache ping failed: ${String(err)}`)
  } finally {
    isPinging = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache-ttl',
      description: 'Set the prompt cache lifetime the band counts down from',
      argumentHint: '5m | 1h',
    })
    await $.command.register({
      name: 'keep-warm',
      description: 'Keep this session\'s prompt cache warm with a hidden ping before it expires',
      argumentHint: 'on | off',
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
    $.clock.every(TICK_MS, () => {
      void update($, tick, n => n + 1)
      void maybePing($)
    })

    return next(e)
  })

  on('command.run', { command: 'cache-ttl' }, async ($, e) => {
    const want = e.args.trim()
    if (want !== '5m' && want !== '1h') {
      return { text: `Cache lifetime is ${await readTtl($)}. Use /cache-ttl 5m or /cache-ttl 1h.` }
    }
    await $.store.set('ttl', want)
    await update($, tick, n => n + 1)
    return { text: `Cache lifetime set to ${want}.` }
  })

  // With no argument, flips the setting.
  on('command.run', { command: 'keep-warm' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: 'Use /keep-warm, /keep-warm on or /keep-warm off.' }
    const keepWarm = arg === '' ? !(await readRow($)).keepWarm : arg === 'on'
    await save($, { keepWarm, pings: 0 })
    return {
      text: keepWarm
        ? `Keep-warm on for this session: up to ${MAX_PINGS} hidden pings in a row, 2 minutes before the cache expires.`
        : 'Keep-warm off for this session.',
    }
  })

  // A message from the person starts a fresh run of pings.
  on('prompt.submit', async ($, e, next) => {
    if (PERSON.includes(e.origin.kind)) await save($, { pings: 0 })
    return next(e)
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

  // One right-aligned badge above the prompt with this session's cache state.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tick)
    const row = await readRow($)
    if (e.props.hasSurvey || row.at === 0 || row.isBusy) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets a plain colored chip.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const left = TTL_MS[await readTtl($)] - ((await $.clock.now()) - row.at)
    const mode: Mode = left > 0 ? 'hot' : 'cold'
    const word = mode === 'hot' ? `${shortTime(left)} left` : 'COLD'

    if (!Svg) {
      return (
        <Box justifyContent="flex-end">
          <Text backgroundColor={HUE[mode]} color={INK} bold>{` ${word} `}</Text>
        </Box>
      )
    }

    const chip = chipSvg(word, mode)
    const alt = mode === 'hot' ? 'Robo, bobbing' : 'Robo, frozen'
    return (
      <Box justifyContent="flex-end" alignItems="center">
        <Svg key="robo" source={roboSvg(mode)} alt={alt} width={ROBO_SIZE} height={ROBO_SIZE} isInteractive />
        <Text> </Text>
        <Svg key="chip" source={chip.source} alt={word} width={chip.w} height={chip.h} />
      </Box>
    )
  })
}

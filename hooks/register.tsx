import type { Register, RenderInput } from 'claude-code'

// Палитра рамок — меняется в одну строку.
const CLAUDE_ACCENT = '#43D9C7' // рамка сообщений Claude
const USER_ACCENT = '#8A7FF0' // рамка твоих сообщений
const CLOUD_ACCENT = '#43D9C7' // рамка статус-бублика
const SERVICE_ACCENT = '#5A6472' // служебные бублики (Worked for…, Ran … shell)

// Иконки подписей (текстовые глифы, не эмодзи; у шестерёнки VS15 — текстовый стиль).
const ICON_CLAUDE = '✳'
const ICON_USER = '◆'
const ICON_CLIENT = '⚙︎'

// Цвета статусбара (как в statusline-context.py, в hex-эквивалентах xterm-256).
const GREEN = '#00ff00' // 46
const YELLOW = '#ffff00' // 226
const RED = '#ff0000' // 196
const BLUE = '#00afff' // 39
const ORANGE = '#ff8700' // 208

// Ширина бублика: по ширине терминала, но не шире 108 колонок — так читабельнее.
function bubbleWidth(e: RenderInput): number {
  const cols = e.viewport?.columns ?? 80
  return Math.max(24, Math.min(cols - 2, 108))
}

// Группировка числа пробелами-запятыми: 132509 -> 132,509
function groupThousands(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 89000 -> "1m 29s" ; 39000 -> "39s" (как формат движка)
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

// Текущее локальное время как HH:MM
function clockLabel(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// claude-opus-4-8 -> Opus 4.8 ; claude-sonnet-5-5 -> Sonnet 5.5
function prettyModel(id: string): string {
  const fam = ['opus', 'sonnet', 'haiku', 'fable'].find(f => id.toLowerCase().includes(f))
  const ver = id.match(/(\d+)[-.](\d+)/)
  const version = ver ? `${ver[1]}.${ver[2]}` : ''
  if (fam) {
    const name = fam[0].toUpperCase() + fam.slice(1)
    return version ? `${name} ${version}` : name
  }
  return id
}

function modelColor(id: string): string | undefined {
  const l = id.toLowerCase()
  if (l.includes('sonnet')) return YELLOW
  if (l.includes('haiku')) return BLUE
  if (l.includes('opus')) return ORANGE
  if (l.includes('fable')) return RED
  return undefined
}

function tokenColor(n: number): string {
  return n < 300_000 ? GREEN : n < 800_000 ? YELLOW : RED
}

function leftColor(left: number): string {
  return left > 50 ? GREEN : left > 15 ? YELLOW : RED
}

function resetsLabel(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export const register: Register = on => {
  // ── Скруглённая рамка вокруг сообщений Claude ───────────────────────────
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const text = e.props.text
    if (!text || !text.trim()) {
      return next(e)
    }

    const { Box, Text, Markdown } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" marginTop={1} width={bubbleWidth(e)}>
        {e.props.isFirstOfReply ? (
          <Text color={CLAUDE_ACCENT} bold>
            {` ${ICON_CLAUDE} Claude`}
          </Text>
        ) : null}
        <Box borderStyle="round" borderColor={CLAUDE_ACCENT} paddingX={1}>
          <Markdown text={text} />
        </Box>
      </Box>
    )
  })

  // ── Скруглённая рамка вокруг твоих сообщений ────────────────────────────
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.props.origin.kind !== 'composer') {
      return next(e)
    }
    const text = e.props.text
    if (!text || !text.trim()) {
      return next(e)
    }

    const { Box, Text, Markdown } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" marginTop={1} width={bubbleWidth(e)}>
        <Text color={USER_ACCENT} bold>
          {` ${ICON_USER} user`}
        </Text>
        <Box borderStyle="round" borderColor={USER_ACCENT} paddingX={1}>
          <Markdown text={text} />
        </Box>
      </Box>
    )
  })

  // ── «Worked for …» — в свой бублик (ширина как у сообщений) ──────────────
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const label = `${e.props.word} for ${fmtDuration(e.props.durationMs)} · done ${clockLabel()}`
    return (
      <Box flexDirection="column" marginTop={1} width={bubbleWidth(e)}>
        <Text color={SERVICE_ACCENT} bold>
          {` ${ICON_CLIENT} Client`}
        </Text>
        <Box borderStyle="round" borderColor={SERVICE_ACCENT} paddingX={1}>
          <Text color={SERVICE_ACCENT}>{label}</Text>
        </Box>
      </Box>
    )
  })

  // ── «Ran … shell command» (группа вызовов) — в свой бублик ──────────────
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const calls = e.props.calls || []
    const n = calls.length
    const tools = [...new Set(calls.map(c => c.tool))]
    const label =
      tools.length === 1
        ? `Ran ${n} ${tools[0]} call${n === 1 ? '' : 's'}`
        : `Ran ${n} tool calls (${tools.join(', ')})`
    return (
      <Box flexDirection="column" marginTop={1} width={bubbleWidth(e)}>
        <Text color={SERVICE_ACCENT} bold>
          {` ${ICON_CLIENT} Client`}
        </Text>
        <Box borderStyle="round" borderColor={SERVICE_ACCENT} paddingX={1}>
          <Text color={SERVICE_ACCENT}>{label}</Text>
        </Box>
      </Box>
    )
  })

  // ── Статус-бублик сверху справа: весь statusbar целиком ─────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)

    let modelId = ''
    let dir = ''
    let tokens = 0
    const windows: { label: string; color: string }[] = []
    let resets = ''

    try {
      modelId = (await $.session.model()) || ''
    } catch {
      modelId = ''
    }
    try {
      const cwd = await $.session.cwd()
      dir = cwd.replace(/\/+$/, '').split('/').pop() || '/'
    } catch {
      dir = ''
    }
    try {
      const usage = await $.session.usage()
      tokens = usage.context?.tokens ?? 0
      const short: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
      for (const kind of ['five_hour', 'seven_day']) {
        const rl = (usage.rateLimits || []).find(r => r.kind === kind)
        if (!rl) continue
        const left = Math.max(0, 100 - Math.round(rl.percentUsed))
        windows.push({ label: `${short[kind]} ${left}%`, color: leftColor(left) })
        if (kind === 'five_hour') resets = resetsLabel(rl.resetsAt)
      }
    } catch {
      // оставляем пустым
    }

    // Собираем строку статусбара сегментами (как " | " в statusline).
    const row: unknown[] = []
    const sep = (k: string) => row.push(<Text key={k}> | </Text>)

    if (modelId) {
      row.push(
        <Text key="model" color={modelColor(modelId)} bold>
          {prettyModel(modelId)}
        </Text>,
      )
    }
    if (dir) {
      sep('s1')
      row.push(<Text key="dir">{dir}</Text>)
    }
    if (tokens > 0) {
      sep('s2')
      row.push(
        <Text key="tok" color={tokenColor(tokens)}>
          {`Tokens Used: ${groupThousands(tokens)}`}
        </Text>,
      )
    }
    if (windows.length) {
      sep('s3')
      row.push(<Text key="ul">Usage Limit: </Text>)
      windows.forEach((w, i) => {
        if (i > 0) row.push(<Text key={`lsep${i}`}> · </Text>)
        row.push(
          <Text key={`lw${i}`} color={w.color}>
            {w.label}
          </Text>,
        )
      })
      row.push(<Text key="left"> left</Text>)
      if (resets) row.push(<Text key="rs">{` (resets ${resets})`}</Text>)
    }

    if (!row.length) {
      row.push(<Text key="idle">готов печатать</Text>)
    }

    return (
      <Box flexGrow={1} justifyContent="flex-end">
        <Box borderStyle="round" borderColor={CLOUD_ACCENT} paddingX={2} marginRight={1}>
          {row}
        </Box>
      </Box>
    )
  })
}

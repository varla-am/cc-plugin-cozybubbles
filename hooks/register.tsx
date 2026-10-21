import { atom, read, update } from 'claude-code'
import type { Hook, Register, RenderChildren, RenderInput } from 'claude-code'

import type { Queued } from '../types'

// Движок ($) так, как его получает хук ui.render
type Engine = Parameters<Hook<'ui.render'>>[0]

// Промпты, набранные пока идёт ход: ждут в очереди, рисуются бубликами над статус-баром.
const queued = atom({ plugin: 'cozy-bubbles', key: 'queued' } as const, [] as Queued[])

// Палитра рамок — меняется в одну строку.
const CLAUDE_ACCENT = '#43D9C7' // рамка сообщений Claude
const USER_ACCENT = '#8A7FF0' // рамка твоих сообщений
const CLOUD_ACCENT = '#43D9C7' // рамка статус-бублика
const SERVICE_ACCENT = '#5A6472' // служебные бублики (Worked for…, Ran … shell)
const CODE_BORDER = '#3A404B' // рамка блока кода
const CODE_BG = '#16181D' // фон блока кода: чуть темнее тёмного терминала
const IMAGE_ACCENT = '#F0A6CA' // [Image #N] в твоих сообщениях: нажал — открылась картинка

// Иконки подписей (текстовые глифы, не эмодзи; у шестерёнки VS15 — текстовый стиль).
const ICON_CLAUDE = '✳'
const ICON_USER = '◆'
const ICON_CLIENT = '⚙︎'
const ICON_QUEUED = '◇'

// Цвета статусбара (как в statusline-context.py, в hex-эквивалентах xterm-256).
const GREEN = '#00ff00' // 46
const YELLOW = '#ffff00' // 226
const RED = '#ff0000' // 196
const BLUE = '#00afff' // 39
const ORANGE = '#ff8700' // 208

// Ширина бублика: обычный текст переносится ~108 колонок (так читабельнее), но под
// широкий контент — таблицы и блоки кода — бублик растягивается вплоть до ширины
// терминала, чтобы ничего не ломало рамку. Ширину берём по самой широкой "жёсткой"
// строке (таблица/код), прозу не считаем — она и так переносится.
function bubbleWidth(e: RenderInput, text?: string): number {
  const cols = e.viewport?.columns ?? 80
  const maxW = Math.max(24, cols - 2)
  const prose = Math.min(108, maxW)
  if (!text) return prose
  let wide = 0
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      wide = Math.max(wide, line.length)
      continue
    }
    if (inFence || line.includes('|')) wide = Math.max(wide, line.length)
  }
  return Math.min(maxW, Math.max(prose, wide + 6))
}

// Ответ Claude, разрезанный на куски: обычный markdown и блоки кода ```lang … ```.
// Незакрытый блок (ответ ещё печатается) — тоже код, до конца текста.
type Segment = { kind: 'md'; text: string } | { kind: 'code'; lang: string; source: string }

function splitFences(text: string): Segment[] {
  const out: Segment[] = []
  let prose: string[] = []
  let code: string[] | null = null
  let fence = ''
  let lang = ''
  const flushProse = () => {
    if (prose.join('').trim()) out.push({ kind: 'md', text: prose.join('\n') })
    prose = []
  }
  for (const line of text.split('\n')) {
    if (code) {
      // Закрывает такой же забор, не короче открывающего
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)?.[1]
      if (close && close[0] === fence[0] && close.length >= fence.length) {
        out.push({ kind: 'code', lang, source: code.join('\n') })
        code = null
      } else {
        code.push(line)
      }
      continue
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/)
    if (open) {
      flushProse()
      fence = open[1] ?? '```'
      lang = open[2] ?? ''
      code = []
    } else {
      prose.push(line)
    }
  }
  if (code) out.push({ kind: 'code', lang, source: code.join('\n') })
  flushProse()
  return out
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
    const name = fam.charAt(0).toUpperCase() + fam.slice(1)
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

// Есть ли текст промпта где-то внутри строки сессии (строка или блоки — сравниваем по JSON,
// так кавычки и переносы экранированы одинаково с обеих сторон).
function mentions(content: unknown, text: string): boolean {
  const needle = JSON.stringify(text).slice(1, -1)
  return needle.length > 0 && JSON.stringify(content ?? '').includes(needle)
}

// Плейсхолдер вставленной картинки в твоём сообщении: [Image #57]
const IMAGE_REF = /\[Image #(\d+)\]/g

// Где лежит картинка #N: движок пишет её путь в историю как [Image: source: …/images/57.png].
// После /compact старые строки уходят в сводку — тогда ищем N.png в той же папке, что и любая другая.
async function imagePath($: Engine, n: string): Promise<string | undefined> {
  const history = JSON.stringify(await $.session.messages({ as: 'api' }))
  const paths = [...history.matchAll(/\[Image: source: ([^\]"]+?\.\w+)\]/g)].map(m => m[1] ?? '')
  const exact = paths.find(p => new RegExp(`[/\\\\]${n}\\.\\w+$`).test(p))
  if (exact) return exact
  // Только папка вставленных картинок (…/images/), не файл, перетащенный из другой программы
  const dir = paths.find(p => /[/\\]images[/\\][^/\\]+$/.test(p))?.replace(/[/\\][^/\\]+$/, '')
  return dir ? `${dir}/${n}.png` : undefined
}

// Открыть файл программой по умолчанию: Просмотр на macOS, xdg-open на Linux, start на Windows
async function openFile($: Engine, path: string): Promise<boolean> {
  const uname = await $.process.run(['uname']).catch(() => undefined)
  const argv = !uname
    ? ['cmd', '/c', 'start', '', path]
    : uname.stdout.startsWith('Darwin')
      ? ['open', path]
      : ['xdg-open', path]
  const r = await $.process.run(argv).catch(() => undefined)
  return r?.exitCode === 0
}

async function openImage($: Engine, n: string) {
  const path = await imagePath($, n)
  if (!path || !(await $.fs.exists(path))) {
    $.ui.toast(`Картинки #${n} уже нет: временные файлы стираются при перезагрузке`)
    return
  }
  if (!(await openFile($, path))) $.ui.toast(`Не удалось открыть ${path}`)
}

// Markdown, в котором строки с [Image #N] собраны из текста и кнопок: нажал — картинка открылась.
// Такие строки рисуются без markdown-разметки; обычно в них и нет ничего, кроме слов.
function markdownWithImages($: Engine, e: RenderInput, text: string, key: string) {
  const { Box, Text, Markdown, Button } = $.ui.resolve(e)
  const out: RenderChildren[] = []
  let prose: string[] = []
  const flush = () => {
    if (prose.join('').trim()) out.push(<Markdown key={`${key}-${out.length}`} text={prose.join('\n')} />)
    prose = []
  }
  for (const line of text.split('\n')) {
    if (!line.match(IMAGE_REF)) {
      prose.push(line)
      continue
    }
    flush()
    const parts: RenderChildren[] = []
    let at = 0
    for (const m of line.matchAll(IMAGE_REF)) {
      const n = m[1] ?? ''
      const before = line.slice(at, m.index)
      if (before) parts.push(<Text key={`t${parts.length}`}>{before}</Text>)
      parts.push(
        <Button key={`img${parts.length}`} plain label={m[0]} onPress={() => openImage($, n)}>
          <Text color={IMAGE_ACCENT} bold>
            {m[0]}
          </Text>
        </Button>,
      )
      at = (m.index ?? 0) + m[0].length
    }
    if (at < line.length) parts.push(<Text key={`t${parts.length}`}>{line.slice(at)}</Text>)
    out.push(
      <Box key={`${key}-${out.length}`} flexDirection="row" flexWrap="wrap">
        {parts}
      </Box>,
    )
  }
  flush()
  return out
}

// Текст сообщения: markdown, а блоки кода ```lang … ``` — своим бубликом с кнопкой Copy.
// Общий для сообщений Claude и твоих; в твоих [Image #N] ещё и нажимаются.
function fencedBody($: Engine, e: RenderInput, text: string, width: number, images = false) {
  const { Box, Text, Markdown, Code, Button } = $.ui.resolve(e)

  // Блок кода — свой бублик внутри бублика, как в Claude Desktop:
  // фон потемнее, сверху язык и кнопка «Copy».
  // Линия под шапкой блока — от рамки до рамки: бублик минус рамка+отступы сообщения (4)
  // и рамка самого блока (2). Отдельной нижней границы у Box нет, поэтому рисуем символами.
  const rule = '─'.repeat(Math.max(0, width - 6))

  return splitFences(text).map((s, i) =>
    s.kind === 'md' ? (
      images ? (
        <Box key={`md${i}`} flexDirection="column">
          {markdownWithImages($, e, s.text, `md${i}`)}
        </Box>
      ) : (
        <Markdown key={`md${i}`} text={s.text} />
      )
    ) : (
      <Box
        key={`code${i}`}
        flexDirection="column"
        marginY={1}
        borderStyle="round"
        borderColor={CODE_BORDER}
        backgroundColor={CODE_BG}
      >
        <Box justifyContent="space-between" paddingX={1}>
          <Text dimColor>{s.lang || 'code'}</Text>
          <Button
            key={`copy${i}`}
            plain
            dimColor
            label="⧉ Copy"
            onPress={async press => {
              const r = await $.ui.copy({ text: s.source, surface: press.surface })
              $.ui.toast(r.isCopied ? 'Код скопирован' : 'Не удалось скопировать')
            }}
          />
        </Box>
        <Text color={CODE_BORDER} wrap="truncate-end">
          {rule}
        </Text>
        <Box paddingX={1}>
          <Code source={s.source || ' '} language={s.lang || undefined} />
        </Box>
      </Box>
    ),
  )
}

export const register: Register = on => {
  // ── Очередь: Enter посреди хода кладёт промпт в очередь ─────────────────
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const text = e.text.trim()
    if (e.origin.kind !== 'composer' || !text || text.startsWith('/')) return result
    if (e.turnId) {
      await update($, queued, q => [...(q ?? []), { text }])
    } else {
      // Промпт ушёл сразу — значит ничего не ждёт, чистим хвосты.
      await update($, queued, () => [])
    }
    return result
  }).catch(($, e, next) => next(e)) // сбой очереди не должен ни терять, ни дублировать промпт

  // Движок забрал промпт из очереди: в текущий ход (вложение queued_command)
  // или новым ходом (строка промпта) — убираем его бублик.
  on('session.append', async ($, e, next) => {
    const result = await next(e)
    const m = e.message
    const taken = e.door === 'prompt' || (m.type === 'attachment' && m.name === 'queued_command')
    if (taken && !e.agentId) {
      await update($, queued, q => {
        const list = q ?? []
        const i = list.findIndex(x => mentions(m.content, x.text))
        return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)]
      })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    const text = e.text.trim()
    if (!e.agentId && text) {
      await update($, queued, q => (q ?? []).filter(x => x.text !== text))
    }
    return result
  }).catch(($, e, next) => next(e))

  // Ход закончился: всё, что ждало, либо уже забрано, либо ↑ вернул обратно в поле ввода
  // (popAll — его не видно ни в одном событии). Чистим, чтобы не висели призраки.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await update($, queued, () => [])
    return result
  }).catch(($, e, next) => next(e))

  // ── Скруглённая рамка вокруг сообщений Claude ───────────────────────────
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const text = e.props.text
    if (!text || !text.trim()) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = bubbleWidth(e, text)
    const body = fencedBody($, e, text, width)

    return (
      <Box flexDirection="column" marginTop={1} width={width}>
        {e.props.isFirstOfReply ? (
          <Text color={CLAUDE_ACCENT} bold>
            {` ${ICON_CLAUDE} Claude`}
          </Text>
        ) : null}
        <Box flexDirection="column" borderStyle="round" borderColor={CLAUDE_ACCENT} paddingX={1}>
          {body}
        </Box>
      </Box>
    )
  })

  // ── Скруглённая рамка вокруг твоих сообщений ────────────────────────────
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer') {
      return next(e)
    }
    const text = e.props.text
    if (!text || !text.trim()) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    // Превью сообщения в очереди: его уже показывает бублик ◇ queued внизу, дубль прячем.
    // Когда движок заберёт сообщение, очередь опустеет и строка перерисуется бубликом.
    const waiting = (await read($, queued)) ?? []
    if (waiting.some(q => q.text === text.trim())) {
      return <Box />
    }

    const width = bubbleWidth(e, text)
    return (
      <Box flexDirection="column" marginTop={1} width={width}>
        <Text color={USER_ACCENT} bold>
          {` ${ICON_USER} user`}
        </Text>
        <Box flexDirection="column" borderStyle="round" borderColor={USER_ACCENT} paddingX={1}>
          {fencedBody($, e, text, width, true)}
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
    const row: RenderChildren[] = []
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

    // Очередь справа: по строке на сообщение, переносы схлопнуты, длинное обрезается «…».
    // Стопка растёт вверх: первое в очереди — внизу, у строки статуса; новые ложатся сверху.
    const waiting = (await read($, queued)) ?? []
    const queue = waiting
      .map((q, i) => (
        <Text key={`q${i}`} color={USER_ACCENT} wrap="truncate-end">
          {`${ICON_QUEUED} ${waiting.length > 1 ? `${i + 1}/${waiting.length}` : 'queued'} · ${q.text.replace(/\s*\n\s*/g, ' ⏎ ')}`}
        </Text>
      ))
      .reverse()

    // Статус-панель на всю ширину (одна строка, текст слева). Очередь — отдельный бублик
    // справа; оба прижаты к низу, поэтому вверх растёт только бублик очереди.
    return (
      <Box flexGrow={1} alignItems="flex-end" marginRight={1}>
        <Box flexGrow={1} flexShrink={0} borderStyle="round" borderColor={CLOUD_ACCENT} paddingX={2}>
          {row}
        </Box>
        {queue.length ? (
          <Box
            flexDirection="column"
            flexShrink={1}
            marginLeft={1}
            borderStyle="round"
            borderColor={USER_ACCENT}
            paddingX={1}
          >
            {queue}
          </Box>
        ) : null}
      </Box>
    )
  })
}

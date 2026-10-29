import { atom, read, update } from 'claude-code'
import type { Hook, Register, RenderChildren, RenderInput } from 'claude-code'

import type { Queued } from '../types'

// The engine ($) as a ui.render hook receives it
type Engine = Parameters<Hook<'ui.render'>>[0]

// Prompts typed while a turn is running: they wait in the queue, drawn as bubbles above the status bar.
const queued = atom({ plugin: 'cozy-bubbles', key: 'queued' } as const, [] as Queued[])

// Client bubbles that are unfolded (press the header to toggle): keys from detailKey().
const opened = atom({ plugin: 'cozy-bubbles', key: 'opened' } as const, [] as string[])

// Border palette: one line per colour.
const CLAUDE_ACCENT = '#43D9C7' // Claude's message border
const USER_ACCENT = '#8A7FF0' // your message border
const CLOUD_ACCENT = '#43D9C7' // status bubble border
const SERVICE_ACCENT = '#5A6472' // service bubbles (Worked for…, Ran … shell)
const CODE_BORDER = '#3A404B' // code block border
const CODE_BG = '#16181D' // code block background: a little darker than a dark terminal
const SHELL_ACCENT = '#E5B567' // `! command` you ran yourself and its output
const COMMAND_ACCENT = '#7FB4F0' // /slash commands and what they printed
const IMAGE_ACCENT = '#F0A6CA' // [Image #N] in your messages: press it to open the image

// Label icons (text glyphs, not emoji; the gear carries VS15 for text style).
const ICON_CLAUDE = '✳'
const ICON_USER = '◆'
const ICON_CLIENT = '⚙︎'
const ICON_QUEUED = '◇'

// Status bar colours (as in statusline-context.py, as hex equivalents of xterm-256).
const GREEN = '#00ff00' // 46
const YELLOW = '#ffff00' // 226
const RED = '#ff0000' // 196
const BLUE = '#00afff' // 39
const ORANGE = '#ff8700' // 208

// Bubble width: prose wraps at ~108 columns (easier to read), but for
// wide content (tables and code blocks) the bubble grows up to the width of
// the terminal, so nothing breaks the border. The width comes from the widest "rigid"
// line (table/code); prose doesn't count, it wraps anyway.
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

// A message cut into pieces: plain markdown and ```lang … ``` code blocks.
// An unclosed block (the reply is still streaming) is code too, up to the end of the text.
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
      // Closed by the same kind of fence, no shorter than the opening one
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

// Thousands separators: 132509 -> 132,509
function groupThousands(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 89000 -> "1m 29s" ; 39000 -> "39s" (the engine's format)
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

// The current local time as HH:MM
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

// Whether the prompt's text is somewhere in a session row (a string or blocks; compared as JSON,
// so quotes and newlines are escaped the same way on both sides).
function mentions(content: unknown, text: string): boolean {
  const needle = JSON.stringify(text).slice(1, -1)
  return needle.length > 0 && JSON.stringify(content ?? '').includes(needle)
}

// The placeholder of a pasted image in your message: [Image #57]
const IMAGE_REF = /\[Image #(\d+)\]/g

// Where image #N is: the engine records its path in the history as [Image: source: …/images/57.png].
// After /compact old rows go into the summary; then look for N.png in the same folder as any other.
async function imagePath($: Engine, n: string): Promise<string | undefined> {
  const history = JSON.stringify(await $.session.messages({ as: 'api' }))
  const paths = [...history.matchAll(/\[Image: source: ([^\]"]+?\.\w+)\]/g)].map(m => m[1] ?? '')
  const exact = paths.find(p => new RegExp(`[/\\\\]${n}\\.\\w+$`).test(p))
  if (exact) return exact
  // Only the pasted images folder (…/images/), not a file dragged in from another app
  const dir = paths.find(p => /[/\\]images[/\\][^/\\]+$/.test(p))?.replace(/[/\\][^/\\]+$/, '')
  return dir ? `${dir}/${n}.png` : undefined
}

// Open a file with the default app: Preview on macOS, xdg-open on Linux, start on Windows
async function openFile($: Engine, path: string): Promise<boolean> {
  // No uname at all is plain Windows; Git Bash and MSYS have one but answer MINGW…/MSYS…/CYGWIN…
  const system = (await $.process.run(['uname']).catch(() => undefined))?.stdout.trim() ?? ''
  const argv = system.startsWith('Darwin')
    ? ['open', path]
    : system.startsWith('Linux')
      ? ['xdg-open', path]
      : ['cmd', '/c', 'start', '', path]
  const r = await $.process.run(argv).catch(() => undefined)
  return r?.exitCode === 0
}

async function openImage($: Engine, n: string) {
  const path = await imagePath($, n)
  if (!path || !(await $.fs.exists(path))) {
    $.ui.toast(`Image #${n} is gone: temporary files are cleared on restart`)
    return
  }
  if (!(await openFile($, path))) $.ui.toast(`Couldn't open ${path}`)
}

// Markdown where lines with [Image #N] are built from text and buttons: press one to open the image.
// Such lines are drawn without markdown formatting; usually they hold nothing but words anyway.
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

// A message's text: markdown, with ```lang … ``` code blocks in a bubble of their own with a Copy button.
// Shared by Claude's messages and yours; in yours, [Image #N] can be pressed too.
function fencedBody($: Engine, e: RenderInput, text: string, width: number, images = false) {
  const { Box, Text, Markdown, Code, Button } = $.ui.resolve(e)

  // A code block is a bubble inside the bubble, as in Claude Desktop:
  // a darker background, the language and a "Copy" button on top.
  // The rule under the block's header runs border to border: the bubble minus the message's border+padding (4)
  // and the block's own border (2). Box has no bottom-only border, so it's drawn with characters.
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
              $.ui.toast(r.isCopied ? 'Code copied' : "Couldn't copy")
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

// ── Client bubble details ────────────────────────────────────────────────

// Cut a long text to a few lines: the rest is replaced with "… N more lines"
function clip(text: string, maxLines: number, maxCols: number): string {
  const lines = text.replace(/\s+$/, '').split('\n')
  const cut = lines.slice(0, maxLines).map(l => (l.length > maxCols ? `${l.slice(0, maxCols - 1)}…` : l))
  if (lines.length > maxLines) cut.push(`… ${lines.length - maxLines} more lines`)
  return cut.join('\n')
}

// A tool's output as text: a string as is, {stdout, stderr} joined, anything else as JSON
function outputText(out: unknown): string {
  if (out == null) return ''
  if (typeof out === 'string') return out
  if (typeof out === 'object') {
    const o = out as Record<string, unknown>
    if (typeof o.stdout === 'string' || typeof o.stderr === 'string') {
      return [o.stdout, o.stderr].filter(x => typeof x === 'string' && x.trim()).join('\n')
    }
  }
  try {
    return JSON.stringify(out, null, 2) ?? ''
  } catch {
    return String(out)
  }
}

// What a call was asked to do, in one block: Bash shows the command, others their input
function inputText(tool: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  if (tool === 'Bash' && typeof o.command === 'string') return `$ ${o.command}`
  try {
    return JSON.stringify(input, null, 2) ?? ''
  } catch {
    return String(input)
  }
}

// ── Rows the terminal makes for `! shell` and /slash commands ──────────────

type LocalRow = { title: string; color: string; text: string; code: boolean }

// The engine stores these rows as tagged text: <bash-input>…</bash-input>, <bash-stdout>…, <command-name>…
function localRow(raw: string): LocalRow | undefined {
  const tag = (name: string) => raw.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim()
  const bashIn = tag('bash-input')
  if (bashIn !== undefined) return { title: '! shell', color: SHELL_ACCENT, text: `$ ${bashIn}`, code: true }
  const out = tag('bash-stdout')
  const err = tag('bash-stderr')
  if (out !== undefined || err !== undefined) {
    return { title: '! output', color: SHELL_ACCENT, text: [out, err].filter(Boolean).join('\n') || '(no output)', code: true }
  }
  const name = tag('command-name')
  if (name !== undefined) {
    const args = tag('command-args')
    return { title: '/ command', color: COMMAND_ACCENT, text: args ? `${name} ${args}` : name, code: true }
  }
  const stdout = tag('local-command-stdout')
  if (stdout !== undefined) return { title: '/ output', color: COMMAND_ACCENT, text: stdout || '(no output)', code: false }
  return undefined
}

function localBubble($: Engine, e: RenderInput, row: LocalRow, errored = false) {
  const { Box, Text, Markdown } = $.ui.resolve(e)
  const color = errored ? RED : row.color
  return (
    <Box flexDirection="column" marginTop={1} width={bubbleWidth(e, row.text)}>
      <Text color={color} bold>
        {` ${row.title}`}
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
        {row.code ? <Text>{clip(row.text, 20, bubbleWidth(e, row.text) - 4)}</Text> : <Markdown text={row.text} />}
      </Box>
    </Box>
  )
}

// A Client bubble: a header you can press to unfold the details under the label
function clientBubble(
  $: Engine,
  e: RenderInput,
  key: string,
  isOpen: boolean,
  label: string,
  details: RenderChildren[],
) {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" marginTop={1} width={bubbleWidth(e)}>
      <Button
        plain
        label={`Client ${isOpen ? 'hide' : 'show'} details`}
        onPress={() =>
          update($, opened, o => {
            const list = o ?? []
            return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
          })
        }
      >
        <Text color={SERVICE_ACCENT} bold>
          {` ${ICON_CLIENT} Client ${isOpen ? '▾' : '▸'}`}
        </Text>
      </Button>
      <Box flexDirection="column" borderStyle="round" borderColor={SERVICE_ACCENT} paddingX={1}>
        <Text color={SERVICE_ACCENT}>{label}</Text>
        {isOpen ? details : null}
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  // ── Queue: Enter in the middle of a turn queues the prompt ─────────────────
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const text = e.text.trim()
    if (e.origin.kind !== 'composer' || !text || text.startsWith('/')) return result
    if (e.turnId) {
      await update($, queued, q => [...(q ?? []), { text }])
    } else {
      // The prompt went straight through, so nothing is waiting: clear leftovers.
      await update($, queued, () => [])
    }
    return result
  }).catch(($, e, next) => next(e)) // a queue failure must neither lose nor duplicate the prompt

  // The engine took a prompt from the queue: into the current turn (a queued_command attachment)
  // or as a new turn (a prompt row): remove its bubble.
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

  // The turn is over: everything that waited was either taken, or ↑ put it back into the input
  // (popAll, which no event shows). Clear it so no ghosts are left hanging.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await update($, queued, () => [])
    return result
  }).catch(($, e, next) => next(e))

  // ── A rounded border around Claude's messages ───────────────────────────
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

  // ── A rounded border around your messages ───────────────────────────────
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // `! command`, /slash commands and their output: bubbles of their own
    const local = localRow(e.props.text ?? '')
    if (local) return localBubble($, e, local)
    if (e.props.origin.kind !== 'composer') {
      return next(e)
    }
    const text = e.props.text
    if (!text || !text.trim()) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    // A queued message's preview: the ◇ queued bubble below already shows it, so hide the duplicate.
    // Once the engine takes the message, the queue empties and the row redraws as a bubble.
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

  // ── What a /slash command printed ───────────────────────────────────────
  on('ui.render', { component: 'CommandOutput' }, ($, e, next) => {
    const text = (e.props.text ?? '').trim()
    if (!text) return next(e)
    const row = localRow(text) ?? { title: `/ ${e.props.command}`, color: COMMAND_ACCENT, text, code: false }
    return localBubble($, e, row, e.props.isErrored)
  })

  // ── "Worked for …" in a bubble of its own; press the header for the details ─
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const { Text } = $.ui.resolve(e)
    const key = `t:${e.props.word}:${e.props.durationMs}`
    const isOpen = ((await read($, opened)) ?? []).includes(key)
    const label = `${e.props.word} for ${fmtDuration(e.props.durationMs)} · done ${clockLabel()}`

    const details: RenderChildren[] = []
    if (isOpen) {
      const row = (k: string, name: string, value: string) =>
        details.push(
          <Text key={k} dimColor>
            {`${name.padEnd(9)}${value}`}
          </Text>,
        )
      row('d', 'duration', `${fmtDuration(e.props.durationMs)} (${Math.round(e.props.durationMs)} ms)`)
      try {
        const model = (await $.session.model()) || ''
        if (model) row('m', 'model', `${prettyModel(model)} (${model})`)
      } catch {}
      try {
        const usage = await $.session.usage()
        const tokens = usage.context?.tokens ?? 0
        if (tokens > 0) row('t', 'context', `${groupThousands(tokens)} tokens now`)
        for (const rl of usage.rateLimits || []) {
          const at = resetsLabel(rl.resetsAt)
          row(`r${rl.kind}`, rl.kind === 'five_hour' ? '5h limit' : rl.kind === 'seven_day' ? '7d limit' : rl.kind, `${Math.round(rl.percentUsed)}% used${at ? `, resets ${at}` : ''}`)
        }
      } catch {}
      try {
        const cwd = await $.session.cwd()
        if (cwd) row('c', 'dir', cwd)
      } catch {}
    }
    return clientBubble($, e, key, isOpen, label, details)
  })

  // ── "Ran … shell command" (a group of calls) in a bubble of its own; press the header for each call ─
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const calls = e.props.calls || []
    const n = calls.length
    const tools = [...new Set(calls.map(c => c.tool))]
    const label =
      tools.length === 1
        ? `Ran ${n} ${tools[0]} call${n === 1 ? '' : 's'}`
        : `Ran ${n} tool calls (${tools.join(', ')})`
    const first = calls[0]
    const key = `g:${first?.tool_use_id ?? `${tools.join('+')}:${inputText(first?.tool ?? '', first?.input).slice(0, 60)}`}`
    const isOpen = ((await read($, opened)) ?? []).includes(key)

    const inner = bubbleWidth(e) - 4
    const details: RenderChildren[] = isOpen
      ? calls.map((c, i) => {
          const state = c.isRunning ? 'running…' : c.isInterrupted ? 'interrupted' : c.isErrored ? 'failed' : 'ok'
          const out = outputText(c.output)
          return (
            <Box key={`call${i}`} flexDirection="column" marginTop={1}>
              <Text bold color={c.isErrored ? RED : undefined}>
                {`${c.tool} · ${state}`}
              </Text>
              <Text>{clip(inputText(c.tool, c.input), 8, inner)}</Text>
              {out.trim() ? <Text dimColor>{clip(out, 12, inner)}</Text> : null}
            </Box>
          )
        })
      : []
    return clientBubble($, e, key, isOpen, label, details)
  })

  // ── The status bubble: the whole status bar ─────────────────────────────
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
      // left empty
    }

    // Build the status bar line from segments (like " | " in the statusline).
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
      row.push(<Text key="idle">ready to type</Text>)
    }

    // The queue on the right: a line per message, newlines collapsed, long ones cut with "…".
    // The stack grows upward: the first in the queue is at the bottom, by the status line; new ones go on top.
    const waiting = (await read($, queued)) ?? []
    const queue = waiting
      .map((q, i) => (
        <Text key={`q${i}`} color={USER_ACCENT} wrap="truncate-end">
          {`${ICON_QUEUED} ${waiting.length > 1 ? `${i + 1}/${waiting.length}` : 'queued'} · ${q.text.replace(/\s*\n\s*/g, ' ⏎ ')}`}
        </Text>
      ))
      .reverse()

    // The status panel spans the full width (one line, text on the left). The queue is a separate bubble
    // on the right; both sit at the bottom, so only the queue bubble grows upward.
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

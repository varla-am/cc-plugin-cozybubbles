# cozy-bubbles

Мод интерфейса Claude Code в терминале: скруглённые рамки-«бублики» вокруг сообщений
и полноцветный статус-бар в отдельном бублике сверху справа.

![surface: terminal](https://img.shields.io/badge/surface-terminal-43D9C7)

## Что делает

- **Сообщения в бубликах.** Ответы Claude и твои сообщения оборачиваются в скруглённую
  рамку (`borderStyle: round`) с подписью и иконкой: `✳ Claude` (бирюзовый) и `◆ user`
  (фиолетовый). Текст рендерится через `Markdown`, с ровными отступами.
- **Служебные бублики.** `Worked for …` (`TurnDuration`) и `Ran … calls` (`ToolGroup`)
  уезжают в свой серый бублик `⚙ Client`.
- **Статус-бар в бублике.** Сверху справа (`AbovePrompt`) — модель, рабочая папка,
  `Tokens Used` и лимиты `5h`/`7d` с процентом «осталось» и временем сброса. Цвета как
  у классического statusline: Opus — оранжевый, Sonnet — жёлтый, Haiku — синий,
  Fable — красный; токены зелёный/жёлтый/красный по порогам 300k/800k; лимиты
  зелёный > 50 % / жёлтый > 15 % / красный. Идентификатор модели `claude-opus-4-8`
  показывается как `Opus 4.8`.

Всё рисуется через `ui.render`-хуки и читает данные сессии (`$.session.model()`,
`$.session.cwd()`, `$.session.usage()`). Наружу ничего не отправляется.

## Установка

В терминальной сессии Claude Code:

```
/plugin install cozy-bubbles --marketplace varla-am/cc-plugin-cozybubbles
```

Дальше: `y`, чтобы добавить marketplace, затем выбери scope (по умолчанию — user).

Из шелла:

```
claude plugin install cozy-bubbles --marketplace varla-am/cc-plugin-cozybubbles
```

## Настройка

Палитра задаётся константами в начале `hooks/register.tsx` (`CLAUDE_ACCENT`,
`USER_ACCENT`, `CLOUD_ACCENT`, `SERVICE_ACCENT`) и иконками (`ICON_CLAUDE`,
`ICON_USER`, `ICON_CLIENT`). Пороги цветов токенов/лимитов — в функциях
`tokenColor` и `leftColor`.

## Лицензия

MIT

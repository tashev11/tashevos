<p align="center">
  <img src="./docs/assets/tashevos-hero.svg" alt="TashevOS — один проект, любой ИИ, без потери контекста" width="100%" />
</p>

<p align="center">
  <a href="./README.md">English</a> · <b>Русский</b>
</p>

# TashevOS

**Один проект. Любой AI. Никакой потерянной памяти.**

TashevOS — открытый local-first control plane для разработки с несколькими AI-кодерами. Он нужен для того, чтобы Claude Code, Codex, Cursor, Gemini и другие агенты работали с одним состоянием проекта, не перечитывали репозиторий с нуля, не повторяли уже проваленные подходы и не ломали работу друг друга.

> **Статус:** ранняя alpha-версия. Уже работают CLI, определение проекта и Git, поиск установленных AI-инструментов и известных источников истории, локальный event store, компактный context packet, doctor и безопасные repair-примитивы. Полный импорт сессий, MCP lifecycle, worktree-autopilot и verified auto-healing находятся в разработке.

## Зачем это нужно

Сегодня память разработки раздроблена между разными приложениями:

```text
Claude знает одно
Codex — другое
Cursor — третье
чат закрылся — часть контекста потерялась
репозиторий изменился — старая память уже опасна
```

TashevOS ставит в центр **сам проект**, а не конкретного AI-провайдера.

| Без TashevOS | С TashevOS |
|---|---|
| Каждый AI начинает со своего контекста | Единый слой непрерывности проекта |
| Репозиторий приходится перечитывать | Выбирается только нужный контекст |
| Решения остаются в старых чатах | Решения хранятся с происхождением |
| Ошибочные подходы повторяются | Failed approaches становятся памятью |
| Агент говорит «готово» | Истиной считаются Git, файлы, тесты и runtime |
| Параллельные AI могут конфликтовать | Планируются locks + worktree isolation |

## Быстрый запуск

<p align="center">
  <img src="./docs/assets/terminal-demo.svg" alt="TashevOS terminal demo" width="100%" />
</p>

```bash
git clone https://github.com/tashev11/tashevos.git
cd tashevos
npm install
npm run build
npm link

tash init /path/to/project
tash agents /path/to/project
tash doctor /path/to/project
tash context "продолжи задачу, которую делал предыдущий AI" --path /path/to/project
```

## Непрерывность между устройствами

TashevOS умеет сохранять **зашифрованную рабочую точку** в приватный Git-репозиторий. На другом доверенном устройстве можно восстановить тот же commit/ветку, staged и unstaged изменения, а также безопасные untracked-файлы. `.env*`, приватные ключи и файлы учётных данных исключаются до шифрования; сырые AI-сессии по-прежнему остаются только локально.

```bash
# один раз на устройстве
tash sync init --remote git@github.com:YOU/tashevos-state.git

# включить автоматические checkpoint для проекта
tash autosync add /path/to/project --task "продолжить интеграцию оплат"
tash autosync install --interval 300

# ручной checkpoint по-прежнему можно сделать в любой момент
tash checkpoint "продолжить интеграцию оплат"

# на другом клоне / устройстве
tash sync init --remote git@github.com:YOU/tashevos-state.git --key "<recovery-key>"
tash sync status
tash resume
```

Ключ восстановления генерируется локально и не отправляется в vault. Показать его для подключения другого доверенного устройства можно только явной командой `tash sync key`. Payload шифруется AES-256-GCM с ключом, полученным через scrypt.

**Autosync работает только по изменениям:** fingerprint учитывает Git HEAD, staged, unstaged и безопасные untracked-файлы. Если состояние не менялось — новый checkpoint не создаётся. Secret-like файлы не вызывают синхронизацию, а ручной checkpoint не дублируется следующим фоновым проходом. На macOS используется `launchd`, на Linux — пользовательский `systemd` timer; на других системах можно запускать `tash autosync tick` через любой планировщик.

## Что уже работает

- определение корня Git-проекта;
- определение технологического стека и package manager;
- детект Claude Code, Codex, Cursor, Gemini CLI, Copilot, Windsurf, Kiro, Cline, Roo, OpenCode, Continue, Qwen, Zed и Aider;
- обнаружение известных локальных хранилищ истории;
- локальный event store;
- managed-блоки в `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`;
- компактный evidence-first context packet;
- `tash doctor`;
- безопасный repair для TashevOS-owned файлов;
- local-first хранение приватных runtime-данных.

## Архитектура

<p align="center">
  <img src="./docs/assets/architecture.svg" alt="Архитектура TashevOS" width="100%" />
</p>

Ключевой принцип:

> **Git, текущие файлы, тесты и runtime сильнее, чем утверждение любого AI.**

TashevOS должен отвечать не просто «что запомнил агент», а:

> Что на самом деле происходит с проектом сейчас, что уже делали разные AI, что не сработало, какой минимальный контекст нужен следующему агенту и безопасно ли продолжать?

## Жизненный цикл задачи

<p align="center">
  <img src="./docs/assets/lifecycle.svg" alt="Жизненный цикл задачи TashevOS" width="100%" />
</p>

Целевая автоматизация:

```text
обнаружить окружение
→ сверить память с текущим кодом
→ подобрать минимальный контекст
→ выполнить задачу нужным агентом
→ проверить результат
→ сохранить успех или неудачный подход
→ передать следующему AI
```

## Команды

| Команда | Назначение |
|---|---|
| `tash init [path]` | Инициализация TashevOS |
| `tash status [path]` | Статус Git и памяти |
| `tash agents [path]` | Найти AI-инструменты и источники истории |
| `tash scan [path]` | Определить стек проекта |
| `tash context [task]` | Собрать компактный контекст |
| `tash doctor [path]` | Проверить здоровье интеграции |
| `tash doctor --fix` | Исправить безопасные проблемы TashevOS |
| `tash heal [path]` | Запустить текущий safe-heal |

## Память проекта

```text
.tashevos/
├── config.json
├── PROJECT.md
├── STATE.md
├── GUARDRAILS.md
├── memory/
│   ├── decisions.ndjson
│   └── failed-approaches.ndjson
├── local/       # не попадает в Git
├── cache/       # не попадает в Git
└── sessions/    # не попадает в Git
```

Raw-сессии и локальные события по умолчанию остаются на компьютере. В Git должна попадать только компактная и безопасная память проекта.

Подробнее: [docs/MEMORY_MODEL.md](docs/MEMORY_MODEL.md)

## Поддерживаемая экосистема

Архитектура рассчитана более чем на 30 AI-сред: Claude Code, OpenAI Codex, Cursor, Gemini CLI, GitHub Copilot, Windsurf, Kiro, Cline, Roo Code, OpenCode, Continue, Qwen Code, Zed, Aider, Junie, Amp, Goose, Devin, OpenHands, Replit Agent, Jules, Lovable, Bolt, v0 и другие.

При этом TashevOS честно разделяет:

- **FULL** — hooks/MCP/CLI + автоматический lifecycle;
- **NATIVE** — rules/instructions + ограниченный lifecycle;
- **BRIDGE** — Git/GitHub/handoff для закрытых платформ;
- **TARGET** — запланированный адаптер.

Матрица: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)

## Verified Auto-Healing

Главное правило:

> **Ответ AI «я всё исправил» не является проверкой.**

Целевой цикл:

```text
диагностика
→ классификация риска
→ checkpoint
→ исправление
→ тесты / build / runtime verification
→ принять или откатить
→ записать результат в память
```

Подробнее: [docs/AUTO_HEALING.md](docs/AUTO_HEALING.md)

## Roadmap

- **v0.2** — Universal Session Harvester
- **v0.3** — Trust Graph + Dead-End Firewall
- **v0.4** — MCP + lifecycle hooks
- **v0.5** — Multi-agent conflict protection + worktrees
- **v0.6** — Verified Auto-Healing
- **v0.7** — Token & Cost Governor
- **v1.0** — стабильный local-first daemon + 15+ полноценных адаптеров

Полностью: [ROADMAP.md](ROADMAP.md)

## Лицензирование

- **TashevOS Core:** AGPL-3.0-only
- **Adapter SDK:** Apache-2.0
- будущие Cloud / Team / Enterprise функции могут быть коммерческими.

## Участие в разработке

Проект специально развивается публично. Можно:

- открыть issue;
- взять `good first issue`;
- добавить detector/adapter нового AI;
- предложить улучшение memory model;
- помочь с benchmark экономии контекста.

Смотри [CONTRIBUTING.md](CONTRIBUTING.md), [ARCHITECTURE.md](ARCHITECTURE.md) и [SECURITY.md](SECURITY.md).

---

<p align="center">
  <b>TashevOS — один проект, любой AI, без потери контекста.</b>
</p>

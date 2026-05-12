# claude-usage-report

A Claude Code skill: give it a date range and it produces an Excel report of all your Claude Code sessions — what day, what project, what branch, how long, how many tokens, how much it cost, and a one-line Haiku summary of what you actually did.

**Claude Code only.** This skill reads JSONL logs under `~/.claude/projects/` and calls `claude -p`. It won't work on Cursor / Copilot / other agents.

---

## Install

### Option A — via `npx skills` (recommended)

```bash
npx skills add yinminqian/claude-usage-report -g
```

`-g` installs globally to `~/.claude/skills/`. Drop it for project-local install.

### Option B — manual zip drop

If you got a zip from someone (offline / restricted network), unzip into `~/.claude/skills/`:

```bash
unzip claude-usage-report.zip -d ~/.claude/skills/
chmod +x ~/.claude/skills/claude-usage-report/scripts/*.js
chmod +x ~/.claude/skills/claude-usage-report/scripts/*.py
```

### Dependencies

Required:
- `node` ≥ 18
- `python3` + `openpyxl`: `pip3 install --user openpyxl`
- `claude` CLI (you already have it if you're using Claude Code)

Recommended:
- `ccusage` for authoritative cost data: `npm i -g ccusage`. Without it, costs are estimated via a calibrated fallback rate (~$0.7/M tokens).

---

## How to trigger

Just say it in Claude Code:

- "帮我总结 4 月份我的 Claude Code 报告"
- "出 3 月的 Claude Code 使用报表"
- "我这个月在 Claude 里都做了什么"
- "summarize my Claude Code usage for last month"

Claude parses the date range, runs the pipeline, validates against ccusage, and tells you where the Excel ended up (Desktop by default).

---

## What it does

1. **Extract** — scans `~/.claude/projects/**/*.jsonl`, filters by your date range, dedupes events by `message.id`
2. **Per-day split** — if a session spans midnight, splits it into one row per day so 4/3 → 4/5 sessions don't leave 4/4 and 4/5 looking empty
3. **Summarize** — for each session-day, pipes the user messages to `claude -p --model claude-haiku-4-5` for a 30-char Chinese one-liner. Cached locally; retries on timeout (60s → 120s → 180s); failures are not cached
4. **Validate** — calls `npx ccusage daily` for the same window, prints token delta and percentage. Warns if > 10% off
5. **Build XLSX** — one big sheet, daily yellow banner rows + per-session rows, frozen header for scrolling

## Manual run

```bash
node ~/.claude/skills/claude-usage-report/scripts/run.js \
  --since 2026-04-01 --until 2026-05-01 \
  --out ~/Desktop/april.xlsx
```

Options:
- `--since YYYY-MM-DD` (inclusive)
- `--until YYYY-MM-DD` (exclusive)
- `--out PATH` (default: Desktop)
- `--concurrency N` (default: 6 parallel Haiku calls)

## What the output looks like

Console:

```
[1/3] Extracting sessions from ~/.claude/projects/ between 2026-04-01 and 2026-05-01 ...
  Found 179 sessions, 1925M tokens.
[2/4] Summarizing each session via Haiku (concurrency 6) ...
  progress: 179/179 (143 from cache, 0 continuation)
[3/4] Fetching ccusage ground-truth for the same period ...
[4/4] Building XLSX → ~/Desktop/april.xlsx

======== 校验 / Validation ========
脚本统计 (this report): 179 行（174 个 session 跨 21 天，多日 session 已按天拆分）· 1925.5M tokens
ccusage daily       : 2072.9M tokens · $1351.93
Token 差异          : -147.5M (-7.1%)
成本                : $1351.93

✓ 差异在 10% 以内，可视为对得上 ccusage。

========================================
📊 报表已生成: ~/Desktop/april.xlsx
========================================
```

Excel structure:

- Row 1: title (date range, total session count, tokens, cost)
- Row 2: header `Date / 星期 / Project / Branch / Duration / Tokens / Cost / Summary`
- For each active day: a yellow banner row, then chronological session rows beneath it
- Frozen at row 3 so the header stays visible while you scroll

## Cache

Summaries are cached at `~/.claude/skills/claude-usage-report/cache/{md5(date+firstTs+cwd+first3msgs)}.txt`. Re-running the same date range is fast — only new sessions hit Haiku.

- Delete one entry to re-summarize that session
- Delete the whole `cache/` directory to redo everything
- Failed summaries are **not** cached, so they auto-retry next run

## Privacy

The skill sends your user-message text to Haiku (via `claude -p`). If you've pasted secrets, API keys, or PATs into past sessions, **they will be sent to Anthropic for summarization** (same security boundary as your normal Claude Code use, but worth knowing). Recommendations:

- Skim `~/.claude/projects/` and scrub any committed secrets first
- Or add a redact step before `summarize` if your environment is sensitive (open `scripts/run.js`, modify `buildPrompt`)

## Known caveats

- **Cross-day sessions:** A session opened late at night and continuing past midnight produces TWO rows (one per date), each with that date's portion of tokens. This is by design — fixes the bug where a 4/3 session running into 4/5 used to make 4/4 and 4/5 look empty.
- **Continuation days:** A date with only agent/tool background activity (no new user messages) gets a placeholder summary `(同会话延续：当日由 agent/tool 后台产生，无新用户消息)` instead of calling Haiku.
- **`12h+` duration cap:** Sanity guard for `spawn_agents` events that fire long after the user closed the session. Real per-day active time never exceeds 24h.
- **Token delta vs ccusage:** Usually within ±10%. Bigger gaps mean event-type identification differs between this script and ccusage; doesn't affect relative proportions.
- **Cost column** is scaled from ccusage's total via token share. The number for any single row is approximate; the per-day and per-period totals match ccusage exactly when available.

## License

[MIT](./LICENSE)

---
name: claude-usage-report
version: 0.1.0
description: Claude Code only. Generate a styled Excel report of Claude Code usage by session for a given month or date range. Reads JSONL session logs from ~/.claude/projects/ on the local machine, dedupes events by message.id, summarizes each session via Haiku (`claude -p`), validates totals against ccusage, splits cross-day sessions into per-day rows, and outputs an XLSX to the Desktop. Use this when the user asks for a Claude Code usage report — phrases like "帮我总结X月份我的claude code和本机项目的报告", "总结我X月份的Claude Code使用", "出X月Claude Code报表", "我这个月在Claude里做了什么", "summarize my Claude Code usage for [period]". Not for one-off cost lookups (use ccusage directly).
---

# claude-usage-report

Produces an Excel report of the user's Claude Code activity, grouped by day, with one row per session: Date | 星期 | Project | Branch | Duration | Tokens | Cost | Haiku-generated summary.

## When to invoke

User asks to **summarize their Claude Code usage** over a period — typically a month, a date range, or "last N days". Sample triggers:
- "帮我总结 4 月份我的 claude code 报告"
- "出一下我 3 月的 claude code 使用报表"
- "我这个月在 Claude 里都做了什么"
- "summarize my Claude Code usage for April"

Do NOT invoke for:
- Quick cost lookups → use `ccusage` directly
- Per-project / per-task analysis without a date scope → ask user for a date range first

## Workflow

### Step 1 — Determine the date range

Parse from the user request. Resolve relative dates against the current date.

- "4 月份" / "April" → first-of-month to last-of-month
- "上个月" / "last month" → previous calendar month
- "这周" / "this week" → Monday to today (or Sunday convention)
- Custom range → use as-is

Always express as ISO dates: `--since YYYY-MM-DD --until YYYY-MM-DD` (since inclusive, until exclusive).

### Step 2 — Run the pipeline

Call the orchestrator script with the date range and a sensible output path:

```bash
node ~/.claude/skills/claude-usage-report/scripts/run.js \
  --since 2026-04-01 --until 2026-05-01 \
  --out ~/Desktop/claude-usage-2026-04.xlsx
```

The script does four things internally and prints progress:

1. **extract** — scan `~/.claude/projects/**/*.jsonl`, filter by timestamp, dedupe by `message.id`, group by session
2. **summarize** — for each session not already in cache, send its user messages to `claude -p --model claude-haiku-4-5` and write the one-line summary to `~/.claude/skills/claude-usage-report/cache/{sessionKey}.txt`
3. **ccusage validation** — call `npx ccusage daily --json` for the same date range and compare token totals; warn the user if they differ by more than 10%
4. **build-xlsx** — invoke `scripts/build-xlsx.py` to write the styled Excel

The script prints to stdout, in order:
- Progress for each step
- A "校验 / Validation" block comparing script totals vs ccusage totals (Token delta in M and %)
- A final highlighted block with the **report file path** (Desktop xlsx) — this is the most important thing to relay to the user

Concurrency for summarization is 6 by default. ~150–200 sessions per month finishes in ~3–10 minutes depending on Haiku latency.

### Step 3 — Report back

When the script finishes, tell the user (in this order, terse):

1. **报表位置** — the Desktop xlsx path (paste verbatim from the final highlighted block; this is what the user wants most)
2. **总账** — total sessions, total tokens (M), total cost ($), active days
3. **与 ccusage 的差异** — quote the validation block exactly: script tokens, ccusage tokens, delta and percentage. If delta > 10%, flag clearly.
4. **Top 3 高消费日** with the heaviest session summary each — optional, only if it fits

Keep under 10 lines unless the user asks for more detail.

## Prerequisites (check before running)

- `node` >= 18
- `python3` with `openpyxl` (`pip3 install openpyxl` or `pip3 install --user openpyxl`)
- `claude` CLI on PATH and authenticated (this is implicitly true since we are running inside Claude Code)

If `openpyxl` is missing, run `pip3 install --user openpyxl` and continue — do not ask the user unless install fails.

## Notes / gotchas

- **Cost is scaled from token-share against ccusage's daily total**, not computed from API pricing. If `ccusage` is installed, the script will call `ccusage daily --since … --until … --json` to get the authoritative total. If not, costs use a fallback rate constant and will be approximate.
- **Cross-day sessions are split into per-day rows.** A session started on 4/3 and ended on 4/5 produces THREE rows (one per date), each with that day's actual tokens and user messages. This is essential — it stops 4/4 and 4/5 from appearing empty just because the session opened on 4/3.
- **Continuation days** (a date that has tokens but no new user messages — usually agent/tool background activity from the previous day) get a placeholder summary `(同会话延续：当日由 agent/tool 后台产生，无新用户消息)` instead of a Haiku call.
- **Sessions / rows distinction:** "session count" in validation output refers to unique `.jsonl` files; "rows" refers to (session, date) pairs. Rows ≥ sessions.
- **Duration > 12h is capped to `12h+`** as a sanity guard, though after the per-day split this is rare (one day can't exceed 24h naturally).
- **The cache at `~/.claude/skills/claude-usage-report/cache/`** is keyed by `md5(date + firstTs + cwd + first 3 user messages)` — date in the key so per-day splits don't collide. Safe to delete to force re-summarization.
- **Project paths** are stripped to readable labels (`~/Code/<project>` → `<project>`, external-volume paths prefixed with `[ExtVol]`). Set `CLAUDE_REPORT_STRIP_PREFIX=<dir>` env var to also strip an extra subdirectory under `~/Code/`.

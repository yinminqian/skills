# Changelog

All notable changes to `claude-usage-report` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-05-12

Initial release.

### Features

- Scans `~/.claude/projects/**/*.jsonl` for a given date range
- Dedupes events by `message.id` (avoids fork/resume double-counting)
- Per-session Haiku summary via `claude -p --model claude-haiku-4-5` with local cache
- Auto retry with growing timeouts (60s → 120s → 180s); failed summaries are not cached
- Cross-day sessions are split into per-day rows so multi-day sessions don't make adjacent days look empty
- Continuation days (no new user messages, only agent/tool background activity) get a placeholder instead of a Haiku call
- ccusage validation: compares script's token total against `npx ccusage daily` for the same window, warns if delta > 10%
- Styled XLSX output with daily yellow banner rows and frozen header
- Configurable extra path-strip prefix via `CLAUDE_REPORT_STRIP_PREFIX` env var
- Configurable fallback cost rate via `CLAUDE_REPORT_USD_PER_M` env var

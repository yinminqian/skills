# Changelog

All notable changes to `claude-usage-report` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] — 2026-05-12

### Fixed

- **Subagent activity was not counted.** The extractor only scanned the top-level `~/.claude/projects/<slug>/*.jsonl` files and missed nested `<slug>/<session>/subagents/agent-*.jsonl` files. As a result, days whose work happened entirely inside spawned agents looked empty, and token totals ran ~7% below ccusage. Extractor now walks the project tree recursively. Verified no double-counting (every subagent file has its own distinct `message.id` set), and post-fix April totals agree with `npx ccusage daily` to within 0.1%.
- **`sessionFile` collision risk.** Switched to path-relative-to-root (sans `.jsonl`) so a subagent file under a session subdirectory can no longer collide with its parent's id.
- **Per-day token threshold lowered to 0.** Previously dropped any per-day bucket under 50K tokens; that hid short interactive sessions and small subagent runs. Now any day with measured tokens is included, matching ccusage's behavior.

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

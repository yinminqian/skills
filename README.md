# yinminqian's Claude Code skills

> **Claude Code only.** These skills are built specifically for [Claude Code](https://code.claude.com/) and rely on its local JSONL session logs (`~/.claude/projects/`) and its `claude -p` CLI. They will **not** work on Cursor, GitHub Copilot, Windsurf, Gemini CLI, or any other agent. Do not install if you're not using Claude Code.

A collection of skills I built for myself and my team. Each subdirectory is one skill with its own `SKILL.md`.

## Skills in this repo

| Skill | What it does |
|---|---|
| [`claude-usage-report`](./claude-usage-report/) | Generate a styled Excel report of your Claude Code usage by session for a date range — reads local JSONL, summarizes via Haiku, validates against ccusage, outputs to Desktop. |

## Install (Claude Code users only)

### Option A — via `npx skills`

```bash
# install everything
npx skills add yinminqian/skills -g -a claude-code

# or pick a specific skill
npx skills add yinminqian/skills --skill claude-usage-report -g -a claude-code
```

`-g` installs globally to `~/.claude/skills/`. `-a claude-code` makes sure only the Claude Code target is touched.

### Option B — manual clone

```bash
git clone https://github.com/yinminqian/skills.git ~/.claude/skills-yinminqian
# then for each skill you want:
ln -s ~/.claude/skills-yinminqian/claude-usage-report ~/.claude/skills/
```

## Trigger

After install, just talk to Claude Code naturally — e.g. "出 4 月的 Claude Code 使用报表". The skill's `description` field includes trigger phrases that Claude recognizes automatically.

## License

[MIT](./LICENSE)

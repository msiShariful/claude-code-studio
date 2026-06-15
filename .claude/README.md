# `.claude/` — Claude Code configuration

Project-level Claude Code setup, committed to git and shared by all contributors. **None of this
ships to npm** — `cc-studio` publishes only `dist/` + `web-dist/`.

- **`settings.json`** — permissions (allowed dev commands; secrets denied to Read), `statusLine`,
  the commit-guard hook, and `includeCoAuthoredBy: false`.
- **`statusline.mjs`** — renders `cc-studio v<version> · ⎇ <branch> · <model>`.
- **`hooks/guard-commit.mjs`** — PreToolUse(Bash) hook that blocks any commit carrying AI
  attribution (`Co-Authored-By: Claude`, "Generated with Claude", 🤖).
- **`commands/`** — slash commands: `/release`, `/ship`, `/check`, `/test`, `/review`, `/commit`,
  `/preview`, `/changelog`.
- **`agents/`** — subagents: `code-reviewer`, `test-runner`.

Project conventions and architecture live in the root `CLAUDE.md` (and per-package `CLAUDE.md`).
Personal, machine-specific overrides go in `settings.local.json` / `CLAUDE.local.md`, which are
gitignored.

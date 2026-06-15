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
- **`agents/`** — subagents: `code-reviewer` (keeps `memory: project`), `test-runner`.
- **`rules/`** — auto-loaded guidance. `commit-policy.md` loads every session; `testing.md` is
  `paths`-scoped so it loads only when a test file is open.
- **`skills/`** — richer, reusable workflows with supporting files. `add-web-section/` documents
  the exact steps to add a UI section.
- **`output-styles/`** — `studio-concise.md`, an opt-in terse response style (enable via `/config`
  or the `outputStyle` setting).
- **`workflows/`** — `.js` multi-agent orchestration scripts. `review-changes.js` fans out a
  multi-dimension review of the working diff; run it with `/review-changes`.
- **`agent-memory/<name>/`** — persistent memory for subagents that declare `memory: project`
  (shared via git). Auto-managed by the subagent.

Project conventions and architecture live in the root `CLAUDE.md` (and per-package `CLAUDE.md`).
Personal, machine-specific overrides go in `settings.local.json` / `CLAUDE.local.md`, which are
gitignored.

---
description: Review the current diff against this project's conventions
---

Review the working changes like a senior reviewer for this repo.

- Diff: !`git diff HEAD`

Check against the project's conventions:
- TDD — new behavior is covered by tests that follow the repo's patterns.
- ESM — relative imports end in `.js`; Vitest globals imported explicitly.
- Structure — small focused files; web views reuse `components/ui` and derive sections from `nav.ts`.
- TypeScript strict — no stray `any`; inputs validated at route/core boundaries.
- Commit hygiene — Conventional Commits, correct scope, and NO Co-Authored-By / Claude / AI mention.
- Leak check — nothing secret is read or printed; `.claude/` and `CLAUDE.md` stay GitHub-only.

Report findings grouped Critical / Should-fix / Nit, each with `file:line` and a concrete fix.
Don't edit unless I ask. For a deeper pass, you may hand off to the `code-reviewer` subagent.

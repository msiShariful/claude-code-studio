---
name: add-web-section
description: Add a new section/view to the web app (packages/web) — wiring nav, routing, the view, styles, and tests the way this repo does it. Use when adding a page to the Claude Code Studio UI.
argument-hint: [section key e.g. snapshots]
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Add a web section

Studio's UI is a two-axis shell (workspace switcher + section nav) driven by a single source of
truth. To add a section (call its key `$1`), follow `@checklist.md` in order.

Key files:
- `packages/web/src/nav.ts` — the single source of truth for sections (label, info tooltip, scope).
- `packages/web/src/shell/Shell.tsx` — `renderSection()` maps a section key → a view component.
- `packages/web/src/views/` — one component per section, each rendering a `PageHeader` from
  `components/ui` with an `info` tooltip.
- `packages/web/src/api.ts` — typed `Api` client + DTOs (add a method here if you need a new endpoint).
- `packages/web/src/styles.css` — design tokens + component styles.
- `packages/web/tests/` — jsdom + React Testing Library tests.

Work TDD (write the view's test first). If the data doesn't exist yet, add the server route and
core function — each with its own test — before the view. Finish with
`npm run typecheck && npm test && npm run build` all green, then commit `feat(web): …` (no AI
attribution).

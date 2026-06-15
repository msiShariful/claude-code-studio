---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/tests/**"
---

# Testing rules

Loads on-demand when you open a test file.

- **TDD**: add or update the test first, watch it fail, then implement.
- Vitest 4. Globals are OFF — import `describe`/`it`/`expect`/`vi` explicitly.
- **Web** component tests: `// @vitest-environment jsdom` docblock; React Testing Library; an
  explicit `cleanup()` and `vi.unstubAllGlobals()` in `afterEach`; stub `fetch`; reset
  `window.history` and `localStorage` between tests; scope nav queries with
  `within(screen.getByRole('navigation', { name: 'Sections' }))`.
- **Server** tests: `helpers.ts#fixture()` (temp HOME + real `buildServer`), inject a fake
  `CliRunner`, assert via `app.inject(...)`.
- **Core** tests: real temp dirs via `tests/fixtures.ts`; fake `CliRunner` for CLI paths.
- Never weaken an assertion just to make it pass — fix the cause. Run `npm test` before committing.

# code-reviewer memory

Durable notes this subagent keeps about reviewing Claude Code Studio. The subagent appends to and
reorganizes this file over time; the first ~200 lines load when it starts. Keep one fact per line
and split detail into topic files (e.g. `patterns.md`) as it grows.

## Recurring issues to watch
- ESM: relative imports must end in `.js` (even for `.ts`/`.tsx`); a missing extension is a common miss.
- Web tests sometimes omit the explicit `cleanup()` / `vi.unstubAllGlobals()` in `afterEach`.
- Section labels added without an `info` tooltip in `nav.ts`, or a view missing its `PageHeader`.

## Hard rules (never relax)
- Commit messages must never carry `Co-Authored-By` or any Claude/AI mention.
- Nothing npm-only or `.claude/`-only may leak into the published `cc-studio` tarball.

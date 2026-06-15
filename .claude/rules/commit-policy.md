# Commit & attribution policy

Absolute rules for this repository (always in effect):

- Commit as the user with a plain `git commit`. The author is the user only.
- **NEVER** add a `Co-Authored-By` trailer.
- **NEVER** mention Claude, AI, "Generated with", or a 🤖 anywhere in a commit message.
- Use Conventional Commits with a package scope: `feat(web):`, `fix(core):`, `chore:`,
  `test(server):`, `docs:`, `style(web):`. Imperative subject; short body for the *why* if it
  isn't obvious.
- Commit after each small, verified step. Don't bundle unrelated changes.
- The `includeCoAuthoredBy: false` setting and the `guard-commit.mjs` PreToolUse hook enforce the
  no-attribution rule — a violating commit is blocked.

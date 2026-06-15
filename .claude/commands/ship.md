---
description: Verify, commit the current changes with a clean conventional message, and push
argument-hint: [optional commit subject]
---

Ship the current work.

- Changes: !`git status --short`
- Diff stat: !`git diff --stat HEAD`

Steps:
1. Run `npm run typecheck && npm test`. If either fails, stop and report — do not commit.
2. Stage the relevant changes (`git add -A`, or selectively if they're unrelated — ask if unsure).
3. Commit with a Conventional Commits message (scope = the package touched, imperative subject,
   short body if the why isn't obvious). Use `$ARGUMENTS` as the subject if provided. Plain
   `git commit` — no Co-Authored-By, no mention of Claude or AI.
4. `git push`.

Report the commit hash and a one-line summary of what shipped.

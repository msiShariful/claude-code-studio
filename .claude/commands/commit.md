---
description: Stage and craft a single Conventional Commit for the current changes (no push)
argument-hint: [optional subject]
---

Create one well-scoped commit.

- Changes: !`git status --short`

1. Review the diff and group it into a single coherent commit. If it's really two unrelated
   changes, tell me and suggest splitting.
2. Stage it, then commit with a Conventional Commits message — scope from the package touched,
   imperative subject, and a short body explaining the why if it isn't obvious. Use `$ARGUMENTS`
   as the subject if provided. Plain `git commit` only — never a Co-Authored-By or AI mention.

Do not push. Report the commit.

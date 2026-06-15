---
description: Run the test suite, optionally filtered by a name pattern
argument-hint: [name pattern]
---

Run the tests.

- If `$ARGUMENTS` is given, run `npx vitest run -t "$ARGUMENTS"` and report just those.
- Otherwise run `npm test`.

Summarize pass/fail counts. For any failure, show the assertion and the `file:line`, and say
whether the test or the code looks wrong — but don't change anything unless I ask.

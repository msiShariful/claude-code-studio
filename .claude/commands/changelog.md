---
description: Summarize commits since the last tag into release notes
---

- Last tag: !`git describe --tags --abbrev=0 2>/dev/null || echo "(none)"`
- Commits since: !`L=$(git describe --tags --abbrev=0 2>/dev/null); [ -n "$L" ] && git log "$L"..HEAD --oneline || git log --oneline -20`

Write user-facing release notes grouped **Highlights / Fixes / Under the hood**, in plain product
voice with no AI attribution. Output markdown I can paste straight into a GitHub release, and
include the `npx cc-studio@latest` install line.

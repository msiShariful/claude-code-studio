---
description: Cut and publish a cc-studio release — version bump, verify, publish, commit, push, tag, GitHub release
argument-hint: <version e.g. 0.3.1>
---

Release **cc-studio `$1`**.

Context (gathered now):
- Published version: !`npm view cc-studio version 2>/dev/null`
- Local version: !`node -e "console.log(require('./packages/server/package.json').version)"`
- npm user: !`npm whoami 2>/dev/null`
- Working tree: !`git status --short`
- Since last tag: !`L=$(git describe --tags --abbrev=0 2>/dev/null); [ -n "$L" ] && git log "$L"..HEAD --oneline || git log --oneline -10`

Do this carefully. Stop and report if any check fails. **Never** add a Co-Authored-By or AI
mention to the commit, and never print the npm token.

1. Refuse if `$1` is empty or not semver, if `$1` is not greater than the published version, or if
   the working tree has unrelated uncommitted changes.
2. `npm version $1 -w cc-studio --no-git-tag-version`
3. `npm run typecheck && npm test && npm run build` — all must pass.
4. `npm publish -w cc-studio` (this prompts; the user authenticates).
5. `git commit -aqm "chore: release cc-studio $1"` then `git push`.
6. `git tag -a v$1 -m "cc-studio $1"` then `git push origin v$1`.
7. `gh release create v$1 --verify-tag --title "v$1" --notes "<concise notes from the commits above>"`.
8. Confirm with `npm view cc-studio version` and report the release URL.

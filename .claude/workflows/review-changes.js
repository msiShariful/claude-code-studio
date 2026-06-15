export const meta = {
  name: 'review-changes',
  description:
    'Review the working-tree diff across correctness, tests, and conventions; report ranked findings',
  phases: [{ title: 'Review' }],
}

// Each dimension is reviewed by its own agent in parallel; agents read the diff themselves.
const DIMENSIONS = [
  { key: 'correctness', focus: 'bugs, broken edge cases, and incorrect logic' },
  { key: 'tests', focus: 'missing or weak test coverage for the changed behavior' },
  {
    key: 'conventions',
    focus:
      "repo conventions — ESM '.js' import specifiers, strict TypeScript, small focused files, " +
      'web reuse of components/ui and the nav.ts source of truth, validated inputs at route/core ' +
      'boundaries, and absolutely no Co-Authored-By / Claude / AI mention in commit messages',
  },
]

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['critical', 'should-fix', 'nit'] },
          file: { type: 'string' },
          line: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'issue', 'fix'],
      },
    },
  },
  required: ['findings'],
}

phase('Review')
const reviews = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(
      'You are reviewing the Claude Code Studio repo. Run `git diff HEAD` and `git status` to see ' +
        `the working-tree changes, then review ONLY those changes for: ${d.focus}. ` +
        'Return concrete findings, each with file, line, the issue, and a specific fix.',
      { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS },
    ),
  ),
)

const order = { critical: 0, 'should-fix': 1, nit: 2 }
const findings = reviews
  .filter(Boolean)
  .flatMap((r) => r.findings)
  .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))

return { count: findings.length, findings }

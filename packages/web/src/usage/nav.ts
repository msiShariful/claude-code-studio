// The Usage area's own navigation — independent of the config `nav.ts`. Each key
// is a URL segment under /usage/<key>.

export interface UsageSection {
  key: string
  label: string
  /** one-line description shown under the section title */
  blurb: string
}

export const USAGE_SECTIONS: readonly UsageSection[] = [
  { key: 'overview', label: 'Overview', blurb: 'Today, the live window, and where the money goes.' },
  { key: 'timeline', label: 'Timeline', blurb: 'Spend and tokens over days and months.' },
  { key: 'models', label: 'Models', blurb: 'Cost split across Opus, Sonnet, and Haiku.' },
  { key: 'projects', label: 'Projects', blurb: 'Which repositories cost the most.' },
  { key: 'sessions', label: 'Sessions', blurb: 'The priciest and most recent sessions.' },
  { key: 'windows', label: 'Windows', blurb: 'The 5-hour billing windows and burn rate.' },
  { key: 'prompts', label: 'Prompts', blurb: 'Recent prompts with their attributed cost.' },
]

export const DEFAULT_SECTION = 'overview'

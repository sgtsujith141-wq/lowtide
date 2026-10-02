/**
 * The starting SPACE templates (v2.1). Made once, when LOWTIDE first creates
 * its Templates folder; after that they're ordinary pages the owner (or an AI
 * client) can change, archive or add to. Markdown, so they read the same in
 * SPACE and over MCP.
 */
export const STARTING_TEMPLATES: readonly { title: string; markdown: string }[] = [
  {
    title: 'Project Overview',
    markdown: [
      '## What it is',
      'One or two sentences.',
      '## Why it matters',
      '- ',
      '## Scope',
      '- In:',
      '- Out:',
      '## Current state',
      'Where it stands today.',
      '## Links',
      '- ',
    ].join('\n'),
  },
  {
    title: 'Research Note',
    markdown: [
      '## Question',
      'What are we trying to find out?',
      '## Sources',
      '- ',
      '## Findings',
      '- ',
      '## So what',
      'What this changes, if anything.',
    ].join('\n'),
  },
  {
    title: 'Architecture Note',
    markdown: [
      '## Context',
      'What this part of the system does.',
      '## Design',
      '- Components:',
      '- Data:',
      '- Interfaces:',
      '## Trade-offs',
      '- ',
      '## Open questions',
      '- [ ] ',
    ].join('\n'),
  },
  {
    title: 'Decision Record',
    markdown: [
      '## Context',
      'What forced a decision.',
      '## Options',
      '- ',
      '## Decision',
      'What was chosen.',
      '## Consequences',
      '- ',
    ].join('\n'),
  },
  {
    title: 'Meeting / Session Note',
    markdown: [
      '## Goal',
      '',
      '## What happened',
      '- ',
      '## Decisions',
      '- ',
      '## Next',
      '- [ ] ',
    ].join('\n'),
  },
  {
    title: 'Build Plan',
    markdown: [
      '## Goal',
      'What will exist when this is done.',
      '## Steps',
      '- [ ] ',
      '## Risks',
      '- ',
      '## Done when',
      '- ',
    ].join('\n'),
  },
  {
    title: 'Hackathon Research',
    markdown: [
      '## Problem statement',
      '',
      '## Judging criteria',
      '- ',
      '## Ideas',
      '- ',
      '## Chosen approach',
      '',
      '## Prior work',
      '- ',
    ].join('\n'),
  },
];

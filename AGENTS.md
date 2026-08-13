<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working alongside another agent

This repository is worked on by more than one AI agent — Claude Code and Codex —
plus a human maintainer. Codex reads this file directly; Claude Code reaches it
through `CLAUDE.md`. Everything below applies to both. Keep additions outside the
`nextjs-agent-rules` block above, which `next dev` regenerates.

## Branches and merging

- **Never push to `main`. Never merge to `main`.** Only the human maintainer does,
  by hand. An agent that merges removes the one review step in this workflow.
- Work on a prefixed branch so authorship is obvious from `git branch`:
  `claude/<topic>` or `codex/<topic>`. One topic per branch.
- Before handing work back, rebase onto the latest `origin/main` and re-run the
  quality gate, so the maintainer's merge is a fast-forward and never a surprise.
- Leave the branch committed and clean. State plainly what is unfinished rather
  than leaving uncommitted files for the other agent to discover.

## Before every commit

- `npm run quality` — typecheck, lint, tests, production build. It must pass.
  Do not commit around a failure; either fix it or say it is failing and why.
- Never commit `.env.local`, `.cache/`, or anything under `data/` except
  `.gitkeep`. They hold credentials, warehouse paths, and real operational data.
- Only reformat lines you are actually changing. A whitespace or import-order
  sweep across a file the other agent is editing turns a clean merge into a
  conflict on every line.

## Measurement invariants

These are not style preferences. Each one exists because the dashboard previously
misled a reader in that exact way, and an audit against the real operational
snapshot found it. Re-check them before touching `lib/analysis/engine.ts`; if a
change requires breaking one, say so explicitly rather than quietly relaxing it.

- **One definition of health.** `healthFrom()` is the only place a health score is
  computed. The cockpit gauge and the benchmark table both call it, over the same
  `KPI_KEYS` basket, on the same cut-off. They previously disagreed by 13 points
  for the same warehouse.
- **A breach cannot be averaged away.** Any KPI outside its guardrail blocks the
  `controlled` status. Do not "smooth" this — a warehouse cancelling 43% of demand
  read as merely `watch` before it existed.
- **Fulfillment is reported before *and* after cancellation.** `fulfillment_rate`
  can be improved by cancelling orders; `demand_fill_rate` cannot. Never present
  one without the other, and never make the post-cancel figure the headline.
- **Anything displayed is scored.** A KPI on a card belongs in `KPI_KEYS`. Do not
  add decorative headline numbers that sit outside the health basket.
- **Missing data is disclosed, never rewarded.** Absent pillars lower `comparable`
  and surface a pillar count; they must not silently shrink the divisor and lift a
  warehouse's rank.
- **Correlation confidence follows the p-value**, with the Bonferroni threshold
  across the whole hypothesis set — not the sample size. Pairs that share an input
  carry `sharedTerm` and rank last; picker productivity is volume ÷ mandays, so
  correlating it against mandays variance measures the formula, not the operation.
- **Zeros are not measurements.** Days with no outbound volume are no-operations
  days and are excluded from correlations, not scored as failures.
- **Scores decay, they never clip to zero.** Use `decayScore()`. A linear penalty
  that bottoms out makes a chronically failing metric indistinguishable from a
  slightly failing one and freezes the risk heatmap into a flat line.
- **Evidence outranks defaults.** Initiatives linked to a pain point fill the list
  first; baseline fallbacks take only leftover slots.

## Data reality to keep in mind

- Metric names are matched by exact normalized string. The source suffixes several
  with `%`, which silently killed four alias keys — add both spellings, and check
  a new alias actually matches something before relying on it.
- Roughly half the source metric names are still unmapped, including
  `MP Recommendation`, per-division attendance and churn, non-picker mandays, and
  `OTIF %`. Mapping one is a product decision, not a refactor — ask first.
- `schedule_accuracy` averages 40–73% against a 95% target and can exceed 100%.
  Its definition is unconfirmed. Do not build a recommendation on it.
- BIT and STR genuinely do not track Pick-to-PF or replenishment. That is a scope
  gap in the source, not a mapping bug to "fix".

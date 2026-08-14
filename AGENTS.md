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

## Workflow: commit straight to `main`

This repo runs on a single branch. Both agents and the maintainer work on `main`
and push to it directly. The whole cycle is four commands:

```bash
git pull --rebase origin main
git add .
git commit -m "what changed, and why"
git push origin main
```

The `pull --rebase` is what makes one shared branch safe with more than one
author. Without it, whoever pushes second is rejected as non-fast-forward; with
it, your commits replay on top of the other agent's and history stays linear.
`pull.rebase` is already set to true in this clone, so a bare `git pull` does the
right thing too.

What this workflow asks in return, since there is no review branch to catch
anything:

- **Only push working code.** `npm run quality` must pass before every commit.
  A broken `main` blocks the other agent immediately.
- **Commit what you changed, not whatever is lying around.** `git add .` stages
  everything, so read `git status` first and leave unrelated edits alone.
- **Push soon after committing.** Commits held locally for a long time are what
  turn into painful rebases later.
- **Never force-push.** `git push --force` on a shared `main` destroys the other
  agent's commits. If a push is rejected, `git pull --rebase` and push again.
- **Say what is unfinished.** State it plainly rather than leaving uncommitted
  files behind for the other agent to find.

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
- **The floor layer borrows, it does not re-derive.** A station signal that is
  already an engine KPI must quote `reading()`'s value; only columns the engine
  does not grade get a `FLOOR_METRIC_RULES` entry. Station scores stay out of
  `healthFrom()`.
- **A floor threshold declares its basis.** `source_target`, `guardrail`, or
  `working_threshold`. If none of the three is honest, the target is `null` and
  the signal is context, not a grade.
- **Percent scaling is declared per metric, never inferred.** Floor rules carry
  an explicit `scale`; the engine's "multiply anything below 2" heuristic is safe
  for derived percentages but turns 2.46 collective attainment into 2.5% and a
  count of 2 late deliveries into 200.
- **Statistics state their method next to their answer.** Everything in
  `operations-math.ts` is computable from columns the sheet has. Do not add a
  function that needs lead time, queue depth, or WIP — the source carries none
  of them, and an estimated input would make the output look measured.
- **Control-chart sigma comes from the moving range**, not the standard
  deviation. A real process shift inflates sd and widens the limits enough to
  hide itself.
- **A quantified action plan is arithmetic, not a promise.** `quantified` on an
  initiative restates the active window ("if cancel had been at target, this
  many units would have stayed"). It never projects what the initiative will
  deliver, and the note on each entry says so. Where the arithmetic implies a
  recovery, the scenario model must also state how much of it the current
  capacity can absorb — the two numbers cannot sit in the product disagreeing.
- **The scenario model has no fitted parameters.** Every output traces to an
  identity over measured inputs. If a new behaviour needs a coefficient, it does
  not belong in the model; put it in the notes as a caveat instead.
- **Capacity is projected from demonstrated rate, attainment from target rate.**
  Mixing them up cost a full rebuild: a target-rate capacity model named packing
  as PGS's constraint on a day packers were beating target by 5%.
- **BSC is read, never inferred.** The glossary remarks column is the only source
  of a metric's incentive class. Guessing which metrics carry a bonus is guessing
  at somebody's pay.
- **Terminology.** PO is Purchase Order (inbound), SO is Supply Order (outbound,
  not a customer sales order), SLOC is Storage Location. BSC means the metric
  carries an incentive bonus; Non-BSC means it does not.

## Data reality to keep in mind

- Metric names are matched by exact normalized string. The source suffixes several
  with `%`, which silently killed four alias keys — add both spellings, and check
  a new alias actually matches something before relying on it.
- Many station-level columns are now mapped for the floor layer only: PO
  adjustment, `OTIF %`, checker on-time/late, relabel and replenishment mandays,
  putaway capacity/utilisation, LDP/LBH value and share, troubleshoot
  contribution to SO FR, packer and loader productivity, SEUIC adoption,
  pick-to-lost/bad, koli hilang di staging, hub-side FR, depart/arrival
  punctuality, and per-division attendance. Reading them at a station is settled;
  **promoting any of them into `KPI_KEYS` is still a product decision — ask
  first**, because it changes what every past health score meant.
- `MP Recommendation`, `Planogram Accuracy`, `GMV`, and `Schedule Accuracy`
  remain unconfirmed and blocked from scoring.
- `Found %` runs in the low teens against a 90% guardrail nobody in the source
  ever set. The engine raises `found-rate-definition` as a coverage gap rather
  than quietly relaxing the target; do not "fix" it by changing the number.
- `Truck Delivered %` divides trucks delivered by *dedicated* trucks while the
  numerator already includes on-call units, so it exceeds 100% when the reserve
  is used. The loading station discloses this; it is not a bug to smooth over.
- `schedule_accuracy` averages 40–73% against a 95% target and can exceed 100%.
  Its definition is unconfirmed. Do not build a recommendation on it.
- BIT and STR genuinely do not track Pick-to-PF or replenishment. That is a scope
  gap in the source, not a mapping bug to "fix".

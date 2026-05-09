# Sprint 58 — Deferred

`src/renderer/api/tauriClient.ts` (712 lines) and `src/renderer/utils/groupTransformer.ts`
(714 lines) are at the "target" file ceiling but not over the hard 800-line cap. The
planned splits — `invokeWrappers.ts` + `api/domain/{sessions,config,notifications}.ts`
and `grouping/{groupBuilder,groupEnhancer,displayItemAssembler}.ts` — are non-trivial
refactors that touch the API surface and the chunk-to-display pipeline. Both are
on the critical path; a regression in either pinches the entire app.

Deferring to a dedicated refactor sprint (post-roadmap) where the focus can be the
extraction alone, with full regression run before commit.

Sprint 58 ships:
- This note (architecture deferral receipt).

Next pick-up criteria: dedicated branch, no concurrent feature work, three review
passes (metis, architect, momus), and a "no behavior change" assertion before
merge.

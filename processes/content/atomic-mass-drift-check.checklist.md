<!-- GENERATED from folio-assistant-sci/processes/content/atomic-mass-drift-check.bpmn by cat-harness-tools/scripts/bpmn-checklist.ts. Do not edit: change the diagram and regenerate (bun run cat bpmn:checklist). -->

# Checklist — Is AtomicMass.lean still in sync with its data table?

> **Generated, and not the authority.** This is `folio-assistant-sci/processes/content/atomic-mass-drift-check.bpmn` (process `Process_AtomicMassDrift`) walked as a state machine. The diagram and the workflow engine decide; this list only reads them. Follow the `next:` line of each step rather than the order on the page, and record each step with the call it names, so the engine's committed state — not this list — says which edge was taken.

Check that `AtomicMass.lean` is still in sync with the data table it is generated from.

## Begin — Pull request, push to main, or dispatch (`Start_Change`)

- Begin here.
- Call `workflow_start` with `process: "Process_AtomicMassDrift"` and the subject this run is about; keep the instance id it returns.
- next: → `Task_Check` (Regenerate AtomicMass.lean from the data table — and diff)

### 1. Regenerate AtomicMass.lean from the data table — and diff (`Task_Check`)

- Who: the `CI/CD Pipeline` lane (role `build-pipeline`).
- What: Run gen_atomic_mass.py --check: regenerate AtomicMass.lean from the data table and diff it against the committed file.
- Record it: `workflow_complete` with `node: "Task_Check"`.
- next: → `GW_Drift` (Did anything change?)

### Decide — Did anything change? (`GW_Drift`)

- Answered by the diff Task_Check takes after regenerating AtomicMass.lean from the data table.
- Call `workflow_complete` with `node: "GW_Drift"` and `outcome` set to the label that holds:
  - «no — in sync» → `End_Clean` (Generated file in sync)
  - «yes — drifted» → `End_Drift` (Job RED — the generated file is stale)

## Done — Generated file in sync (`End_Clean`)

- The instance completes here. `workflow_next` then reports nothing enabled — that, not this line, is the record of completion.

## Done — Job RED — the generated file is stale (`End_Drift`)

- The instance completes here. `workflow_next` then reports nothing enabled — that, not this line, is the record of completion.

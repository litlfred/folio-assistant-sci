<!-- GENERATED from folio-assistant-sci/processes/content/authoring-a-paper.bpmn by cat-harness-tools/scripts/bpmn-checklist.ts. Do not edit: change the diagram and regenerate (bun run cat bpmn:checklist). -->

# Checklist — Authoring a paper

> **Generated, and not the authority.** This is `folio-assistant-sci/processes/content/authoring-a-paper.bpmn` (process `Process_PaperAuthoring`) walked as a state machine. The diagram and the workflow engine decide; this list only reads them. Follow the `next:` line of each step rather than the order on the page, and record each step with the call it names, so the engine's committed state — not this list — says which edge was taken.

How a scientific paper or book folio is authored end to end, with Lean for its formal claims and LaTeX for its typesetting.

## Begin — New paper (`StartEvent_NewPaper`)

- Begin here.
- Call `workflow_start` with `process: "Process_PaperAuthoring"` and the subject this run is about; keep the instance id it returns.
- next: → `Task_Plan` (1 · Plan the paper)

### 1. 1 · Plan the paper (`Task_Plan`)

- Who: the `Author (person)` lane (role `author`).
- Skill: `content-plan`.
- What: Scope the paper: chapters, the blocks each needs, what gets formalised.
- Record it: `workflow_complete` with `node: "Task_Plan"`.
- next: → `Task_SeedPlan` (2 · Seed the work plan)

### 2. 2 · Seed the work plan (`Task_SeedPlan`)

- Who: the `Work plan — beans (shared by humans and agents)` lane (role `work-plan`).
- Skill: `todo-manager`.
- What: The plan becomes beans, so a resumed session or a sibling agent can pick it up.
- Record it: `workflow_complete` with `node: "Task_SeedPlan"`.
- next: → `Task_Scaffold` (3 · Scaffold the folio repo)

### 3. 3 · Scaffold the folio repo (`Task_Scaffold`)

- Who: the `Authoring agent (system)` lane (role `authoring-agent`).
- Skill: `content-plan`.
- What: Create the folio repository with `bun run cat init-folio` (or the folio_init tool): content/, the document, chapter and first block manifests, the builder shim, AGENTS.md, .mcp.json, the session-start hook and the beans store, with the platform linked rather than copied.
- Record it: `workflow_complete` with `node: "Task_Scaffold"`.
- next: → `Task_AuthorBlocks` (4 · Author blocks)

### 4. 4 · Author blocks (`Task_AuthorBlocks`)

- Who: the `Authoring agent (system)` lane (role `authoring-agent`).
- Skill: `content-author`.
- What: Every block edit runs the HCI validation gate — see editing-hci-validation.bpmn.
- Record it: `workflow_complete` with `node: "Task_AuthorBlocks"`.
- next: → `Task_Formalize` (5 · Formalise in Lean)

### 5. 5 · Formalise in Lean (`Task_Formalize`)

- Who: the `Lean toolchain (lean-mcp)` lane (role `lean-toolchain`).
- Skill: `lean-formalization`, `proof-verification`.
- What: Give each formal block (definition, theorem, lemma, proposition, corollary, conjecture, proof) a .lean sibling that Lean 4 accepts, in the order lean-formalization sets out.
- Record it: `workflow_complete` with `node: "Task_Formalize"`.
- next: → `Gateway_LeanGreen` (Build green, no sorries?)

### Decide — Build green, no sorries? (`Gateway_LeanGreen`)

- Answered by the Lean build after step 5: is it green with no `sorry` left?
- Computed by the DMN table `decisions/lean-build-gate.dmn#Decision_LeanBuildGate`: call `workflow_complete` with `node: "Gateway_LeanGreen"` and the `facts` it reads — the table returns the branch; pass no `outcome`.
  - «not yet» → `Task_Formalize` (5 · Formalise in Lean)
  - «green» → `Task_Validate` (6 · Validate)

### 6. 6 · Validate (`Task_Validate`)

- Who: the `Build pipeline — validate · render · publish` lane (role `build-pipeline`).
- Skill: `content-validate`.
- What: Run content validation over the folio: schemas, the content profile (formal kinds only in a paper), cross-block consistency and that the Lean builds.
- Record it: `workflow_complete` with `node: "Task_Validate"`.
- next: → `Task_Render` (7 · Render PDF / HTML)

### 7. 7 · Render PDF / HTML (`Task_Render`)

- Who: the `Build pipeline — validate · render · publish` lane (role `build-pipeline`).
- Skill: `latex-authoring`.
- What: Typeset the paper through LaTeX to PDF and HTML.
- Record it: `workflow_complete` with `node: "Task_Render"`.
- next: → `Task_Review` (8 · Review and feedback)

### 8. 8 · Review and feedback (`Task_Review`)

- Who: the `Reviewer / SME` lane (role `reviewer`).
- Skill: `content-review`.
- What: Review the rendered paper, not a description of it, and record the feedback.
- Record it: `workflow_complete` with `node: "Task_Review"`.
- next: → `Gateway_ReviewOutcome` (Ready to publish?)

### Decide — Ready to publish? (`Gateway_ReviewOutcome`)

- The reviewer's call after step 8.
- Call `workflow_complete` with `node: "Gateway_ReviewOutcome"` and `outcome` set to the label that holds:
  - «iterate» → `Task_AuthorBlocks` (4 · Author blocks)
  - «approved» → `Task_Publish` (9 · Publish)

### 9. 9 · Publish (`Task_Publish`)

- Who: the `Build pipeline — validate · render · publish` lane (role `build-pipeline`).
- Skill: `content-publish`.
- What: See draft-to-publication.bpmn for the review and release path this expands into.
- Record it: `workflow_complete` with `node: "Task_Publish"`.
- next: → `EndEvent_Published` (Paper published)

## Done — Paper published (`EndEvent_Published`)

- The instance completes here. `workflow_next` then reports nothing enabled — that, not this line, is the record of completion.

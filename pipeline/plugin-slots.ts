/**
 * The generic pipeline slots folio-assistant-sci fills, as ONE typed table.
 *
 * Each `pipeline-plugins/<slot>.json` node names this table and its slot (bean
 * riit, step 3b): the node is what says the slot is filled, this table is what
 * `tsc` checks against the generic side's own contract (`PipelinePlugins`), so
 * a shape that drifts from what the callers expect fails here rather than at
 * the call. Moved out of `contributions.ts`, which no longer returns plugins.
 *
 * The imports still reach into `cat-harness/` because those files have not
 * moved yet (bean `squu`'s follow-up move PR). That direction (sci → lower) is
 * allowed; the move turns each into a local path.
 *
 * @module folio-assistant-sci/pipeline/plugin-slots
 */
import type { PipelinePlugins } from "../../cat-harness-tools/pipeline/pipeline-plugins.js";
import { declarationStarts, stripLeanComments } from "../../cat-harness-tools/pipeline/lean-lexer.js";
import { runPreflight } from "./latex-preflight.js";
import { computeStats, leanFileStatus, resolveLeanFile } from "../scripts/lean-coverage.js";

/** Only the slots this instance fills; the rest are filled elsewhere or left empty. */
export const PIPELINE_IMPLEMENTATIONS: Pick<PipelinePlugins, "lean-lexer" | "latex-preflight" | "lean-coverage"> = {
  "lean-lexer": { stripLeanComments, declarationStarts },
  "latex-preflight": { runPreflight },
  "lean-coverage": { resolveLeanFile, leanFileStatus, computeStats },
};

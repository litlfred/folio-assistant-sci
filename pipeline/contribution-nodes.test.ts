/**
 * folio-assistant-sci's QA checkers and pipeline-plugin slots are KG nodes
 * (bean riit, step 3b), registered for a folio through its dependency tree.
 * Owner, 2026-10-04: every contribution is a node; one graph per type; a
 * folio sees the nodes of the instances it depends on.
 */
import { describe, expect, test } from "bun:test";

import { ContributionRegistry } from "../../cat-harness/schemas/content/contributions";
import { OwnCodeRefSchema, QaCheckerNodeSchema } from "../../cat-harness/schemas/kg/contribution-nodes";
import { loadContributionsSync, orderedDependencies } from "../../cat-harness/schemas/kg/harness-config";
import { SCI_ROOT, sciRegistrySync } from "../scripts/tests/sci-consumer";
import { COST_AUTOMATED_CHECKERS } from "./qa-checkers-cost";
import { RENDER_AUTOMATED_CHECKERS } from "./qa-checkers-render";
import { TRIVIALITY_AUTOMATED_CHECKERS } from "./qa-checkers-triviality";
import { VACUITY_AUTOMATED_CHECKERS } from "./qa-checkers-vacuity";
import { PIPELINE_IMPLEMENTATIONS } from "./plugin-slots";

// A folio that depends on sci, and one whose tree stops at core — found
// through sci's declared `needs` rather than a path composed above this layer.
const withSci = sciRegistrySync();
const coreRoot = orderedDependencies(SCI_ROOT).find((d) => d.dependency.name === "folio-assistant-core")!.rootPath;
const withoutSci = loadContributionsSync(coreRoot, new ContributionRegistry());

const CHECKER_TABLES = [

  [COST_AUTOMATED_CHECKERS, "pipeline/qa-checkers-cost.ts"],
  [RENDER_AUTOMATED_CHECKERS, "pipeline/qa-checkers-render.ts"],
  [TRIVIALITY_AUTOMATED_CHECKERS, "pipeline/qa-checkers-triviality.ts"],
  [VACUITY_AUTOMATED_CHECKERS, "pipeline/qa-checkers-vacuity.ts"],
] as const;

describe("sci's contributions arrive as nodes, through the dependency tree", () => {
  test("every slot in the table is filled, with the table's own implementation", () => {
    for (const [slot, impl] of Object.entries(PIPELINE_IMPLEMENTATIONS)) {
      expect(withSci.pipelinePlugin(slot)).toBe(impl);
    }
  });

  test("every checker in the tables is registered, hashed over the file that defines it", () => {
    for (const [table, sourceFile] of CHECKER_TABLES) {
      for (const [criterion, check] of Object.entries(table)) {
        const entry = withSci.qaCheckerEntry(criterion);
        expect<unknown>(entry?.check).toBe(check);
        expect(entry?.sourceFile).toBe(sourceFile);
        expect(entry?.root).toBe(SCI_ROOT);
      }
    }
  });

  test("a folio whose tree does not include sci gets none of them", () => {
    for (const slot of Object.keys(PIPELINE_IMPLEMENTATIONS)) expect(withoutSci.pipelinePlugin(slot)).toBeUndefined();
    for (const [table] of CHECKER_TABLES) {
      for (const criterion of Object.keys(table)) expect(withoutSci.qaCheckerEntry(criterion)).toBeUndefined();
    }
  });
});

describe("a contribution's code ref is its own", () => {
  test("an instance prefix, an escaping path and a missing export are refused", () => {
    expect(OwnCodeRefSchema.safeParse("pipeline/x.ts#TABLE").success).toBe(true);
    expect(OwnCodeRefSchema.safeParse("cat-harness:pipeline/x.ts#TABLE").success).toBe(false);
    expect(OwnCodeRefSchema.safeParse("../cat-harness/x.ts#TABLE").success).toBe(false);
    expect(OwnCodeRefSchema.safeParse("pipeline/x.ts").success).toBe(false);
    expect(QaCheckerNodeSchema.safeParse({ $schema: "folio-qa-checker/v1", criterion: "c", check: "x.ts#T", extra: 1 }).success).toBe(false);
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { chapters, computeWeights, parseModule, topoOrder } from "./lean-library-ingest.ts";

const ROOT = mkdtempSync(join(tmpdir(), "lean-ingest-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function lean(path: string, body: string): string {
  const f = join(ROOT, path);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, body);
  return f;
}

const base = lean("Lib/Base.lean", "/-!\n# Base\n-/\ndef one := 1\n");
const heavy = lean("Lib/Heavy.lean", "import Lib.Base\nimport Lib.A.Core\n/-!\n# Heavy\n-/\n");
const core = lean("Lib/A/Core.lean", "import Lib.Base\n/-!\n# Core\n\n## Main results\n\n## The idea\n-/\n/-- **Main.** It holds. -/\ntheorem main : True := trivial\n");
const light = lean("Lib/A/Light.lean", "import Lib.Base\n/-!\n# Light\n-/\nlemma l : True := trivial\n");

describe("a Lean library is linearised in an order its imports allow", () => {
  test("parsesImportsDocstringsAndDecls", () => {
    const m = parseModule(ROOT, core);
    expect(m.name).toBe("Lib.A.Core");
    expect(m.imports).toEqual(["Lib.Base"]);
    expect(m.title).toBe("Core");
    expect(m.decls).toEqual([{ kind: "theorem", name: "main", line: 10, doc: "**Main.** It holds." }]);
  });
  test("everyModuleFollowsItsImports", () => {
    computeWeights(ROOT, ["Lib"]);
    const order = topoOrder([heavy, core, light, base].map((f) => parseModule(ROOT, f))).map((m) => m.name);
    expect(order[0]).toBe("Lib.Base");
    expect(order.indexOf("Lib.A.Core")).toBeLessThan(order.indexOf("Lib.Heavy"));
  });
  test("chaptersAreSubdirectoriesInDependencyOrder", () => {
    computeWeights(ROOT, ["Lib"]);
    const chs = chapters("Lib", [heavy, core, light, base].map((f) => parseModule(ROOT, f)));
    const keys = chs.map((c) => c.key);
    expect(keys.indexOf("A")).toBeLessThan(keys.indexOf("Heavy"));
    expect(keys.indexOf("Base")).toBeLessThan(keys.indexOf("A"));
  });
});

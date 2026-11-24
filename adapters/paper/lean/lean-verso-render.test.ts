/**
 * lean-verso-render's pure half: engine choice, the .ilean index, the plan and
 * the generated Verso document. The Lean elaboration and Verso's generator are
 * not run here; the PR that added the Tool records an end-to-end render.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compatibleModules, engineFor, generateMain, generateVersoDoc, ileanDecls, indexIleans, parseToolchain, planRender, versoText } from "./lean-verso-render";

const ilean = (module: string, names: Array<[string, string]>) =>
  JSON.stringify({
    version: 4,
    module,
    directImports: [],
    references: Object.fromEntries(names.map(([m, n]) => [JSON.stringify({ c: { m, n } }), { definition: null, usages: [] }])),
  });

describe("engineFor", () => {
  test("qou's v4.24.0 has Verso but no Verso Blueprint", () => {
    const e = engineFor("leanprover/lean4:v4.24.0");
    expect(e.engine).toBe("verso-manual");
    expect(e.versoRef).toBe("v4.24.0");
  });
  test("a toolchain with a verso-blueprint branch gets Verso Blueprint", () => {
    expect(engineFor("leanprover/lean4:v4.35.0").engine).toBe("verso-blueprint");
    expect(engineFor("v4.28.0").engine).toBe("verso-blueprint");
  });
  test("before Verso's first tag, and nightlies, get nothing", () => {
    expect(engineFor("v4.9.0").engine).toBe("none");
    expect(engineFor("leanprover/lean4:nightly-2026-01-01").engine).toBe("none");
    expect(parseToolchain("leanprover/lean4:v4.24.0-rc1")).toBeUndefined();
  });
});

describe("the .ilean index", () => {
  test("reads module and name from every constant key, skipping others", () => {
    const text = JSON.stringify({ module: "A.B", references: { '{"c":{"m":"A.B","n":"A.B.foo"}}': {}, '{"f":{"m":"A.B","n":"x"}}': {} } });
    expect(ileanDecls(text)).toEqual([["A.B.foo", "A.B"]]);
    expect(ileanDecls("not json")).toEqual([]);
  });
  test("walks a tree, keeps chosen roots and records module names", () => {
    const d = mkdtempSync(join(tmpdir(), "verso-ilean-"));
    mkdirSync(join(d, "QOU"), { recursive: true });
    writeFileSync(join(d, "QOU", "X.ilean"), ilean("QOU.X", [["QOU.X", "QOU.X.thm"], ["Mathlib.Foo", "Real"]]));
    const idx = indexIleans([d], new Set(["QOU"]));
    expect(idx.get("QOU.X.thm")).toBe("QOU.X");
    expect(idx.has("Real")).toBe(false);
    expect(idx.modules?.has("QOU.X")).toBe(true);
  });
});

describe("planRender", () => {
  const idx = Object.assign(new Map([["Q.A.f", "Q.A"], ["Q.B.g", "Q.B"], ["Q.A.h", "Q.A"]]), { modules: new Set(["Q.A", "Q.B", "Q.C"]) });
  const refs = new Map([
    ["Q.A.f", [{ label: "def:f", md: "ch1/f.md" }]],
    ["Q.B.g", [{ label: "thm:g", md: "ch2/g.md" }]],
    ["Q.A.h", [{ label: "lem:h", md: "ch1/h.md" }]],
    ["Q.C", [{ label: "rem:c", md: "ch1/c.md" }]],
    ["Q.Missing.x", [{ label: "prop:x", md: "ch1/x.md" }]],
  ]);
  test("groups by module, separates module refs and unresolved refs", () => {
    const p = planRender(refs, idx);
    expect(p.imports).toEqual(["Q.A", "Q.B"]);
    expect(p.byModule.get("Q.A")!.map((e) => e.decl)).toEqual(["Q.A.f", "Q.A.h"]);
    expect([...p.moduleRefs.keys()]).toEqual(["Q.C"]);
    expect(p.unresolved).toEqual(["Q.Missing.x"]);
  });
  test("chapter and limit narrow the plan", () => {
    expect(planRender(refs, idx, { chapter: "ch2" }).imports).toEqual(["Q.B"]);
    const p = planRender(refs, idx, { limit: 1 });
    expect([...p.byModule.values()].flat().map((e) => e.decl)).toEqual(["Q.A.f"]);
  });
});

describe("the generated Verso document", () => {
  const idx = Object.assign(new Map([["Q.A.f", "Q.A"]]), { modules: new Set(["Q.A"]) });
  const plan = planRender(new Map([["Q.A.f", [{ label: "def:f_x", md: "ch1/f.md" }]]]), idx);
  test("imports each module, one docstring block per declaration, linked to its block", () => {
    const doc = generateVersoDoc(plan, { title: "Lean", docModule: "FolioVerso", blockBase: "https://github.com/o/r/blob/main/c/" });
    expect(doc).toContain("import VersoManual\nimport Q.A\n");
    expect(doc).toContain("#doc (Manual) \"Lean\" =>");
    expect(doc).toContain("{docstring Q.A.f}");
    expect(doc).toContain("[def:f\\_x](https://github.com/o/r/blob/main/c/ch1/f.md)");
    expect(generateVersoDoc(plan, { title: "Lean", docModule: "FolioVerso" })).toBe(generateVersoDoc(plan, { title: "Lean", docModule: "FolioVerso" }));
  });
  test("main runs manualMain on the document", () => {
    expect(generateMain("FolioVerso")).toContain("def main := manualMain (%doc FolioVerso)");
  });
  test("Verso markup characters are escaped", () => {
    expect(versoText("a_b*c[d]")).toBe("a\\_b\\*c\\[d\\]");
  });
});

describe("compatibleModules", () => {
  test("skips a module whose import closure redefines a name already in the environment", () => {
    const idx = Object.assign(new Map<string, string>(), {
      modules: new Set(["A", "B", "C", "D"]),
      deps: new Map([["A", []], ["B", []], ["C", ["B"]], ["D", []]]),
      definers: new Map([["Dup", new Set(["A", "B"])], ["ok", new Set(["D"])]]),
    });
    const r = compatibleModules(["A", "C", "D"], idx);
    expect(r.kept).toEqual(["A", "D"]);
    expect(r.skipped).toEqual([{ module: "C", name: "Dup", clashesWith: "A" }]);
  });
  test("an index without definers keeps everything", () => {
    expect(compatibleModules(["X", "Y"], new Map()).kept).toEqual(["X", "Y"]);
  });
});

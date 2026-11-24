/**
 * The Verso Blueprint engine's pure half: reading block manifests, labels,
 * directives, and the generated document, generator and lakefile. Lake and
 * `vbp build` are not run here; the PR that added the engine records an
 * end-to-end render.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  VERSO_BLUEPRINT_REV,
  blueprintLabel,
  directiveFor,
  generateBlueprintDoc,
  generateBlueprintLakefile,
  generateBlueprintMain,
  lakePackageName,
  parseBlockManifest,
  versoInline,
  type BlueprintBlock,
} from "./lean-verso-blueprint";

describe("parseBlockManifest", () => {
  test("reads package, declaration, label, kind, title and uses", () => {
    const b = parseBlockManifest(`export default lemma({ label: "lem:x", title: "The \\"x\\" lemma", uses: ["def:a", "prop:b"], lean: { ref: "qou:QOU.X.x" } });`);
    expect(b).toEqual({ pkg: "qou", decl: "QOU.X.x", label: "lem:x", kind: "lemma", title: 'The "x" lemma', uses: ["def:a", "prop:b"] });
  });
  test("an explicit kind field wins over the builder name; no lean.ref is no block", () => {
    expect(parseBlockManifest(`block({ kind: "theorem", label: "thm:y", lean: { ref: "ugb:UGB.y" } })`)?.kind).toBe("theorem");
    expect(parseBlockManifest(`definition({ label: "def:z" })`)).toBeUndefined();
  });
});

describe("labels and directives", () => {
  test("content labels become Blueprint labels", () => {
    expect(blueprintLabel("def:Toy Double")).toBe("def-toy-double");
  });
  test("lemma is spelt lemma_, and kinds Verso Blueprint lacks render as propositions", () => {
    expect(directiveFor("lemma")).toBe("lemma_");
    expect(directiveFor("definition")).toBe("definition");
    expect(directiveFor("conjecture")).toBe("proposition");
  });
  test("titles keep math as Verso math and escape markup", () => {
    expect(versoInline("Map $n \\mapsto 2n$ is *good*")).toBe("Map $`n \\mapsto 2n` is \\*good\\*");
  });
});

describe("the generated Blueprint", () => {
  const b = (label: string, decl: string, uses: string[] = [], kind = "theorem"): BlueprintBlock => ({ pkg: "toy", decl, label, kind, title: label, uses, md: `c/${label}.md` });
  const doc = generateBlueprintDoc(
    new Map([["Toy.Basic", [b("def:d", "Toy.d", [], "definition"), b("thm:t", "Toy.t", ["def:d", "def:elsewhere"])]]]),
    { title: "toy blueprint", docModule: "FolioBlueprint", imports: ["Toy.Basic"], blockBase: "https://github.com/o/r/blob/main/" },
  );
  test("imports the library, one node per block with its declaration", () => {
    expect(doc).toContain("import VersoBlueprint\n");
    expect(doc).toContain("import Toy.Basic\n");
    expect(doc).toContain(':::definition "def-d" (lean := "Toy.d")');
    expect(doc).toContain("[def:d](https://github.com/o/r/blob/main/c/def:d.md)");
  });
  test("uses keep only labels that are nodes here, so every graph edge resolves", () => {
    expect(doc).toContain(':::theorem "thm-t" (lean := "Toy.t") (uses := "def-d")');
    expect(doc).not.toContain("def-elsewhere");
  });
  test("ends with the graph and the summary", () => {
    expect(doc.trimEnd().endsWith("{blueprint_summary}")).toBe(true);
    expect(doc).toContain("{blueprint_graph}");
  });
  test("generator and lakefile pin Verso Blueprint and require the folio by path", () => {
    expect(generateBlueprintMain("FolioBlueprint")).toContain("blueprintMainWithPreviewData");
    const lf = generateBlueprintLakefile({ packageName: "FolioBlueprint", folio: { name: "qou", path: "/x/lean" } });
    expect(lf).toContain(`@"${VERSO_BLUEPRINT_REV}"`);
    expect(lf).toContain('require qou from "/x/lean"');
  });
});

describe("lakePackageName", () => {
  test("reads lakefile.lean and lakefile.toml", () => {
    const d = mkdtempSync(join(tmpdir(), "lpn-"));
    writeFileSync(join(d, "lakefile.toml"), 'name = "qou"\n');
    expect(lakePackageName(d)).toBe("qou");
    const e = mkdtempSync(join(tmpdir(), "lpn-"));
    writeFileSync(join(e, "lakefile.lean"), "package «toy» where\n");
    expect(lakePackageName(e)).toBe("toy");
  });
});

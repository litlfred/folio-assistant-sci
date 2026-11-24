import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHUNK_SIZE, ingest, linkFor, moduleOfDocPath, parseSiblings, rerouteSignature, rewriteHeader, splitFromKg, type IndexFile } from "./lean-kg-ingest.ts";
import { signatureStyles } from "./lean-kg-publish.ts";

const decl = (name: string, kind = "theorem") => ({
  header: `<div class="decl_header"><span class="decl_kind">${kind}</span> <a href="./QOU/A.html#${name}">${name}</a> <a href="./Mathlib/Algebra/Field/Defs.html#Field">Field</a></div>`,
  info: { name, kind, doc: `doc of ${name}`, sourceLink: "https://example/x.lean#L1", line: 1 },
});

function fixture(): { docData: string; content: string } {
  const root = mkdtempSync(join(tmpdir(), "lkg-"));
  const docData = join(root, "doc-data");
  mkdirSync(docData);
  const write = (m: string, decls: unknown[]) =>
    writeFileSync(join(docData, `declaration-data-${m}.bmp`), JSON.stringify({ name: m, imports: ["Init"], declarations: decls, instances: [] }));
  write("QOU.A", [decl("QOU.A.x"), decl("QOU.A.y", "def")]);
  write("QOU.Big", Array.from({ length: CHUNK_SIZE + 3 }, (_, i) => decl(`QOU.Big.d${i}`)));
  write("Mathlib.Algebra.Field.Defs", [decl("Field", "class")]);
  const content = join(root, "folio", "ch");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "blk.ts"), `export default { label: "prop:x", lean: { ref: "qou:QOU.A.x" } }`);
  return { docData, content: join(root, "folio") };
}

describe("lean-kg-ingest", () => {
  test("moduleOfDocPathMapsModuleFragment", () => {
    expect(moduleOfDocPath("./QOU/Mass/X.html#QOU.Mass.X.y")).toEqual({ module: "QOU.Mass.X", frag: "QOU.Mass.X.y" });
    expect(moduleOfDocPath("./foundational_types.html")).toBeUndefined();
  });

  test("rewriteHeaderRoutesLinks", () => {
    const h = rewriteHeader(decl("QOU.A.x").header, new Set(["qou"]), "https://ext/");
    expect(h).toContain(`href="#/m/QOU.A/QOU.A.x"`);
    expect(h).toContain(`href="https://ext/Mathlib/Algebra/Field/Defs.html#Field"`);
  });

  test("ingestPrunesChunksLinks", () => {
    const { docData, content } = fixture();
    const out = mkdtempSync(join(tmpdir(), "lkg-out-"));
    const r = ingest({ docData, out, modules: ["QOU"], contentRoot: content });
    expect(r.modules).toBe(2);
    expect(r.decls).toBe(2 + CHUNK_SIZE + 3);
    expect(r.formalized).toBe(1);
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf-8")) as IndexFile;
    expect(index.modules.map((m) => m.name)).toEqual(["QOU.A", "QOU.Big"]);
    expect(index.modules[1]!.chunks).toBe(2);
    expect(readdirSync(join(out, "m")).filter((f) => f.startsWith("QOU.Big.")).sort()).toEqual(["QOU.Big.0.sig.json", "QOU.Big.1.sig.json", "QOU.Big.jsonld"]);
    const shard = JSON.parse(readFileSync(join(out, "m", "QOU.A.jsonld"), "utf-8"));
    const x = shard["@graph"].find((n: { name?: string }) => n.name === "QOU.A.x");
    expect(x.formalizes).toEqual([{ "@id": "block:prop:x", label: "prop:x", md: "ch/blk.md" }]);
  });

  test("overlayWritesOnlyChangedModules", () => {
    const { docData, content } = fixture();
    const base = mkdtempSync(join(tmpdir(), "lkg-base-"));
    ingest({ docData, out: base, modules: ["QOU"], contentRoot: content });
    const baseIndex = JSON.parse(readFileSync(join(base, "index.json"), "utf-8")) as IndexFile;
    writeFileSync(join(docData, "declaration-data-QOU.A.bmp"), JSON.stringify({ name: "QOU.A", imports: ["Init"], declarations: [decl("QOU.A.z")], instances: [] }));
    const out = mkdtempSync(join(tmpdir(), "lkg-ov-"));
    const r = ingest({ docData, out, modules: ["QOU"], contentRoot: content, base, baseIndex });
    expect(r.written).toBe(1);
    expect(r.unchanged).toBe(1);
    const ov = JSON.parse(readFileSync(join(out, "overlay.json"), "utf-8"));
    expect(ov.changed).toEqual(["QOU.A"]);
    expect(readdirSync(join(out, "m")).some((f) => f.startsWith("QOU.Big"))).toBe(false);
  });

  test("refusesNonDocGenDir", () => {
    expect(() => ingest({ docData: mkdtempSync(join(tmpdir(), "lkg-empty-")), out: mkdtempSync(join(tmpdir(), "x-")), modules: [] })).toThrow(/not a doc-gen4/);
  });
});

describe("lean-kg-ingest — one sub-KG per package (root bases, split)", () => {
  const fred = (name: string) => ({
    header: `<a href="./Fred2005/F.html#${name}">${name}</a> <a href="./QOU/A.html#QOU.A.x">x</a> <a href="./Mathlib/Algebra/Field/Defs.html#Field">Field</a>`,
    info: { name, kind: "theorem" },
  });

  test("parseSiblingsMapsEachRootToItsPackageBesideThisOne", () => {
    expect([...parseSiblings(["qou/QOU,qou/MassTheory", "ugb/UGB"])]).toEqual([["qou", "../qou/"], ["masstheory", "../qou/"], ["ugb", "../ugb/"]]);
    expect(() => parseSiblings(["QOU"])).toThrow(/<package>\/<Root>/);
    expect(() => parseSiblings(["../x/QOU"])).toThrow();
    expect(() => parseSiblings(["qou/QOU;rm"])).toThrow();
  });

  test("rewriteHeaderSendsSiblingRootToItsSubKgAndMathlibOutside", () => {
    const h = rewriteHeader(fred("Fred2005.F.t").header, new Set(["fred2005"]), "https://ext/", parseSiblings(["qou/QOU"]));
    expect(h).toContain(`href="#/m/Fred2005.F/Fred2005.F.t"`);
    expect(h).toContain(`href="../qou/#/m/QOU.A/QOU.A.x"`);
    expect(h).toContain(`href="https://ext/Mathlib/Algebra/Field/Defs.html#Field"`);
  });

  test("linkForWithoutSiblingFallsBackToExternalDocPath", () => {
    expect(linkFor("QOU.A", "QOU.A.x", new Set(["fred2005"]), "https://ext")).toBe("https://ext/QOU/A.html#QOU.A.x");
  });

  test("rerouteSignatureRewritesOnlyRoutesOutOfTheKeptRoots", () => {
    const html = `<a href="#/m/QOU.A/QOU.A.x">x</a><a href="#/m/UGB.B/UGB.B.y">y</a><a href="#/m/Other.C">c</a><a href="https://ext/Mathlib/X.html#z">z</a>`;
    const r = rerouteSignature(html, new Set(["qou"]), "https://ext/", parseSiblings(["ugb/UGB"]));
    expect(r).toContain(`href="#/m/QOU.A/QOU.A.x"`);
    expect(r).toContain(`href="../ugb/#/m/UGB.B/UGB.B.y"`);
    expect(r).toContain(`href="https://ext/Other/C.html"`);
    expect(r).toContain(`href="https://ext/Mathlib/X.html#z"`);
  });

  test("splitFromKgCutsOnePackageWithNoDocData", () => {
    const root = mkdtempSync(join(tmpdir(), "lkg-split-"));
    const docData = join(root, "doc-data");
    mkdirSync(docData);
    const write = (m: string, decls: unknown[]) =>
      writeFileSync(join(docData, `declaration-data-${m}.bmp`), JSON.stringify({ name: m, imports: ["QOU.A"], declarations: decls, instances: [] }));
    write("QOU.A", [decl("QOU.A.x"), decl("QOU.A.y", "def")]);
    write("Fred2005.F", [fred("Fred2005.F.t")]);
    const combined = join(root, "combined");
    ingest({ docData, out: combined, modules: ["QOU", "Fred2005"] });
    // The combined graph routes the Fred2005 → QOU link inside itself.
    expect(readFileSync(join(combined, "m", "Fred2005.F.0.sig.json"), "utf-8")).toContain(`#/m/QOU.A/QOU.A.x`);

    const out = join(root, "fred");
    const r = splitFromKg({ kg: combined, out, modules: ["Fred2005"], externalBase: "https://ext/", rootBases: parseSiblings(["qou/QOU"]) });
    expect(r).toMatchObject({ modules: 1, decls: 1, written: 1, overlay: false });
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf-8")) as IndexFile;
    expect(index.modules.map((m) => m.name)).toEqual(["Fred2005.F"]);
    expect(index.totals).toEqual({ modules: 1, decls: 1, formalized: 0 });
    expect(JSON.parse(readFileSync(join(out, "names.json"), "utf-8"))).toEqual([["Fred2005.F.t", 0, 0]]);
    const sig = readFileSync(join(out, "m", "Fred2005.F.0.sig.json"), "utf-8");
    expect(sig).toContain(`../qou/#/m/QOU.A/QOU.A.x`);
    expect(sig).toContain(`#/m/Fred2005.F/Fred2005.F.t`);
    expect(readdirSync(join(out, "m")).some((f) => f.startsWith("QOU."))).toBe(false);

    const qou = splitFromKg({ kg: combined, out: join(root, "qou"), modules: ["QOU"] });
    expect(qou).toMatchObject({ modules: 1, decls: 2 });
    expect(JSON.parse(readFileSync(join(root, "qou", "names.json"), "utf-8")).map((n: unknown[]) => n[1])).toEqual([0, 0]);
  });

  test("splitFromKgRefusesOverlayEmptySelectionAndNonKg", () => {
    const d = mkdtempSync(join(tmpdir(), "lkg-bad-"));
    expect(() => splitFromKg({ kg: d, out: join(d, "o"), modules: ["QOU"] })).toThrow(/no index.json/);
    writeFileSync(join(d, "index.json"), JSON.stringify({ schema: "folio-lean-kg/v1", chunkSize: 500, modules: [], kinds: [], totals: {} }));
    writeFileSync(join(d, "names.json"), "[]");
    expect(() => splitFromKg({ kg: d, out: join(d, "o"), modules: [] })).toThrow(/module roots/);
    writeFileSync(join(d, "overlay.json"), "{}");
    expect(() => splitFromKg({ kg: d, out: join(d, "o"), modules: ["QOU"] })).toThrow(/overlay/);
  });
});

describe("signatureStyles", () => {
  test("signatureStylesScopedDropsLayout", () => {
    const css = `* { box-sizing: border-box; }\nbody { margin: 0 }\nnav { position: fixed }\n:root { --x: 1 }\n.decl_header { color: red }\nmain .fn, .impl_arg { color: blue }\n@media (prefers-color-scheme: dark) { :root { --x: 2 } nav { left: 0 } }`;
    const out = signatureStyles(css);
    expect(out).toContain(":root{ --x: 1 }");
    expect(out).toContain(".lkg-sig .decl_header");
    expect(out).toContain(".lkg-sig .impl_arg");
    expect(out).not.toMatch(/(^|[},\n])\s*(body|nav|\*)\s*\{/);
    expect(out).toContain("@media (prefers-color-scheme: dark){:root{ --x: 2 }}");
  });
});

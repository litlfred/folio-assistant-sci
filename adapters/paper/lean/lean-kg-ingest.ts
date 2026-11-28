#!/usr/bin/env bun
/**
 * lean-kg-ingest — turn doc-gen4's per-module declaration data into the
 * `lean` directory's knowledge-graph shards, which the dynamic Lean viewer
 * (`lean-kg-viewer/`) loads on demand.
 *
 * Owner, 2026-10-11: *"can we have it dynamically load from the KG instead of
 * static content?"* — option A (hybrid): doc-gen4 still ELABORATES (it is the
 * only thing that produces type-checked signatures with resolved links), but
 * its static HTML is no longer what is published. Its structured output,
 * `<lake-root>/.lake/build/doc-data/declaration-data-<Module>.bmp` (JSON,
 * despite the extension), is reshaped into graph nodes.
 *
 * ## Output (`--out <dir>`)
 *
 *   index.json                 modules: name, decl count, chunk count, content hash
 *   names.json                 [[declName, moduleIdx, kindIdx], …] for search; lazy-loaded
 *   m/<Module>.jsonld          one JSON-LD graph per module: the module node,
 *                              its `imports` edges, and one node per declaration
 *                              (name, kind, line, sourceLink, docstring,
 *                              `formalizes` edges to the content blocks whose
 *                              `lean.ref` names it, and the chunk holding its
 *                              rendered signature)
 *   m/<Module>.<k>.sig.json    rendered signature HTML, CHUNK_SIZE declarations
 *                              per chunk, links rewritten for the viewer
 *
 * Signatures are chunked because one module can be enormous: qou's
 * `QOU.BraidKnot.AllKnownIsotopesUniqueness` carries 12,804 declarations and
 * ~50 MB of signature HTML. The shard itself stays small enough to list the
 * module at once; the viewer fetches signature chunks as they scroll in.
 *
 * ## Incremental (branches/) mode
 *
 * `--base <dir-or-url of a published index.json's directory>` compares each
 * module's content hash with the base index and writes ONLY modules that
 * changed or are new, plus `overlay.json` naming the base and the changed set.
 * The viewer loads changed modules from the overlay and everything else from
 * the base, so a branch publishes kilobytes, not the whole graph.
 *
 * ## Links inside signatures
 *
 * doc-gen4 writes root-relative hrefs (`./Mathlib/Algebra/Field/Defs.html#Field`).
 * A link into a KEPT module root becomes a viewer route (`#/m/<Module>/<decl>`);
 * a link into a root `--sibling <package>/<Root>` names goes to that sibling
 * sub-KG's viewer, published beside this one (`../<package>/#/m/<Module>/<decl>`:
 * one sub-KG per Lake package, owner 2026-11-24); anything else goes to `--external-base` (default: the
 * community mathlib4 docs).
 *
 * ## Splitting a published KG (`splitFromKg`)
 *
 * A combined KG already published (the folio's Lean store) is cut into one
 * package's sub-KG with no Lean build: its shards are copied, its signature
 * routes into roots it no longer keeps are re-routed as above, and its index
 * and name list are rewritten. `lean-kg-publish.ts --from-kg` is the CLI. Same stated limit as lean-render.ts: the external docs are built from
 * their Mathlib, not the folio's pin.
 *
 * Exit 0 written; 2 usage or the input is not a doc-gen4 doc-data directory.
 *
 * @module folio-assistant-sci/adapters/paper/lean/lean-kg-ingest
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { DEFAULT_EXTERNAL_BASE } from "./lean-render.ts";

export const CHUNK_SIZE = 500;
export const KINDS = ["theorem", "def", "structure", "class", "instance", "inductive", "ctor", "axiom", "opaque", "other"] as const;

export interface DocGenDecl {
  header: string;
  info: { name: string; kind: string; doc?: string | null; docLink?: string; sourceLink?: string; line?: number };
}
export interface DocGenModule {
  name: string;
  imports: string[];
  declarations: DocGenDecl[];
  instances?: unknown[];
}

/** A content block that formalizes a declaration through its `lean.ref`. */
export interface BlockRef {
  label: string;
  /** Path of the block's `.md`, relative to the content root. */
  md: string;
}

/** `QOU/Mass/X.html#QOU.Mass.X.y` → `{ module: "QOU.Mass.X", frag: "QOU.Mass.X.y" }`, or undefined for non-module pages. */
export function moduleOfDocPath(path: string): { module: string; frag: string } | undefined {
  const m = /^\.?\/?([A-Z][^#?]*)\.html(?:#(.*))?$/.exec(path);
  if (!m) return undefined;
  return { module: m[1]!.split("/").join("."), frag: m[2] ?? "" };
}

/**
 * Where a link into ANOTHER package's sub-KG goes, by module root: lower-cased
 * root (`qou`, `massTheory` → `masstheory`) → the sibling viewer's page directory
 * (`../qou/`). Owner, 2026-11-24, "separate qou, UGB and Fred2005 into own lean
 * sub-KGs": a declaration Fred2005 imports from QOU is a cross-subgraph link to
 * the qou sub-KG, not a link to the community Mathlib docs.
 */
export type RootBases = ReadonlyMap<string, string>;

/**
 * Parse `--sibling <package>/<Root>[,<package>/<Root>…]` values into a
 * {@link RootBases}. Sub-KGs are published side by side (`<route>/<package>/`,
 * e.g. `lean/qou/`, `lean/ugb/`), so a root of package `p` is served by the
 * sibling viewer at `../p/`; the CLI names packages and roots only, never a
 * path, and every value is an id list.
 */
export function parseSiblings(values: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const v of values.flatMap((x) => x.split(","))) {
    const m = /^([a-z0-9][a-z0-9-]*)\/([A-Za-z0-9_]+)$/.exec(v.trim());
    if (!m) throw new Error(`--sibling takes <package>/<Root>[,…], got "${v}"`);
    out.set(m[2]!.toLowerCase(), `../${m[1]}/`);
  }
  return out;
}

/**
 * The href for a declaration of `module` (fragment `frag`, undecoded): a viewer
 * route when its root is kept here, the sibling sub-KG's viewer route when
 * `rootBases` names its root, else doc-gen4's page under `externalBase`.
 */
export function linkFor(module: string, frag: string, keepRoots: ReadonlySet<string>, externalBase: string, rootBases: RootBases = new Map()): string {
  const route = `#/m/${module}${frag ? `/${encodeURIComponent(frag)}` : ""}`;
  const root = module.split(".")[0]!.toLowerCase();
  if (keepRoots.has(root)) return route;
  const sibling = rootBases.get(root);
  if (sibling !== undefined) return `${sibling}${route}`;
  const base = externalBase.endsWith("/") ? externalBase : `${externalBase}/`;
  return `${base}${module.split(".").join("/")}.html${frag ? `#${frag}` : ""}`;
}

/** Rewrite doc-gen4's root-relative hrefs for the viewer. */
export function rewriteHeader(html: string, keepRoots: ReadonlySet<string>, externalBase: string, rootBases: RootBases = new Map()): string {
  const base = externalBase.endsWith("/") ? externalBase : `${externalBase}/`;
  return html.replace(/\bhref="([^"]*)"/g, (whole, href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return whole;
    const target = href.replace(/^\.\//, "");
    const mod = moduleOfDocPath(target);
    if (mod && (keepRoots.has(mod.module.split(".")[0]!.toLowerCase()) || rootBases.has(mod.module.split(".")[0]!.toLowerCase()))) {
      return `href="${linkFor(mod.module, mod.frag, keepRoots, externalBase, rootBases)}"`;
    }
    return `href="${base}${target}"`;
  });
}

/**
 * Re-route a signature chunk that is ALREADY in viewer form (a published KG's
 * `m/<Module>.<k>.sig.json`) for a sub-KG keeping only `keepRoots`: a route
 * `#/m/<Module>[/<frag>]` whose root is no longer kept goes to its sibling
 * sub-KG ({@link RootBases}) or, when no sibling is named, to `externalBase`.
 * Every other href is left as it is.
 */
export function rerouteSignature(html: string, keepRoots: ReadonlySet<string>, externalBase: string, rootBases: RootBases = new Map()): string {
  return html.replace(/\bhref="#\/m\/([^"/]+)(?:\/([^"]*))?"/g, (whole, module: string, frag: string | undefined) => {
    if (keepRoots.has(module.split(".")[0]!.toLowerCase())) return whole;
    let f = frag ?? "";
    try {
      f = decodeURIComponent(f);
    } catch {
      return whole;
    }
    return `href="${linkFor(module, f, keepRoots, externalBase, rootBases)}"`;
  });
}

/** A formalizes edge: the block, and whether its `lean.ref` names the declaration or the declaration sits in the block's own `.lean` sibling. */
export interface FormalizesEdge {
  "@id": string;
  label: string;
  md: string;
  via: "lean.ref" | "sibling";
}

/** The content blocks a Lean graph can link to, read once from the content tree. */
export interface ContentBlocks {
  /** `<Decl>` (the part of a `<pkg>:<Decl>` lean.ref after the package) → the blocks whose lean.ref names it. */
  byRef: Map<string, BlockRef[]>;
  /** Repository path of a block's `.lean` sibling (`<contentPrefix><md with .lean>`) → that block. */
  bySource: Map<string, BlockRef>;
}

/**
 * Read every block manifest under `contentRoot`: its `label`, its `lean.ref`
 * when it has one, and whether a `.lean` sibling sits beside it. `contentPrefix`
 * is the content root's path in the repository (`folio/`), so a declaration's
 * `sourceLink` path can be matched against the sibling's path.
 */
export function collectContentBlocks(contentRoot: string, contentPrefix = ""): ContentBlocks {
  const byRef = new Map<string, BlockRef[]>();
  const bySource = new Map<string, BlockRef>();
  const prefix = contentPrefix === "" || contentPrefix.endsWith("/") ? contentPrefix : `${contentPrefix}/`;
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "lean") continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".ts")) {
        const src = readFileSync(abs, "utf-8");
        const label = /\blabel:\s*"([^"]+)"/.exec(src);
        if (!label) continue;
        const md = relative(contentRoot, abs.replace(/\.ts$/, ".md")).split(sep).join("/");
        const block = { label: label[1]!, md };
        const ref = /\bref:\s*"[a-z0-9]+:([^"]+)"/.exec(src);
        if (ref) {
          const list = byRef.get(ref[1]!) ?? [];
          list.push(block);
          byRef.set(ref[1]!, list);
        }
        if (existsSync(abs.replace(/\.ts$/, ".lean"))) bySource.set(`${prefix}${md.replace(/\.md$/, ".lean")}`, block);
      }
    }
  };
  walk(contentRoot);
  return { byRef, bySource };
}

/** Map `<pkg>:<Decl>` lean.refs in the content tree to the blocks that carry them. */
export function collectLeanRefs(contentRoot: string): Map<string, BlockRef[]> {
  return collectContentBlocks(contentRoot).byRef;
}

/** The repository path in a doc-gen4 `sourceLink` (`https://github.com/o/r/blob/<ref>/<path>#L1-L9` → `<path>`). */
export function sourcePath(sourceLink: string | undefined): string | undefined {
  if (!sourceLink) return undefined;
  const m = /\/blob\/[^/]+\/([^#?]+)/.exec(sourceLink);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

interface GraphNode {
  "@type"?: string;
  name?: string;
  sourceLink?: string;
  formalizes?: FormalizesEdge[];
  block?: BlockRef;
}

/**
 * Link one module graph to the paper: each declaration gets a `formalizes`
 * edge to every block whose `lean.ref` names it AND to the block whose `.lean`
 * sibling holds it (owner, 2026-11-28: "lean rendering linked back to paper
 * references"); edges already on the nodes are replaced, so a stale store is
 * re-linked against the current content. The module node gets `block` when
 * every declaration with a source sits in one block's sibling. Mutates `graph`.
 */
export function attachBlocks(graph: GraphNode[], blocks: ContentBlocks): { formalized: number; block?: BlockRef } {
  let formalized = 0;
  const siblings = new Map<string, BlockRef | undefined>();
  let sourced = 0;
  for (const n of graph) {
    if (n["@type"] !== "LeanDeclaration" || !n.name) continue;
    const edges: FormalizesEdge[] = [];
    const seen = new Set<string>();
    const add = (b: BlockRef, via: FormalizesEdge["via"]): void => {
      if (seen.has(b.label)) return;
      seen.add(b.label);
      edges.push({ "@id": `block:${b.label}`, label: b.label, md: b.md, via });
    };
    for (const b of blocks.byRef.get(n.name) ?? []) add(b, "lean.ref");
    const path = sourcePath(n.sourceLink);
    if (path !== undefined) {
      sourced++;
      const sib = blocks.bySource.get(path);
      if (sib) {
        add(sib, "sibling");
        siblings.set(sib.label, sib);
      } else siblings.set("", undefined);
    }
    if (edges.length) {
      n.formalizes = edges;
      formalized++;
    } else delete n.formalizes;
  }
  const mod = graph.find((n) => n["@type"] === "LeanModule");
  const only = sourced > 0 && siblings.size === 1 ? [...siblings.values()][0] : undefined;
  const block: BlockRef | undefined = only ? { label: only.label, md: only.md } : undefined;
  if (mod) {
    if (block) mod.block = block;
    else delete mod.block;
  }
  return { formalized, ...(block ? { block } : {}) };
}

function sha12(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

export interface IngestOptions {
  docData: string;
  out: string;
  modules: readonly string[];
  contentRoot?: string;
  /** The content root's path in the repository (`folio/`), to match declarations to block siblings by `sourceLink`. */
  contentPrefix?: string;
  externalBase?: string;
  /** Sibling sub-KGs, by module root ({@link RootBases}). */
  rootBases?: RootBases;
  /** Directory (or URL) of a published base `index.json`; enables overlay mode. */
  base?: string;
  baseIndex?: IndexFile;
}

export interface IndexModule {
  name: string;
  decls: number;
  chunks: number;
  hash: string;
  /** The content block whose `.lean` sibling this module is, when it is one. */
  block?: BlockRef;
}
export interface IndexFile {
  schema: "folio-lean-kg/v1";
  chunkSize: number;
  modules: IndexModule[];
  kinds: readonly string[];
  totals: { modules: number; decls: number; formalized: number };
}

export interface IngestReport {
  modules: number;
  decls: number;
  formalized: number;
  written: number;
  unchanged: number;
  overlay: boolean;
}

/** Ingest every kept module's doc-data into graph shards under `out`. */
export function ingest(o: IngestOptions): IngestReport {
  const dir = resolve(o.docData);
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const keep = new Set(o.modules.map((m) => m.toLowerCase()));
  const files = readdirSync(dir).filter((f) => f.startsWith("declaration-data-") && f.endsWith(".bmp"));
  if (files.length === 0) throw new Error(`${dir}: no declaration-data-*.bmp files — not a doc-gen4 doc-data directory`);
  const blocks: ContentBlocks = o.contentRoot ? collectContentBlocks(resolve(o.contentRoot), o.contentPrefix) : { byRef: new Map(), bySource: new Map() };
  const externalBase = o.externalBase ?? DEFAULT_EXTERNAL_BASE;
  const baseHashes = new Map((o.baseIndex?.modules ?? []).map((m) => [m.name, m.hash]));
  const overlay = o.baseIndex !== undefined;

  const out = resolve(o.out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "m"), { recursive: true });

  const mods: DocGenModule[] = files
    .map((f) => f.slice("declaration-data-".length, -".bmp".length))
    .filter((name) => keep.size === 0 || keep.has(name.split(".")[0]!.toLowerCase()))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, `declaration-data-${name}.bmp`), "utf-8")) as DocGenModule);

  const index: IndexFile = { schema: "folio-lean-kg/v1", chunkSize: CHUNK_SIZE, modules: [], kinds: KINDS, totals: { modules: 0, decls: 0, formalized: 0 } };
  const names: [string, number, number][] = [];
  const report: IngestReport = { modules: 0, decls: 0, formalized: 0, written: 0, unchanged: 0, overlay };
  const changed: string[] = [];

  mods.forEach((mod, mi) => {
    const decls = mod.declarations;
    const chunks = Math.ceil(decls.length / CHUNK_SIZE);
    const nodes = decls.map((d, i) => {
      const k = (KINDS as readonly string[]).indexOf(d.info.kind);
      names.push([d.info.name, mi, k < 0 ? KINDS.length - 1 : k]);
      return {
        "@id": `lean:${d.info.name}`,
        "@type": "LeanDeclaration",
        name: d.info.name,
        kind: d.info.kind,
        ...(d.info.line !== undefined ? { line: d.info.line } : {}),
        ...(d.info.sourceLink ? { sourceLink: d.info.sourceLink } : {}),
        ...(d.info.doc ? { doc: d.info.doc } : {}),
        signatureChunk: Math.floor(i / CHUNK_SIZE),
      };
    });
    const graph: GraphNode[] = [{ "@id": `lean:module:${mod.name}`, "@type": "LeanModule", name: mod.name, imports: mod.imports.map((m) => `lean:module:${m}`), declarations: decls.length, chunks } as GraphNode, ...nodes];
    const linked = attachBlocks(graph, blocks);
    report.formalized += linked.formalized;
    const shard = { "@context": { lean: "lean:", block: "block:", imports: { "@type": "@id" } }, "@graph": graph };
    const sigChunks: string[][] = [];
    for (let c = 0; c < chunks; c++) sigChunks.push(decls.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE).map((d) => rewriteHeader(d.header, keep, externalBase, o.rootBases)));
    const shardText = JSON.stringify(shard);
    const sigText = sigChunks.map((s) => JSON.stringify(s));
    const hash = sha12(shardText + sigText.join("\n"));
    index.modules.push({ name: mod.name, decls: decls.length, chunks, hash, ...(linked.block ? { block: linked.block } : {}) });
    report.modules++;
    report.decls += decls.length;
    if (overlay && baseHashes.get(mod.name) === hash) {
      report.unchanged++;
      return;
    }
    changed.push(mod.name);
    writeFileSync(join(out, "m", `${mod.name}.jsonld`), shardText);
    sigText.forEach((s, c) => writeFileSync(join(out, "m", `${mod.name}.${c}.sig.json`), s));
    report.written++;
  });

  index.totals = { modules: report.modules, decls: report.decls, formalized: report.formalized };
  writeFileSync(join(out, "index.json"), JSON.stringify(index));
  writeFileSync(join(out, "names.json"), JSON.stringify(names));
  if (overlay) {
    const removed = [...baseHashes.keys()].filter((n) => !index.modules.some((m) => m.name === n));
    writeFileSync(join(out, "overlay.json"), JSON.stringify({ schema: "folio-lean-kg-overlay/v1", base: o.base, changed, removed }));
  }
  return report;
}

export interface SplitOptions {
  /** A published KG's `data/` directory: `index.json`, `names.json`, `m/`. */
  kg: string;
  out: string;
  /** Module roots this sub-KG keeps (`QOU`, `MassTheory`, …). Must not be empty. */
  modules: readonly string[];
  externalBase?: string;
  rootBases?: RootBases;
  /** Re-link every declaration to the current content blocks ({@link attachBlocks}); without it the store's own edges are kept. */
  blocks?: ContentBlocks;
}

/**
 * One package's sub-KG cut out of an already-published combined KG, with no
 * Lean build and no doc-gen4 run (owner, 2026-11-24: "separate qou, UGB and
 * Fred2005 into own lean sub-KGs"). The published render is the folio's Lean
 * store (`lean-html-docs`, kept on a branch and mounted), so a site build can
 * split it per package where it could not run doc-gen4.
 *
 * Keeps the modules whose root is in `modules`; copies their shards as they
 * are; re-routes each signature chunk with {@link rerouteSignature}, so a link
 * into a module this sub-KG no longer holds goes to its sibling sub-KG or to
 * the external docs instead of a route that would not resolve; and writes a
 * fresh `index.json` (hashes over the written text) and `names.json`
 * (module indices renumbered). An overlay or a stale index is refused: the
 * split reads only a complete graph.
 */
export function splitFromKg(o: SplitOptions): IngestReport {
  const kg = resolve(o.kg);
  const idxPath = join(kg, "index.json");
  if (!existsSync(idxPath)) throw new Error(`${kg}: no index.json — not a published Lean KG data directory`);
  if (existsSync(join(kg, "overlay.json"))) throw new Error(`${kg}: an overlay (overlay.json) is not a complete graph; split its base`);
  const src = JSON.parse(readFileSync(idxPath, "utf-8")) as IndexFile;
  if (src.schema !== "folio-lean-kg/v1" || !Array.isArray(src.modules)) throw new Error(`${idxPath}: not a folio-lean-kg/v1 index`);
  const names = JSON.parse(readFileSync(join(kg, "names.json"), "utf-8")) as [string, number, number][];
  const keep = new Set(o.modules.map((m) => m.toLowerCase()));
  if (keep.size === 0) throw new Error("splitFromKg: name the module roots this sub-KG keeps");
  const externalBase = o.externalBase ?? DEFAULT_EXTERNAL_BASE;
  const chunkSize = src.chunkSize ?? CHUNK_SIZE;

  const out = resolve(o.out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "m"), { recursive: true });

  const index: IndexFile = { schema: "folio-lean-kg/v1", chunkSize, modules: [], kinds: src.kinds ?? KINDS, totals: { modules: 0, decls: 0, formalized: 0 } };
  const report: IngestReport = { modules: 0, decls: 0, formalized: 0, written: 0, unchanged: 0, overlay: false };
  const newIdx = new Map<number, number>();
  src.modules.forEach((m, i) => {
    if (!keep.has(m.name.split(".")[0]!.toLowerCase())) return;
    const shardFile = join(kg, "m", `${m.name}.jsonld`);
    if (!existsSync(shardFile)) throw new Error(`${shardFile}: listed in index.json but absent`);
    let shardText = readFileSync(shardFile, "utf-8");
    const shard = JSON.parse(shardText) as { "@graph"?: GraphNode[] };
    let block: BlockRef | undefined;
    if (o.blocks) {
      const linked = attachBlocks(shard["@graph"] ?? [], o.blocks);
      report.formalized += linked.formalized;
      block = linked.block;
      shardText = JSON.stringify(shard);
    } else {
      report.formalized += (shard["@graph"] ?? []).filter((n) => n["@type"] === "LeanDeclaration" && Array.isArray(n.formalizes) && n.formalizes.length > 0).length;
      block = (shard["@graph"] ?? []).find((n) => n["@type"] === "LeanModule")?.block;
    }
    const sigText: string[] = [];
    for (let c = 0; c < m.chunks; c++) {
      const f = join(kg, "m", `${m.name}.${c}.sig.json`);
      if (!existsSync(f)) throw new Error(`${f}: listed in index.json but absent`);
      const sigs = JSON.parse(readFileSync(f, "utf-8")) as string[];
      sigText.push(JSON.stringify(sigs.map((h) => rerouteSignature(h, keep, externalBase, o.rootBases))));
    }
    writeFileSync(join(out, "m", `${m.name}.jsonld`), shardText);
    sigText.forEach((t, c) => writeFileSync(join(out, "m", `${m.name}.${c}.sig.json`), t));
    newIdx.set(i, index.modules.length);
    index.modules.push({ name: m.name, decls: m.decls, chunks: m.chunks, hash: sha12(shardText + sigText.join("\n")), ...(block ? { block } : {}) });
    report.modules++;
    report.decls += m.decls;
    report.written++;
  });
  index.totals = { modules: report.modules, decls: report.decls, formalized: report.formalized };
  const kept = names.flatMap(([n, mi, k]) => (newIdx.has(mi) ? [[n, newIdx.get(mi)!, k] as [string, number, number]] : []));
  writeFileSync(join(out, "index.json"), JSON.stringify(index));
  writeFileSync(join(out, "names.json"), JSON.stringify(kept));
  return report;
}

async function loadBaseIndex(base: string): Promise<IndexFile> {
  const url = base.replace(/\/+$/, "") + "/index.json";
  if (/^https?:/.test(url)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return (await r.json()) as IndexFile;
  }
  return JSON.parse(readFileSync(url, "utf-8")) as IndexFile;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const at = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const docData = at("--doc-data");
  const out = at("--out");
  if (!docData || !out) {
    console.error("usage: lean-kg-ingest.ts --doc-data <lake>/.lake/build/doc-data --out <dir> [--modules QOU,UGB] [--module <root>]... [--content-root <dir> [--content-prefix <p>]] [--external-base <url>] [--sibling <package>/<Root>[,…]]... [--base <dir|url>]");
    return 2;
  }
  const modules = [...(at("--modules")?.split(",") ?? []), ...argv.flatMap((a, i) => (a === "--module" && argv[i + 1] ? [argv[i + 1]!] : []))]
    .map((s) => s.trim())
    .filter(Boolean);
  const base = at("--base");
  try {
    const rootBases = parseSiblings(argv.flatMap((a, i) => (a === "--sibling" && argv[i + 1] ? [argv[i + 1]!] : [])));
    const r = ingest({ docData, out, modules, contentRoot: at("--content-root"), contentPrefix: at("--content-prefix"), externalBase: at("--external-base"), rootBases, base, baseIndex: base ? await loadBaseIndex(base) : undefined });
    console.log(
      `lean-kg-ingest: ${r.modules} module(s), ${r.decls} declaration(s), ${r.formalized} formalizing a content block; ` +
        (r.overlay ? `overlay: ${r.written} changed, ${r.unchanged} unchanged against the base` : `${r.written} shard(s) written`),
    );
    return 0;
  } catch (e) {
    console.error(`? ${(e as Error).message}`);
    return 2;
  }
}

if (import.meta.main) process.exit(await main());

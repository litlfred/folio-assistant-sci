#!/usr/bin/env bun
/**
 * lean-verso-render — render a harnessed folio's Lean library with Verso, as a
 * blueprint-shaped HTML site: one page per Lean module, one Verso `docstring`
 * block per declaration a content block's `lean.ref` names, each linked back to
 * the block that it formalizes.
 *
 * Owner, 2026-11-24: *"Verso & Verso Blueprint. should be a fol-ass-sci tool
 * to render lean libary in a harnessed repo"*. Same day: *"KG viewer graph is
 * more than just lean"* — the KG viewer (cat-harness `kg-viewer`) is the
 * harness's general graph viewer; this tool is the LEAN LIBRARY renderer and
 * does not fold into it. The two link to each other rather than one replacing
 * the other: Verso writes `xref.json` beside the site, mapping each rendered
 * declaration to its page and anchor (`QOU.X.y` → `/QOU___X/#QOU___X___y`;
 * a dot becomes `___`), which is what a KG node for that declaration can link
 * to, and each rendered declaration links back to its content block. Wiring
 * the KG side is a follow-up, not done here.
 *
 * ## Two engines, chosen by the folio's toolchain
 *
 * - **Verso Blueprint** (`leanprover/verso-blueprint`) has release branches for
 *   Lean v4.28.0 to v4.35.0 only. A folio on one of those toolchains should use
 *   it (`engine: verso-blueprint`): it tracks progress, `sorry`, dependency
 *   graphs. Not runnable on v4.24.0 — see {@link engineFor}.
 * - **Verso Manual** (`leanprover/verso`, tags v4.10.0 onward, so v4.24.0 is
 *   covered). This script's engine: it generates a Verso Manual document whose
 *   `{docstring X}` blocks are elaborated against the folio's OWN oleans, so a
 *   signature is highlighted from the folio's pinned Mathlib, not from the
 *   community's.
 *
 * ## Never `lake build` the library
 *
 * The document is compiled `lean`-direct against a `LEAN_PATH` of restored
 * oleans (skill `lean-cache-restore`) plus Verso's own build. Verso is a small
 * package (52 Lake jobs at v4.24.0) and is the only thing built. The folio's
 * library and Mathlib are only READ, so the restored cache is never evicted.
 *
 * ## Which module holds a declaration
 *
 * A `lean.ref` names a declaration, not its module, and Verso needs the module
 * imported. The module comes from the `.ilean` files beside the oleans: each
 * reference key is `{"c":{"m":<module>,"n":<name>}}`, so the restored cache
 * already answers "where is X defined" with no doc-gen4 run and no build
 * ({@link indexIleans}).
 *
 * ## Usage
 *
 *   bun run folio-assistant-sci/adapters/paper/lean/lean-verso-render.ts \
 *     --content-root folio/quantum-observable-universe \
 *     --lean-path <lake-root>/.lake/build/lib/lean --lean-path <mathlib>/.lake/build/lib/lean \
 *     --verso <verso checkout, built> --module QOU --work /tmp/verso-work \
 *     --site _site [--route verso] [--chapter braids-and-knots] [--limit 40]
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { collectLeanRefs, type BlockRef } from "./lean-kg-ingest";
import { findPlatform, runRail } from "./lean-render";

/** Lean toolchains with a `leanprover/verso-blueprint` release branch (measured 2026-11-24). */
export const VERSO_BLUEPRINT_TOOLCHAINS = ["v4.28.0", "v4.29.0", "v4.30.0", "v4.31.0", "v4.32.0", "v4.33.0", "v4.34.0", "v4.35.0"] as const;
/** First stable Lean toolchain with a `leanprover/verso` tag (measured 2026-11-24). */
export const VERSO_MIN_TOOLCHAIN = "v4.10.0";

/** `leanprover/lean4:v4.24.0` (or `v4.24.0`) → `[4, 24, 0]`; undefined for nightlies and rcs. */
export function parseToolchain(tc: string): [number, number, number] | undefined {
  const m = /(?:^|:)v(\d+)\.(\d+)\.(\d+)$/.exec(tc.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

function cmp(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

export type Engine = "verso-blueprint" | "verso-manual" | "none";

/**
 * Which engine a folio on `toolchain` can use, and the Verso ref to pin.
 * Verso tags each release `v<lean>` (patch tags `-patch1` also exist); Verso
 * Blueprint keeps one branch per supported release.
 */
export function engineFor(toolchain: string): { engine: Engine; versoRef?: string; reason: string } {
  const v = parseToolchain(toolchain);
  if (!v) return { engine: "none", reason: `${toolchain}: not a stable release; Verso tags stable releases only` };
  const tag = `v${v.join(".")}`;
  if ((VERSO_BLUEPRINT_TOOLCHAINS as readonly string[]).includes(tag)) {
    return { engine: "verso-blueprint", versoRef: tag, reason: `verso-blueprint has branch ${tag}` };
  }
  if (cmp(v, parseToolchain(VERSO_MIN_TOOLCHAIN)!) >= 0) {
    return { engine: "verso-manual", versoRef: tag, reason: `no verso-blueprint branch for ${tag} (it supports ${VERSO_BLUEPRINT_TOOLCHAINS[0]}..${VERSO_BLUEPRINT_TOOLCHAINS.at(-1)}); verso has tag ${tag}` };
  }
  return { engine: "none", reason: `${tag} predates Verso's first tag ${VERSO_MIN_TOOLCHAIN}` };
}

/** Parse one `.ilean` file's text into `name → defining module` pairs. */
export function ileanDecls(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let parsed: { references?: Record<string, unknown> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  for (const key of Object.keys(parsed.references ?? {})) {
    if (!key.startsWith('{"c"')) continue;
    try {
      const k = JSON.parse(key) as { c?: { m?: string; n?: string } };
      if (k.c?.m && k.c.n) out.push([k.c.n, k.c.m]);
    } catch {
      /* not a constant key */
    }
  }
  return out;
}

/** `name → defining module`, plus the set of module names seen (a `lean.ref` may name a module). */
export type IleanIndex = Map<string, string> & {
  modules?: Set<string>;
  /** name → every module that DEFINES it (its own `.ilean` keys it under its own module). */
  definers?: Map<string, Set<string>>;
  /** module → its direct imports, from `.ilean` `directImports`. */
  deps?: Map<string, string[]>;
};

/** Index every `.ilean` under `dirs`: declaration name → defining module. */
export function indexIleans(dirs: readonly string[], keepRoots?: ReadonlySet<string>): IleanIndex {
  const index: IleanIndex = new Map<string, string>();
  index.modules = new Set<string>();
  index.definers = new Map();
  index.deps = new Map();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".ilean")) {
        // An ilean without its olean cannot be imported: a build in progress
        // (measured 2026-11-24, a concurrent rebuild on a shared host) or a
        // partial restore. Indexing it would plan an import that fails.
        if (!existsSync(abs.replace(/\.ilean$/, ".olean"))) continue;
        const text = readFileSync(abs, "utf-8");
        const mod = /"module":"([^"]+)"/.exec(text)?.[1];
        if (!mod || (keepRoots && !keepRoots.has(mod.split(".")[0]!))) continue;
        index.modules!.add(mod);
        try {
          const di = (JSON.parse(text) as { directImports?: unknown[] }).directImports ?? [];
          index.deps!.set(mod, di.map((d) => (Array.isArray(d) ? String(d[0]) : String(d))));
        } catch {
          /* unparsable: no deps recorded */
        }
        for (const [n, m] of ileanDecls(text)) {
          if (m !== mod) continue; // a usage of another module's constant: that module's own ilean records it
          const set = index.definers!.get(n) ?? new Set<string>();
          set.add(mod);
          index.definers!.set(n, set);
          if (!index.has(n)) index.set(n, m);
        }
      }
    }
  };
  for (const d of dirs) if (existsSync(d)) walk(d);
  return index;
}

/** `module` and everything it imports transitively that the index knows. */
export function importClosure(module: string, deps: Map<string, string[]>, memo = new Map<string, Set<string>>()): Set<string> {
  const hit = memo.get(module);
  if (hit) return hit;
  const out = new Set<string>([module]);
  memo.set(module, out); // cycles cannot occur in Lean imports; this guards a malformed index
  for (const d of deps.get(module) ?? []) if (deps.has(d)) for (const x of importClosure(d, deps, memo)) out.add(x);
  return out;
}

/**
 * Pick, in order, the modules one Lean environment can import together. A
 * folio's library need not be importable as a whole: qou's is not, because two
 * modules define the same name (measured 2026-11-24: `QOU.Archimedean.
 * NuclearConfig` in both `TransferMatrix` and `skein_finiteness_bound`), and
 * Lean refuses the second import. A module is skipped when its import closure
 * would bring a second definer of a name already defined in the environment.
 */
export function compatibleModules(modules: readonly string[], index: IleanIndex): { kept: string[]; skipped: Array<{ module: string; name: string; clashesWith: string }> } {
  const deps = index.deps ?? new Map();
  const memo = new Map<string, Set<string>>();
  const owner = new Map<string, string>(); // duplicated name → module already in the environment defining it
  const dupNames = new Map<string, string[]>(); // module → names it defines that some other module also defines
  for (const [n, ms] of index.definers ?? []) if (ms.size > 1) for (const m of ms) dupNames.set(m, [...(dupNames.get(m) ?? []), n]);
  const inEnv = new Set<string>();
  const kept: string[] = [];
  const skipped: Array<{ module: string; name: string; clashesWith: string }> = [];
  for (const m of modules) {
    const add = [...importClosure(m, deps, memo)].filter((x) => !inEnv.has(x));
    let clash: { name: string; clashesWith: string } | undefined;
    const local = new Map<string, string>();
    for (const x of add) {
      for (const n of dupNames.get(x) ?? []) {
        const other = owner.get(n) ?? local.get(n);
        if (other && other !== x) clash = { name: n, clashesWith: other };
        local.set(n, x);
      }
      if (clash) break;
    }
    if (clash) {
      skipped.push({ module: m, ...clash });
      continue;
    }
    for (const x of add) inEnv.add(x);
    for (const [n, x] of local) owner.set(n, x);
    kept.push(m);
  }
  return { kept, skipped };
}

export interface PlanEntry {
  decl: string;
  module: string;
  blocks: BlockRef[];
}

export interface Plan {
  /** Modules to import, sorted. */
  imports: string[];
  /** Entries grouped by module, modules and declarations sorted. */
  byModule: Map<string, PlanEntry[]>;
  /** `lean.ref`s that name a MODULE rather than a declaration: module → the blocks. */
  moduleRefs: Map<string, BlockRef[]>;
  /** Modules left out because importing them beside the kept ones would redefine a name ({@link compatibleModules}). */
  skipped: Array<{ module: string; name: string; clashesWith: string; decls: string[] }>;
  /** `lean.ref`s naming neither a declaration nor a module any `.ilean` knows (not built, renamed, or a content-block sibling). */
  unresolved: string[];
}

/**
 * Pick the declarations to render. `chapter` keeps blocks whose `.md` path
 * starts with it; `limit` caps the declaration count (largest-first by module
 * would bias the sample, so it is name order).
 */
export function planRender(refs: Map<string, BlockRef[]>, index: IleanIndex, o: { chapter?: string; limit?: number } = {}): Plan {
  const byModule = new Map<string, PlanEntry[]>();
  const moduleRefs = new Map<string, BlockRef[]>();
  const unresolved: string[] = [];
  let n = 0;
  for (const decl of [...refs.keys()].sort()) {
    const blocks = refs.get(decl)!.filter((b) => !o.chapter || b.md.startsWith(`${o.chapter}/`));
    if (!blocks.length) continue;
    if (index.modules?.has(decl) && !index.has(decl)) {
      moduleRefs.set(decl, blocks);
      continue;
    }
    const module = index.get(decl);
    if (!module) {
      unresolved.push(decl);
      continue;
    }
    if (o.limit !== undefined && n >= o.limit) break;
    n++;
    const list = byModule.get(module) ?? [];
    list.push({ decl, module, blocks });
    byModule.set(module, list);
  }
  const { kept, skipped } = compatibleModules([...byModule.keys()].sort(), index);
  const imports = kept;
  return {
    imports,
    byModule: new Map(imports.map((m) => [m, byModule.get(m)!])),
    moduleRefs,
    skipped: skipped.map((s) => ({ ...s, decls: byModule.get(s.module)!.map((e) => e.decl) })),
    unresolved,
  };
}

/** Verso inline text: escape the characters Verso's markup reads. */
export function versoText(s: string): string {
  return s.replace(/[\\*_`[\]{}$#|]/g, (c) => `\\${c}`);
}

export interface DocOptions {
  title: string;
  /** Lean module name of the generated document, e.g. `FolioVerso`. */
  docModule: string;
  /** `https://github.com/<repo>/blob/<ref>/<contentPrefix>/` — block links resolve against it. */
  blockBase?: string;
}

/** The Verso Manual document for a plan. Pure: same plan, same bytes. */
export function generateVersoDoc(plan: Plan, o: DocOptions): string {
  const link = (b: BlockRef): string => (o.blockBase ? `[${versoText(b.label)}](${o.blockBase}${b.md})` : versoText(b.label));
  const L: string[] = [];
  L.push("import VersoManual");
  for (const m of plan.imports) L.push(`import ${m}`);
  L.push("", "open Verso.Genre Manual", "", "set_option verso.docstring.allowMissing true", "set_option maxHeartbeats 0", "");
  L.push(`#doc (Manual) ${JSON.stringify(o.title)} =>`, "%%%", 'authors := ["generated by folio-assistant-sci lean-verso-render"]', "%%%", "");
  L.push(
    `This site renders ${[...plan.byModule.values()].reduce((a, e) => a + e.length, 0)} declarations from ${plan.imports.length} modules: each one a content block's formal statement, elaborated with Verso against the folio's own oleans.`,
    "",
  );
  for (const [module, entries] of plan.byModule) {
    // No `%%%` part metadata: with qou's 486 modules imported, `{ tag := … }`
    // stopped elaborating at the 13th part ("invalid {...} notation, expected
    // type is not of the form (C ...)"), measured 2026-11-24; Verso's own ids suffice.
    L.push(`# ${versoText(module)}`, "");
    const whole = plan.moduleRefs.get(module);
    if (whole?.length) L.push(`The whole module is the formal side of ${whole.map(link).join(", ")}.`, "");
    for (const e of entries) {
      L.push(`Formalizes ${e.blocks.map(link).join(", ")}.`, "", `{docstring ${e.decl}}`, "");
    }
  }
  return L.join("\n");
}

/** The generator's `main`, which `lean --run` interprets. */
export function generateMain(docModule: string): string {
  return [`import VersoManual`, `import ${docModule}`, "", "open Verso.Genre Manual", "", `def main := manualMain (%doc ${docModule})`, ""].join("\n");
}

/** Verso's own build directories, plus its Lake dependencies'. */
export function versoLeanPath(verso: string): string[] {
  const dirs = [join(verso, ".lake", "build", "lib", "lean")];
  const pk = join(verso, ".lake", "packages");
  if (existsSync(pk)) for (const p of readdirSync(pk)) dirs.push(join(pk, p, ".lake", "build", "lib", "lean"));
  return dirs.filter((d) => existsSync(d));
}

/**
 * Native libraries Verso's dependencies precompile (MD4Lean's markdown parser
 * is C: `MD4Lean.parse` is an `extern`). Elaborating a document calls it, so a
 * `lean`-direct run must `--load-dynlib` them, as Lake does for a
 * `precompileModules` package. Plain C libraries first, then Lean module libs.
 */
export function versoDynlibs(verso: string): string[] {
  const out: string[] = [];
  const pk = join(verso, ".lake", "packages");
  const dirs = [join(verso, ".lake", "build", "lib"), ...(existsSync(pk) ? readdirSync(pk).map((p) => join(pk, p, ".lake", "build", "lib")) : [])];
  for (const d of dirs) if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith(".so")) out.push(join(d, f));
  return out.sort((a, b) => Number(/\/lib[A-Z]/.test(a)) - Number(/\/lib[A-Z]/.test(b)) || a.localeCompare(b));
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
function args(argv: string[], flag: string): string[] {
  return argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]!] : []));
}

function main(): number {
  const argv = process.argv.slice(2);
  const contentRoot = arg(argv, "--content-root");
  const verso = arg(argv, "--verso");
  const work = resolve(arg(argv, "--work") ?? "_verso-work");
  const leanPath = args(argv, "--lean-path").map((p) => resolve(p));
  const modules = args(argv, "--module");
  const toolchain = arg(argv, "--toolchain");
  if (!contentRoot || !verso || !leanPath.length) {
    console.error("usage: lean-verso-render --content-root <dir> --verso <built verso> --lean-path <dir>... [--module QOU] [--chapter c] [--limit n] [--work dir] [--site _site --route verso] [--toolchain v4.24.0]");
    return 2;
  }
  if (toolchain) {
    const e = engineFor(toolchain);
    console.log(`engine: ${e.engine} — ${e.reason}`);
    if (e.engine === "none") return 1;
  }
  const limitArg = arg(argv, "--limit");
  const t0 = Date.now();
  const index = indexIleans(leanPath, modules.length ? new Set(modules) : undefined);
  const plan = planRender(collectLeanRefs(resolve(contentRoot)), index, { chapter: arg(argv, "--chapter"), limit: limitArg ? Number(limitArg) : undefined });
  const count = [...plan.byModule.values()].reduce((a, e) => a + e.length, 0);
  console.log(`index: ${index.size} declarations, ${index.modules?.size ?? 0} modules; plan: ${count} declarations in ${plan.imports.length} modules; ${plan.moduleRefs.size} lean.refs name a module (rendered as a note on that module's page when it is imported); ${plan.unresolved.length} lean.refs unresolved (${Date.now() - t0} ms)`);
  if (!count) return 1;

  const docModule = "FolioVerso";
  const repo = arg(argv, "--repo");
  const blockBase = repo ? `https://github.com/${repo}/blob/${arg(argv, "--ref") ?? "main"}/${arg(argv, "--content-prefix") ?? ""}${arg(argv, "--content-prefix") ? "/" : ""}` : undefined;
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, `${docModule}.lean`), generateVersoDoc(plan, { title: arg(argv, "--title") ?? "Lean library", docModule, blockBase }));
  writeFileSync(join(work, "Main.lean"), generateMain(docModule));
  // Verso's generator looks for a `lean-toolchain` above its working directory
  // and exits 1 without one ("No 'lean-toolchain' found in a parent directory").
  const tcv = parseToolchain(toolchain ?? "");
  const tcLine = tcv ? `leanprover/lean4:v${tcv.join(".")}` : readFileSync(join(resolve(verso), "lean-toolchain"), "utf-8").trim();
  writeFileSync(join(work, "lean-toolchain"), `${tcLine}\n`);
  writeFileSync(join(work, "unresolved.txt"), plan.unresolved.join("\n") + "\n");
  writeFileSync(join(work, "skipped.json"), JSON.stringify(plan.skipped, null, 2) + "\n");
  if (plan.skipped.length) console.log(`skipped ${plan.skipped.length} modules whose import would redefine a name (see ${join(work, "skipped.json")})`);

  const env = { ...process.env, LEAN_PATH: [work, ...versoLeanPath(resolve(verso)), ...leanPath].join(":") };
  const lean = process.env.LEAN ?? "lean";
  const dyn = versoDynlibs(resolve(verso)).map((so) => `--load-dynlib=${so}`);
  const t1 = Date.now();
  execFileSync("nice", ["-n", "15", lean, ...dyn, "-DautoImplicit=false", "-s", "65536", "-o", join(work, `${docModule}.olean`), join(work, `${docModule}.lean`)], { env, stdio: "inherit", cwd: work });
  console.log(`elaborated ${docModule} in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  const out = join(work, "_out");
  rmSync(out, { recursive: true, force: true });
  const t2 = Date.now();
  execFileSync("nice", ["-n", "15", lean, ...dyn, "--run", join(work, "Main.lean"), "--output", out, "--without-html-single"], { env, stdio: "inherit", cwd: work });
  console.log(`rendered HTML in ${((Date.now() - t2) / 1000).toFixed(1)} s → ${join(out, "html-multi")}`);

  const site = arg(argv, "--site");
  if (site) {
    const dest = join(resolve(site), arg(argv, "--route") ?? "verso");
    rmSync(dest, { recursive: true, force: true });
    cpSync(join(out, "html-multi"), dest, { recursive: true });
    console.log(`staged → ${dest}`);
    if (!argv.includes("--no-rail")) {
      const platform = findPlatform(arg(argv, "--platform"));
      if (!platform || !runRail(platform, site, arg(argv, "--home-label"), arg(argv, "--instance"))) return 1;
    }
  }
  return 0;
}

if (import.meta.main) process.exit(main());

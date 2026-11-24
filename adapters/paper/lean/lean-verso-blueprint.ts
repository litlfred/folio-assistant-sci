/**
 * The Verso Blueprint engine of `lean-verso-render`, for folios on a Lean
 * toolchain that `leanprover/verso-blueprint` has a release branch for
 * (v4.28.0 to v4.35.0, measured 2026-11-24).
 *
 * Owner, 2026-11-24: *"upgrade lean and do verso"* (qou moves to v4.35.0),
 * *"separate qou, UGB and Fred2005 into own lean sub-KGs"* (one site per Lake
 * package: `/verso/qou/`, `/verso/ugb/`, `/verso/fred2005/`, each with its own
 * `xref.json`), *"use lean cache, build iteratively"*.
 *
 * For each Lake package this writes a small Lake workspace: a `lakefile.lean`
 * requiring Verso Blueprint (pinned) and the folio's package BY PATH, a
 * generated Blueprint document with one node per content block whose
 * `lean.ref` names a declaration of that package, and the conventional
 * generator file, so upstream's own `lake exe vbp build` renders it. A node
 * carries `(lean := "<Decl>")`, which is what gives Verso Blueprint its
 * progress state (`sorry` detection, "formalized"); the block's `uses[]`
 * become `(uses := …)`, which is what draws its dependency graph.
 *
 * The workspaces share one `.lake/packages` directory, so Verso Blueprint and
 * its dependencies are cloned and built once, and the folio's package is
 * built from its own restored cache (Lake reuses traced oleans; it never
 * builds Mathlib when the restored tree is traced).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Verso Blueprint pin (owner, 2026-11-24): branch v4.35.0 at this commit. */
export const VERSO_BLUEPRINT_REPO = "https://github.com/leanprover/verso-blueprint";
export const VERSO_BLUEPRINT_REV = "509987ac41aac6db241e26cf39b482c11055c268";

/** A content block that names a Lean declaration, with what a Blueprint node needs. */
export interface BlueprintBlock {
  /** Lake package prefix of the `lean.ref` (`qou`, `ugb`, `fred2005`). */
  pkg: string;
  decl: string;
  label: string;
  kind: string;
  title: string;
  uses: string[];
  /** The block's `.md`, relative to the content root. */
  md: string;
}

/** Read every block manifest (`.ts`) under `root` that carries a `lean.ref`. */
export function collectBlueprintBlocks(root: string): BlueprintBlock[] {
  const out: BlueprintBlock[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "lean") continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".ts")) {
        const b = parseBlockManifest(readFileSync(abs, "utf-8"));
        if (b) out.push({ ...b, md: relative(root, abs.replace(/\.ts$/, ".md")).split(sep).join("/") });
      }
    }
  };
  walk(root);
  return out;
}

/** The fields a Blueprint node needs from one block manifest's source, or undefined. */
export function parseBlockManifest(src: string): Omit<BlueprintBlock, "md"> | undefined {
  const ref = /\bref:\s*"([a-z0-9]+):([^"]+)"/.exec(src);
  const label = /\blabel:\s*"([^"]+)"/.exec(src);
  if (!ref || !label) return undefined;
  const kind = /\bkind:\s*"([a-z]+)"/.exec(src)?.[1] ?? /\b(definition|theorem|lemma|proposition|corollary|conjecture|example|remark)\s*\(/.exec(src)?.[1] ?? "proposition";
  const title = /\btitle:\s*"((?:[^"\\]|\\.)*)"/.exec(src)?.[1]?.replace(/\\(.)/g, "$1") ?? label[1]!;
  const usesSrc = /\buses:\s*\[([^\]]*)\]/.exec(src)?.[1] ?? "";
  const uses = [...usesSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  return { pkg: ref[1]!, decl: ref[2]!, label: label[1]!, kind, title, uses };
}

/** A Blueprint label: content labels (`def:foo-bar`) kept readable but restricted to `[a-z0-9_-]`. */
export function blueprintLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

/** Verso Blueprint's directive for a block kind (`lemma` is spelt `lemma_`). Kinds it lacks render as propositions. */
export function directiveFor(kind: string): string {
  switch (kind) {
    case "definition":
      return "definition";
    case "theorem":
      return "theorem";
    case "lemma":
      return "lemma_";
    case "corollary":
      return "corollary";
    default:
      return "proposition";
  }
}

/** Block title as Verso text: `$x$` → `` $`x` ``, and Verso's markup characters escaped outside math. */
export function versoInline(s: string): string {
  return s
    .split(/(\$[^$]+\$)/)
    .map((part) => (/^\$[^$]+\$$/.test(part) ? `$\`${part.slice(1, -1)}\`` : part.replace(/[\\*_`[\]{}#|]/g, (c) => `\\${c}`)))
    .join("");
}

export interface BlueprintDocOptions {
  title: string;
  /** Lean module of the generated document. */
  docModule: string;
  /** Library modules to import (each holds at least one node's declaration). */
  imports: readonly string[];
  /** `https://github.com/<repo>/blob/<ref>/<prefix>/` for block links. */
  blockBase?: string;
}

/**
 * One package's Blueprint document. Nodes are grouped by the Lean module that
 * defines their declaration; `uses` keep only labels that are nodes here, so
 * every edge of the graph resolves. Pure: same input, same bytes.
 */
export function generateBlueprintDoc(byModule: ReadonlyMap<string, readonly BlueprintBlock[]>, o: BlueprintDocOptions): string {
  const present = new Set([...byModule.values()].flat().map((b) => blueprintLabel(b.label)));
  const L: string[] = ["import Verso", "import VersoManual", "import VersoBlueprint", "import VersoBlueprint.Commands.Graph", "import VersoBlueprint.Commands.Summary"];
  for (const m of o.imports) L.push(`import ${m}`);
  L.push("", "open Verso.Genre", "open Verso.Genre.Manual", "open Informal", "");
  L.push(`#doc (Manual) ${JSON.stringify(o.title)} =>`, "");
  const n = [...byModule.values()].reduce((a, e) => a + e.length, 0);
  L.push(`One node per content block whose formal statement is a declaration of this package: ${n} nodes from ${byModule.size} modules. Generated by folio-assistant-sci \`lean-verso-render\`.`, "");
  for (const [module, blocks] of byModule) {
    L.push(`# ${versoInline(module)}`, "");
    for (const b of blocks) {
      const id = blueprintLabel(b.label);
      const uses = [...new Set(b.uses.map(blueprintLabel))].filter((u) => u !== id && present.has(u));
      const opts = [`(lean := ${JSON.stringify(b.decl)})`, ...(uses.length ? [`(uses := ${JSON.stringify(uses.join(", "))})`] : [])];
      L.push(`:::${directiveFor(b.kind)} ${JSON.stringify(id)} ${opts.join(" ")}`);
      const link = o.blockBase ? `[${versoInline(b.label)}](${o.blockBase}${b.md})` : versoInline(b.label);
      L.push(`${versoInline(b.title)}. Content block ${link}${b.kind === "conjecture" ? " (a conjecture in the folio)" : ""}.`, ":::", "");
    }
  }
  L.push("{blueprint_graph}", "", "{blueprint_summary}", "");
  return L.join("\n");
}

/** The conventional generator file `vbp build` discovers (`<Package>Main.lean`). */
export function generateBlueprintMain(docModule: string): string {
  return [
    "import VersoManual",
    "import VersoBlueprint.PreviewManifest",
    `import ${docModule}`,
    "",
    "open Verso Doc",
    "open Verso.Genre Manual",
    "",
    "def main (args : List String) : IO UInt32 :=",
    "  Informal.PreviewManifest.blueprintMainWithPreviewData",
    `    (%doc ${docModule})`,
    "    args",
    "    (extensionImpls := by exact extension_impls%)",
    "",
  ].join("\n");
}

export interface LakefileOptions {
  packageName: string;
  /** The folio's Lake package: its name in its own lakefile, and its directory. */
  folio: { name: string; path: string };
  versoBlueprintRev?: string;
}

/** The render workspace's `lakefile.lean`. */
export function generateBlueprintLakefile(o: LakefileOptions): string {
  return [
    "import Lake",
    "open Lake DSL",
    "",
    `require VersoBlueprint from git ${JSON.stringify(VERSO_BLUEPRINT_REPO)}@${JSON.stringify(o.versoBlueprintRev ?? VERSO_BLUEPRINT_REV)}`,
    `require ${o.folio.name} from ${JSON.stringify(o.folio.path)}`,
    "",
    `package ${o.packageName} where`,
    "  precompileModules := false",
    "  leanOptions := #[⟨`experimental.module, true⟩]",
    "",
    "@[default_target]",
    `lean_lib ${o.packageName} where`,
    "",
  ].join("\n");
}

/** The Lake package name a lakefile declares (`package foo where`, `name = "foo"`), or undefined. */
export function lakePackageName(dir: string): string | undefined {
  for (const f of ["lakefile.lean", "lakefile.toml"]) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf-8");
    const m = /^\s*package\s+«?([A-Za-z0-9_]+)»?/m.exec(src) ?? /^\s*name\s*=\s*"([^"]+)"/m.exec(src);
    if (m) return m[1];
  }
  return undefined;
}

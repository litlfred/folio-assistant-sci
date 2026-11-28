#!/usr/bin/env bun
/**
 * lean-kg-publish — publish the dynamic Lean viewer under a folio's site:
 * the static viewer (`lean-kg-viewer/`), the knowledge-graph shards
 * (`lean-kg-ingest.ts`), doc-gen4's stylesheet for signature markup, and the
 * harness rail on the viewer page.
 *
 * Replaces lean-render.ts as the `lean` directory's visualiser when the owner
 * chose "dynamic, from the KG" (2026-10-11): the site carries ONE html page
 * plus JSON shards, not one html page per module. The shards are what the
 * viewer fetches; nothing is rendered at publish time.
 *
 *   bun run folio-assistant-sci/adapters/paper/lean/lean-kg-publish.ts \
 *     --doc-data <lake>/.lake/build/doc-data --site _site [--route lean] \
 *     --modules QOU,UGB,Fred2005 [--content-root folio] [--paper-base ../../] \
 *     [--repo litlfred/qou --ref <sha> --content-prefix folio/] \
 *     [--base <published data dir or URL>]     # branches/ overlay
 *     [--home-label qou] [--instance <name>] [--platform <index root>] [--no-rail]
 *
 * One sub-KG per Lake package (owner, 2026-11-24: "separate qou, UGB and
 * Fred2005 into own lean sub-KGs"): run once per package with that package's
 * module roots, `--route lean/<package>`, and `--sibling <other>/<Root>` for
 * each root of the other packages, so a cross-package link lands on the
 * sibling sub-KG published beside it (`lean/<other>/`). With `--from-kg <published viewer or data dir>` in place of
 * `--doc-data`, the sub-KG is cut out of an already-published combined KG (the
 * folio's Lean store) and no Lean build or doc-gen4 run is needed; its
 * extracted `style.css` is reused.
 *
 * `--content-root` re-links every declaration to the current content blocks,
 * in both modes: by `lean.ref`, and by the block whose `.lean` sibling holds it
 * (matched on the declaration's `sourceLink`), so a split of a stale store
 * still links to the paper as it is now. `--paper-base` makes a block badge
 * open the rendered document (`<paper-base><paper>/#<label>`) instead of the
 * block's source on GitHub.
 *
 * `--doc-style` defaults to `<doc-data>/../doc/style.css` (doc-gen4's own); the
 * viewer still works without it, signatures just lose doc-gen4's styling.
 *
 * Exit 0 published; 1 the rail pass failed or the page carries no rail;
 * 2 usage or bad input.
 *
 * @module folio-assistant-sci/adapters/paper/lean/lean-kg-publish
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { collectContentBlocks, ingest, parseSiblings, splitFromKg, type IndexFile } from "./lean-kg-ingest.ts";
import { RAIL_SCRIPTS, findPlatform, runRail } from "./lean-render.ts";

const VIEWER = join(import.meta.dir, "lean-kg-viewer");

/**
 * doc-gen4's style.css styles the whole page — bare `body`, `header`, `nav`,
 * `main` and `*` — which would lay the viewer out as a doc-gen4 page and can
 * reach the harness rail's own `nav.fa-nav`. Keep only what signatures need:
 * custom properties (`:root`, including those inside `@media`), and rules
 * whose selectors name signature classes. Every kept rule is additionally
 * scoped under `.lkg-sig`, so nothing kept can touch the page around it.
 */
export function signatureStyles(css: string): string {
  const SIG = /\.(decl|fn|impl_arg|decl_args|decl_kind|decl_name|decl_header|decl_type|name|break_within|theorem|def|structure|class|instance|inductive|ctor|axiom|opaque|attributes|structure_fields|constructor|inductive_ctors|structure_field|equations|gh_link|instances|decl_extends)\b/;
  const out: string[] = [];
  // split into top-level statements, tracking brace depth
  const top: string[] = [];
  let depth = 0, start = 0;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}") { depth--; if (depth === 0) { top.push(clean.slice(start, i + 1)); start = i + 1; } }
  }
  const rule = (r: string, inner: boolean): string | undefined => {
    const b = r.indexOf("{");
    const sel = r.slice(0, b).trim(), body = r.slice(b);
    if (sel.startsWith("@media") || sel.startsWith("@supports")) {
      const inside: string[] = [];
      let d = 0, s0 = 0;
      const content = body.slice(1, -1);
      for (let i = 0; i < content.length; i++) {
        if (content[i] === "{") d++;
        else if (content[i] === "}") { d--; if (d === 0) { const x = rule(content.slice(s0, i + 1), true); if (x) inside.push(x); s0 = i + 1; } }
      }
      return inside.length ? `${sel}{${inside.join("")}}` : undefined;
    }
    if (sel.startsWith("@")) return inner ? undefined : undefined;
    if (/^:root\b/.test(sel)) return `${sel}${body}`;
    const sels = sel.split(",").map((x) => x.trim()).filter((x) => SIG.test(x) && !/^(body|header|nav|main|html)\b/.test(x));
    if (!sels.length) return undefined;
    return `${sels.map((x) => `.lkg-sig ${x}`).join(",")}${body}`;
  };
  for (const r of top) { const x = rule(r, false); if (x) out.push(x); }
  return `/* signature rules extracted from doc-gen4's style.css by lean-kg-publish.ts */\n${out.join("\n")}\n`;
}

async function loadBase(base: string): Promise<IndexFile> {
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
  const fromKg = at("--from-kg");
  const site = at("--site");
  if ((!docData && !fromKg) || (docData && fromKg) || !site) {
    console.error("usage: lean-kg-publish.ts (--doc-data <dir> | --from-kg <published viewer or data dir>) --site <dir> [--route lean] [--modules A,B] [--sibling <package>/<Root>[,…]]... [--content-root <dir>] [--repo o/r --ref <sha> --content-prefix <p>] [--paper-base <rel dir>] [--base <dir|url>] [--home-label <n>] [--instance <n>] [--platform <dir>] [--no-rail]");
    return 2;
  }
  const route = (at("--route") ?? "lean").replace(/^\/+|\/+$/g, "");
  if (route === "" || route.split("/").includes("..")) {
    console.error(`? --route must name a directory under the site, got "${route}"`);
    return 2;
  }
  const dest = join(resolve(site), route);
  const modules = [...(at("--modules")?.split(",") ?? []), ...argv.flatMap((a, i) => (a === "--module" && argv[i + 1] ? [argv[i + 1]!] : []))]
    .map((s) => s.trim())
    .filter(Boolean);
  const base = at("--base");
  let rootBases: Map<string, string>;
  try {
    rootBases = parseSiblings(argv.flatMap((a, i) => (a === "--sibling" && argv[i + 1] ? [argv[i + 1]!] : [])));
  } catch (e) {
    console.error(`? ${(e as Error).message}`);
    return 2;
  }
  // The published KG to split: a viewer directory (`<dir>/data/index.json`) or its `data/`.
  const kgDir = fromKg === undefined ? undefined : existsSync(join(resolve(fromKg), "data", "index.json")) ? resolve(fromKg) : undefined;
  const kgData = fromKg === undefined ? undefined : kgDir !== undefined ? join(kgDir, "data") : resolve(fromKg);
  if (kgData !== undefined && resolve(kgData).startsWith(resolve(dest))) {
    console.error(`? --from-kg ${fromKg} is inside the route it would replace (${dest})`);
    return 2;
  }
  if (fromKg !== undefined && base !== undefined) {
    console.error("? --base (a staging overlay) applies to --doc-data only");
    return 2;
  }
  if (fromKg !== undefined && modules.length === 0) {
    console.error("? --from-kg needs --modules: the roots of the package this sub-KG holds");
    return 2;
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of readdirSync(VIEWER)) copyFileSync(join(VIEWER, f), join(dest, f));
  const publishedStyle = kgDir !== undefined ? join(kgDir, "style.css") : undefined;
  const style = at("--doc-style") ?? (docData ? join(dirname(resolve(docData)), "doc", "style.css") : undefined);
  if (style !== undefined && existsSync(style)) writeFileSync(join(dest, "style.css"), signatureStyles(readFileSync(style, "utf-8")));
  else if (publishedStyle !== undefined && existsSync(publishedStyle)) copyFileSync(publishedStyle, join(dest, "style.css"));
  else console.log(`  no doc-gen4 style.css${style ? ` at ${style}` : ""}; signatures render unstyled`);
  // `paperBase`: where the folio's rendered documents sit, relative to this
  // viewer page; a block badge opens `<paperBase><paper>/#<label>` there rather
  // than the block's source on GitHub (owner, 2026-11-28: "lean rendering
  // linked back to paper references").
  const paperBase = at("--paper-base");
  if (paperBase !== undefined && !/^(\.\.?\/)*([A-Za-z0-9_-]+\/)*$/.test(paperBase)) {
    console.error(`? --paper-base takes a relative directory ending in "/" (e.g. ../../), got "${paperBase}"`);
    return 2;
  }
  // `siblings`: the viewer links an import into another package's sub-KG (`<base>#/m/<Module>`).
  writeFileSync(
    join(dest, "config.json"),
    JSON.stringify({
      repo: at("--repo"),
      ref: at("--ref"),
      contentPrefix: at("--content-prefix"),
      ...(paperBase !== undefined ? { paperBase } : {}),
      ...(rootBases.size ? { siblings: Object.fromEntries(rootBases) } : {}),
    }),
  );
  const contentRoot = at("--content-root");
  const blocks = contentRoot !== undefined ? collectContentBlocks(resolve(contentRoot), at("--content-prefix")) : undefined;

  let r;
  try {
    r =
      kgData !== undefined
        ? splitFromKg({ kg: kgData, out: join(dest, "data"), modules, externalBase: at("--external-base"), rootBases, blocks })
        : ingest({ docData: docData!, out: join(dest, "data"), modules, contentRoot, contentPrefix: at("--content-prefix"), externalBase: at("--external-base"), rootBases, base, baseIndex: base ? await loadBase(base) : undefined });
  } catch (e) {
    console.error(`? ${(e as Error).message}`);
    return 2;
  }
  console.log(
    `lean-kg-publish: viewer + ${r.modules} module shard(s), ${r.decls} declaration(s) into ${dest}` +
      (kgData !== undefined ? ` (split from ${kgData})` : "") +
      (r.overlay ? `; overlay of ${r.written} changed module(s) on ${base}` : ""),
  );

  if (argv.includes("--no-rail")) {
    console.log("  --no-rail: NOT railed. Run rail-standalone-pages.ts --foreign-site over the site before publishing.");
    return 0;
  }
  const platform = findPlatform(at("--platform"));
  if (!platform) {
    console.error(`? no index checkout with ${RAIL_SCRIPTS.join(" or ")} found — published but NOT railed, and that is not a pass`);
    return 1;
  }
  if (!runRail(platform, site, at("--home-label"), at("--instance"))) return 1;
  const html = readFileSync(join(dest, "index.html"), "utf-8");
  if (!/<nav class="fa-nav"|data-fa-rail/.test(html)) {
    console.error("✗ the viewer page carries no rail");
    return 1;
  }
  console.log("✓ viewer page railed");
  return 0;
}

if (import.meta.main) process.exit(await main());

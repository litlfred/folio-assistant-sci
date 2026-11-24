import { toolFactory } from "@litlfred/cat-harness-tools/schemas/tools/tool-folders.js";
import { defineTool } from "@litlfred/cat-harness-tools/schemas/tools/tool.js";

export default toolFactory((t) =>
  defineTool({
    id: "lean-verso-render",
    title: "Render a folio's Lean library with Verso, linked to the content blocks it formalizes",
    description:
      "Generate a Verso Manual document with one page per Lean module and one `{docstring}` block per declaration a content block's `lean.ref` names, each saying which block it formalizes; elaborate it `lean`-direct against the folio's restored oleans plus a built Verso, run Verso's HTML generator, stage `html-multi/` under `<site>/<route>/` (default `verso`) and rail it with the same pass as `lean-render-publish`. Declarations are located through the `.ilean` files beside the oleans, so no doc-gen4 run is needed. With `--toolchain` it reports the engine: Verso Blueprint (leanprover/verso-blueprint, release branches v4.28.0..v4.35.0) when the folio's toolchain has one, else Verso Manual (leanprover/verso, tags from v4.10.0). This prototype implements the Verso Manual engine only.",
    install: { none: true },
    invoke: { shell: "bun run folio-assistant-sci/adapters/paper/lean/lean-verso-render.ts" },
    io: {
      inputs: [
        { name: "contentRoot", schema: t("RepoPath"), required: true, arg: { flag: "--content-root" }, description: "Content tree whose blocks' `lean.ref` choose the declarations." },
        { name: "verso", schema: t("RepoPath"), required: true, arg: { flag: "--verso" }, description: "A `leanprover/verso` checkout at the folio's toolchain tag, with `lake build VersoManual` done." },
        { name: "leanPath", schema: t("RepoPath"), required: true, arg: { flag: "--lean-path" }, description: "A directory of restored oleans and ileans (`.lake/build/lib/lean`). Repeat: the library's, then Mathlib's and each dependency's." },
        { name: "module", schema: t("PackageName"), required: false, arg: { flag: "--module" }, description: "A module root to index (`QOU`). Repeat for several. Default: every root on the path." },
        { name: "chapter", schema: t("Slug"), required: false, arg: { flag: "--chapter" }, description: "Only blocks under this chapter directory." },
        { name: "limit", schema: t("Count"), required: false, arg: { flag: "--limit" }, description: "At most this many declarations, in name order." },
        { name: "work", schema: t("RepoPath"), required: false, arg: { flag: "--work" }, description: "Scratch directory for the generated document, its olean and `_out/`. Default `_verso-work`." },
        { name: "title", schema: t("Text"), required: false, arg: { flag: "--title" }, description: "The site's title." },
        { name: "toolchain", schema: t("Text"), required: false, arg: { flag: "--toolchain" }, description: "The folio's `lean-toolchain`; refuses one Verso has no release for." },
        { name: "repo", schema: t("RepoFullName"), required: false, arg: { flag: "--repo" }, description: "`owner/repo` for block links." },
        { name: "ref", schema: t("Branch"), required: false, arg: { flag: "--ref" }, description: "Branch or sha for block links." },
        { name: "contentPrefix", schema: t("RepoPath"), required: false, arg: { flag: "--content-prefix" }, description: "Path of the content root inside the repo, for block links." },
        { name: "site", schema: t("RepoPath"), required: false, arg: { flag: "--site" }, description: "The folio's built site; without it the render stays in `<work>/_out/html-multi`." },
        { name: "route", schema: t("Slug"), required: false, arg: { flag: "--route" }, description: "Where under the site. Default `verso`, beside the `lean` KG viewer." },
        { name: "homeLabel", schema: t("InstanceId"), required: false, arg: { flag: "--home-label" }, description: "The rail's home row." },
        { name: "instance", schema: t("InstanceId"), required: false, arg: { flag: "--instance" }, description: "As rail-standalone-pages.ts --instance." },
        { name: "platform", schema: t("RepoPath"), required: false, arg: { flag: "--platform" }, description: "The index checkout holding the rail pass." },
        { name: "noRail", schema: t("Flag"), required: false, arg: { flag: "--no-rail" }, description: "Stage only; the caller rails the site." },
      ],
      outputs: [
        { name: "site", schema: t("RepoPath"), description: "`<site>/<route>/`: Verso's multi-page HTML, railed; `<work>/unresolved.txt` lists the `lean.ref`s no `.ilean` defines." },
      ],
    },
    satisfies: ["lean-html-docs"],
    requires: { runtime: ["bun", "lean"], network: false },
    selection: {
      when: "When the folio wants its Lean read as a document — each formal statement next to the block it formalizes, highlighted against the folio's own Mathlib — rather than browsed as a graph (`lean-kg-publish`) or as API docs (`lean-render-publish`).",
      limits:
        "Renders only declarations whose module has an olean on the path: content-block sibling `.lean` files are compiled outside the library and are listed as unresolved (718 of 1,318 qou refs on 2026-11-24). Verso Blueprint (progress tracking, dependency graph) needs Lean v4.28.0 or later. Verso must be built at exactly the folio's toolchain.",
      cost: "Measured 2026-11-24 on a 4-core shared host: building Verso v4.24.0 (VersoManual, 118 Lake jobs) once; indexing qou's 3,608 ileans 0.5-2 s; per-render times are in the PR that added this Tool.",
    },
  }),
);

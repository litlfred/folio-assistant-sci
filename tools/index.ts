/**
 * folio-assistant-sci's Tool nodes: the `tools` graph for the science layer.
 *
 * @module folio-assistant-sci/tools
 * @graphNode tool
 *
 * Reached by the harness through tool auto-discovery (`cat-harness/tools/
 * discover.ts`, bean `p0za`), never by an import, as `folio-assistant-core`'s
 * are. A Tool node is a declaration read at load; these invoke shell commands,
 * so declaring them copies no code.
 *
 * ## The iterative paper build (issue #2117, 2026-10-04)
 *
 * The owner asked for the loop litlfred/qou used to iterate on a large paper,
 * as "new skill/tools". It has four steps, governed by the `latex-build-cache`
 * skill:
 *
 * 1. `latex-preflight` (cat-harness), a static check that needs no TeX;
 * 2. `tex-install`, to get an engine into a sandbox that has none;
 * 3. `paper-feature-build`, which compiles only the changed chapters plus a
 *    latexdiff of each, with margin notes off;
 * 4. `paper-latex-build` (cat-harness), the full render.
 *
 * Steps 2 and 3 had no Tool node, so an agent searching the tools graph could
 * not find the loop; and step 3 could not run anywhere, because it read the
 * preamble deleted in `34a70659c7`. It now lives beside the recovered print
 * template in `adapters/paper/latex/`.
 */
import { defineTool, type ToolDefinition } from "../../cat-harness/schemas/tool.js";
import { toolTypeIri } from "../../cat-harness/schemas/tool-types.js";

export function tools(baseUrl?: string): ToolDefinition[] {
  const B = baseUrl ?? "";
  const t = (n: Parameters<typeof toolTypeIri>[1]): string => toolTypeIri(B, n);

  return [
    defineTool({
      id: "paper-feature-build",
      title: "Paper feature build (changed chapters + latexdiff)",
      description:
        "Quick preview of a paper folio's branch: render the paper with the sci print template (plus the folio's notation fragment when it has one), then compile ONLY the chapters changed against a base ref, and a colored and a plain latexdiff of each. Margin notes are off by default (`FAST_PREVIEW=1`, about 2x). Cross-references to chapters outside the build print as '??'. A preview, never a publish build. Run from the folio. Without a TeX engine the render still runs and the compile steps are skipped with a message.",
      install: { none: true },
      invoke: { shell: "bash folio-assistant-sci/adapters/paper/latex/feature-build.sh" },
      io: {
        inputs: [
          { name: "base", schema: t("Branch"), required: false, arg: { flag: "--base" }, description: "The ref to diff against. Default `origin/main`." },
          { name: "chapters", schema: t("Slug"), required: false, arg: { flag: "--chapters" }, description: "Chapter slugs, comma-separated. Default: the chapters whose sources changed against `base`." },
          { name: "paper", schema: t("Slug"), required: false, arg: { flag: "--paper" }, description: "The paper's slug. Default: the folio's only paper; with several, the tool refuses and names them." },
          { name: "out", schema: t("RepoPath"), required: false, arg: { flag: "--out" }, description: "Output directory, which the folio should gitignore. Default `build-feature`." },
          { name: "notation", schema: t("RepoPath"), required: false, arg: { flag: "--notation" }, description: "The folio's notation fragment, appended after the template. Default `<paper dir>/latex/notation-preamble.tex` when present." },
          { name: "preload", schema: t("RepoPath"), required: false, arg: { flag: "--preload" }, description: "Bun preload that configures the platform's injected registries (values, Lean packages). Default `scripts/preload-registry.ts` when present. It must import the same platform checkout as this tool." },
        ],
        outputs: [
          { name: "preview", schema: t("RepoPath"), description: "`<out>/changed.pdf`, `<out>/<chapter>.diff-color.pdf` and `.diff-plain.pdf`, with the logs and `<out>/build.log` beside them. The render also rewrites the folio's `chapters/` and `main.tex`." },
        ],
      },
      satisfies: ["latex-build-cache"],
      requires: { runtime: ["bun", "git", "bash"], network: false },
      selection: {
        when:
          "Iterating on a paper's prose or mathematics, before a full build: you want to see the changed chapters typeset, and what changed, in a minute or so instead of compiling the whole paper.",
        limits:
          "A preview: cross-references outside the build show '??', margin notes are off by default, and a chapter's base latexdiff degrades to 'all added' when the base ref has no committed chapter .tex. Needs pdflatex/latexmk for the PDFs and latexdiff for the diffs; without them only the render runs.",
        cost: "One paper render (about 20-40 s on a 2,900-block paper) plus one pdflatex compile per output PDF.",
      },
    }),
    defineTool({
      id: "tex-install",
      title: "Install TeX Live in a sandbox",
      description:
        "Install TeX Live (full) and latexmk where no TeX engine is present, disabling the firewalled launchpad PPAs that otherwise abort `apt-get update`. Idempotent: does nothing when pdflatex and memoize.sty are already present. About 5 GB and 10-20 minutes, so run it in the background. pdflatex unpacks early but is not usable until the post-install format build ends (`kpsewhich memoize.sty` returning a path is the ready signal).",
      install: { none: true },
      invoke: { shell: "bash cat-harness-tools/scripts/install-tex.sh" },
      io: {
        inputs: [],
        outputs: [
          { name: "engine", schema: t("Text"), description: "A `pdflatex --version` line on success. The installed packages are system-wide." },
        ],
      },
      satisfies: ["latex-build-cache"],
      requires: { runtime: ["bash", "apt-get", "sudo"], network: true },
      remedies: [{ host: "archive.ubuntu.com", none: "apt is the only source declared. The script already disables the launchpad PPAs, which answer 403 here." }],
      selection: {
        when: "A step needs to compile TeX (`paper-feature-build`'s PDFs, a full paper build) and `pdflatex` is not on PATH.",
        limits: "Debian/Ubuntu with apt and sudo only. Installs system packages; it does not touch the repository.",
        cost: "About 5 GB of disk and 10-20 minutes, once per container.",
      },
    }),

    // The LaTeX image is part of THIS Tool (bean `ar1s`, phase 2): the
    // Dockerfile sits beside it under `scripts/docker-latex-build/`, and
    // `install.container` is its build line, which is what
    // `deps:python:check` reads to find the image it checks.
    defineTool({
      id: "latex-image",
      title: "Compile LaTeX in a container",
      description:
        "Compile a rendered paper's `main.tex` with latexmk inside a TeX Live (full) image, for a host with Docker but no TeX engine. The image carries TeX Live, latexmk, Pandoc, latexdiff, graphviz and poppler-utils; it does not run the content pipeline, which renders the chapters on the host first.",
      install: {
        container:
          "docker build -t folio-latex -f folio-assistant-sci/scripts/docker-latex-build/Dockerfile folio-assistant-sci/scripts/docker-latex-build",
      },
      invoke: {
        container: "docker run --rm -v .:/workspace -w /workspace folio-latex latexmk -pdf -interaction=nonstopmode",
      },
      io: {
        inputs: [
          { name: "mainTex", schema: t("RepoPath"), required: true, arg: { positional: 0 }, description: "The rendered paper's top-level `.tex`, relative to the checkout." },
        ],
        outputs: [
          { name: "pdf", schema: t("RepoPath"), description: "The compiled PDF beside the input." },
        ],
      },
      satisfies: ["latex-build-cache"],
      requires: { runtime: ["docker"], network: true },
      remedies: [{ host: "archive.ubuntu.com", none: "The image build installs texlive-full from apt; with the archive refused there is no image. `tex-install` needs the same host." }],
      selection: {
        when: "A step needs a compiled PDF, `pdflatex` is not on PATH, and Docker is available — the container alternative to `tex-install`.",
        limits: "Needs Docker. The first build pulls ubuntu:24.04 and texlive-full (several GB); later runs reuse the image.",
        cost: "One image build (10-20 minutes, once), then one latexmk compile per run.",
      },
    }),

    // The formal-edge extractor, served over MCP. It reached the servers as a
    // `contributes` tool group (`contributions.ts`) until both servers came to
    // serve every Tool node in the folio's dependency tree (bean riit, 3c);
    // this node is what registers it now, and the contribution is gone.
    defineTool({
      id: "lean-formal-edges",
      title: "Formal edges from the Lean build",
      description:
        "Extract ELABORATED formal dependencies between a folio's lean.ref declarations (LeanArchitect's rule over the folio's own lean.ref set). Needs a Lean toolchain and a built Lake project. Tagged declarations missing from the build are reported, never recorded as dependency-free; with ingest the result is recorded in the formal cache as source \"elaborated\".",
      install: { none: true },
      invoke: { inProcess: { module: "content/pipeline/formal-edges-mcp.ts" }, mcp: { tool: "lean_formal_edges" } },
      io: {
        inputs: [
          { name: "lake_dir", schema: t("RepoPath"), required: true, description: "The folio's Lake project directory (holds lakefile.* and .lake/)." },
          { name: "root", schema: t("RepoPath"), required: false, description: "Content root to collect lean.ref targets from (default: the folio's declared one)." },
          { name: "ingest", schema: t("Flag"), required: false, description: "Record the result in the formal cache as source \"elaborated\"." },
        ],
        outputs: [
          { name: "report", schema: t("Markdown"), description: "The extracted edges, or why they could not be determined — never an empty edge set in place of a failure." },
        ],
      },
      satisfies: ["lean-formal-edges"],
      requires: { runtime: ["bun", "lake"], network: false },
    }),

    // The `lean` directory's visualiser (owner, 2026-10-10: "there should be a
    // lean/ visualizer which is then the lean html render (but wrapped w/
    // cat-harness navbar chrome/rails)"). Two Tools because they fail
    // differently and cost wildly differently: the build is a Lake run over a
    // warm cache, the publish is a file pass over its output.
    defineTool({
      id: "lean-html-docs",
      title: "Build a Lean package's HTML docs (doc-gen4)",
      description:
        "Build the doc-gen4 HTML render of a folio's Lake package — the visualiser of a declared `lean` directory — with `lake -R -Kenv=dev build <Lib>:docs`, cache-aware: refuses while another lake/lean process holds `.lake/`, refuses on a restored tree that carries no traces (a Lake build there EVICTS the cache), checks or restores the warm cache first, and enables a sentinel-commented doc-gen4 `[[require]]` for this build only, restoring the lakefile on exit. Never runs `lake update`. Output: `<lake-root>/.lake/build/doc`.",
      install: { none: true },
      invoke: { shell: "bash folio-assistant-sci/adapters/paper/lean/lean-docs-build.sh" },
      io: {
        inputs: [
          { name: "lakeRoot", schema: t("RepoPath"), required: true, arg: { flag: "--lake-root" }, description: "The Lake package directory whose lakefile requires (or sentinel-comments) doc-gen4, e.g. `folio/quantum-observable-universe/lean`." },
          { name: "lib", schema: t("InstanceId"), required: true, arg: { flag: "--lib" }, description: "The `lean_lib` to document, e.g. `QOU` (a Lean library name: alphanumerics, dot, underscore, hyphen). Repeat for several." },
          { name: "platform", schema: t("RepoPath"), required: false, arg: { flag: "--platform" }, description: "The index checkout holding `lake-cache.sh`. Default `$FOLIO_ASSISTANT_ROOT`." },
          { name: "restore", schema: t("Flag"), required: false, arg: { flag: "--restore" }, description: "Restore the warm cache first (about 2 minutes) instead of only checking it." },
          { name: "allowCold", schema: t("Flag"), required: false, arg: { flag: "--allow-cold" }, description: "Build without a warm cache: Mathlib from source, 30-60 minutes before doc-gen4 starts." },
          { name: "dryRun", schema: t("Flag"), required: false, arg: { flag: "--dry-run" }, description: "Run every guard, print the build command, build nothing." },
        ],
        outputs: [
          { name: "render", schema: t("RepoPath"), description: "`<lake-root>/.lake/build/doc`, doc-gen4's output, printed as the last line. Feed it to `lean-render-publish`." },
        ],
      },
      satisfies: ["lean-html-docs"],
      requires: { runtime: ["bash", "git", "lake"], network: true },
      remedies: [{ host: "github.com", none: "doc-gen4 and its dependencies are fetched from GitHub on first use, and the warm cache is stored there; without it there is no render." }],
      selection: {
        when: "A folio's declared `lean` directory needs its visualiser (the doc-gen4 render) built or refreshed, before `lean-render-publish` wraps it.",
        limits:
          "doc-gen4 renders the WHOLE import closure, Mathlib included. It does not prune; prune at publish. Refuses, rather than risks, a shared or untraced `.lake/`. Never run it while another agent holds the folio's Lean cache.",
        cost: "Unmeasured here (written without running Lake). One doc-gen4 compile, then one doc pass per module of the closure — thousands for a Mathlib package; qou's July render was 4,193 pages, 545 MB. Needs that much free disk beyond the build.",
      },
    }),
    defineTool({
      id: "lean-render-publish",
      title: "Publish a Lean render under a folio site, with the harness rail",
      description:
        "Stage a doc-gen4 render under a folio's built site (`<site>/<route>/`, default `lean/`) and give every page the harness navbar and rail by running `cat-harness/scripts/rail-standalone-pages.ts --foreign-site` over the site — the same rail `stage-folio-local.ts` applies to the folio's own pages. Leaves out Lake's `.hash`/`.trace` bookkeeping, marks doc-gen4's iframe navbar and `find/` redirect `folio-navbar: none` so no rail is drawn inside the sidebar, adds a layout shim so the rail does not cover doc-gen4's fixed sidebar, and with `--modules` prunes to the folio's own modules, repointing links into dropped ones to the community docs. Then asserts every staged page is railed or declined.",
      install: { none: true },
      invoke: { shell: "bun run folio-assistant-sci/adapters/paper/lean/lean-render.ts" },
      io: {
        inputs: [
          { name: "docs", schema: t("RepoPath"), required: true, arg: { flag: "--docs" }, description: "The doc-gen4 render, `lean-html-docs`'s output." },
          { name: "site", schema: t("RepoPath"), required: true, arg: { flag: "--site" }, description: "The folio's built site (`_site` from build-folio-site.ts)." },
          { name: "route", schema: t("Slug"), required: false, arg: { flag: "--route" }, description: "Where under the site. Default `lean`." },
          { name: "module", schema: t("PackageName"), required: false, arg: { flag: "--module" }, description: "A Lake package whose module root to keep (`qou` keeps `QOU/`, matched case-insensitively). Repeat for several. Default: keep everything." },
          { name: "externalBase", schema: t("Url"), required: false, arg: { flag: "--external-base" }, description: "Where links into pruned modules go. Default the community mathlib4 docs." },
          { name: "homeLabel", schema: t("InstanceId"), required: false, arg: { flag: "--home-label" }, description: "The rail's home row: the folio's instance name, e.g. `qou`." },
          { name: "instance", schema: t("InstanceId"), required: false, arg: { flag: "--instance" }, description: "Rail as this instance's own site (its name, mark and graphs), as rail-standalone-pages.ts --instance." },
          { name: "platform", schema: t("RepoPath"), required: false, arg: { flag: "--platform" }, description: "The index checkout holding the rail pass. Default `$FOLIO_ASSISTANT_ROOT`, then the nearest ancestor that has it." },
          { name: "noRail", schema: t("Flag"), required: false, arg: { flag: "--no-rail" }, description: "Stage only; the caller rails the site itself." },
        ],
        outputs: [
          { name: "pages", schema: t("RepoPath"), description: "`<site>/<route>/`, railed, plus the rail's shared data under `<site>/assets/navbar/`." },
        ],
      },
      satisfies: ["lean-html-docs"],
      requires: { runtime: ["bun"], network: false },
      selection: {
        when: "After the folio's site is built and before it is checked and published (`stage-folio-local.ts` step 2 runs the same rail): put the Lean render into it as the `lean` directory's visualiser.",
        limits:
          "Pruned links point at the community docs, built from THEIR Mathlib rather than the folio's pin; doc-gen4's search index still lists pruned declarations, whose hits 404. The rail's assets load from the platform's published site, as on every foreign-site page.",
        cost: "Measured on qou's July render: pruned to QOU,UGB,Fred2005 34 pages / 29 MB / about 5 s; unpruned 4,193 pages / 533 MB / 347 s.",
      },
    }),

    // Moved here from cat-harness/tools/index.ts (bean j9cs, 2026-10-05): the
    // `lake-cache` kind (kinds/lake-cache.json) says this harness owns the kind
    // AND the tool, and the skill it satisfies (`lean-cache-restore`) is this
    // harness's. The script itself lives in cat-harness-tools/scripts/, where the
    // folio copies it from; only the declaration moved. A folio's lake-cache
    // directory names it as `storage.tool: "lean-cache"`.
    defineTool({
      id: "lean-cache",
      title: "Lake olean cache",
      description:
        "Restore, verify, seed and diagnose the prebuilt `.lake/` artefacts for a Lean package. Always try `restore` first: a from-source Mathlib build is 30–60 minutes, a restore about two.",
      install: { none: true },
      invoke: { shell: "cat-harness-tools/scripts/lake-cache.sh" },
      io: {
        inputs: [
          { name: "action", schema: t("LakeCacheAction"), required: true, arg: { positional: 0 }, description: "The verb. `doctor` exists because a restore that silently missed used to look exactly like one that worked." },
          { name: "lakeRoot", schema: t("RepoPath"), required: false, arg: { flag: "--lake-root" }, description: "The package whose `.lake/` is acted on." },
          { name: "package", schema: t("PackageName"), required: false, arg: { flag: "--package" } },
        ],
        outputs: [{ name: "result", schema: t("Text"), description: "A real hit, a miss, or a diagnosis — never a miss that reads as a hit." }],
      },
      satisfies: ["lean-cache-restore"],
      requires: { runtime: ["bash", "git", "lake"], network: true },
      remedies: [{ host: "github.com", none: "The warm cache is stored on GitHub; without it, build cold with `lean-build` (30–60 minutes for Mathlib)." }],
    }),
  ];
}

import { toolFactory } from "../../../cat-harness/schemas/tool-folders.js";
import { defineTool } from "../../../cat-harness/schemas/tool.js";

export default toolFactory((t) =>
  defineTool({
    id: "paper-preferences",
    title: "Rendering preferences",
    description: "Read, write or clear the stored rendering preferences — engine, format, scope, math renderer, print mode.",
    install: { none: true },
    invoke: { inProcess: { module: "src/tools/preferences.ts" }, mcp: { tool: "paper_preferences" } },
    io: {
      inputs: [
        { name: "action", schema: t("PreferenceAction"), required: false, arg: { flag: "--action" } },
        { name: "render_format", schema: t("RenderFormat"), required: false, arg: { flag: "--render-format" } },
        { name: "render_scope", schema: t("RenderScope"), required: false, arg: { flag: "--render-scope" } },
        { name: "latex_engine", schema: t("LatexEngine"), required: false, arg: { flag: "--latex-engine" } },
        { name: "math_renderer", schema: t("MathRenderer"), required: false, arg: { flag: "--math-renderer" } },
        { name: "auto_preview", schema: t("Flag"), required: false, arg: { flag: "--auto-preview" } },
        { name: "formula_dpi", schema: t("Dpi"), required: false, arg: { flag: "--formula-dpi" } },
        { name: "default_chapter", schema: t("RepoPath"), required: false, arg: { flag: "--default-chapter" } },
        { name: "print_mode", schema: t("PrintMode"), required: false, arg: { flag: "--print-mode" } },
        { name: "compact_inline_refs", schema: t("Flag"), required: false, arg: { flag: "--compact-inline-refs" } },
      ],
      outputs: [{ name: "preferences", schema: t("Markdown"), description: "The preferences after the call." }],
    },
    satisfies: ["build-pdf", "build-docs"],
    requires: { network: false },
  }),
);

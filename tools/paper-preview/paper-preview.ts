import { toolFactory } from "../../../cat-harness/schemas/tool-folders.js";
import { defineTool } from "../../../cat-harness/schemas/tool.js";

export default toolFactory((t) =>
  defineTool({
    id: "paper-preview",
    title: "Open a render",
    description: "Open a rendered PDF, HTML page or image in the system browser, or list the renders available to open.",
    install: { none: true },
    invoke: { inProcess: { module: "src/tools/preview.ts" }, mcp: { tool: "paper_preview" } },
    io: {
      inputs: [
        { name: "file", schema: t("RepoPath"), required: false, arg: { positional: 0 } },
        // `PreviewFormat`, not `RenderFormat`: this opens what was built,
        // which includes a `png` nothing chooses to render a whole folio as.
        { name: "format", schema: t("PreviewFormat"), required: false, arg: { flag: "--format" } },
        { name: "list", schema: t("Flag"), required: false, arg: { flag: "--list" } },
      ],
      outputs: [{ name: "opened", schema: t("Markdown"), description: "What was opened, or the list of candidates." }],
    },
    satisfies: ["rendering-auditor", "staging-review"],
    requires: { network: false },
  }),
);

import { toolFactory } from "../../../cat-harness/schemas/tools/tool-folders.js";
import { defineTool } from "../../../cat-harness/schemas/tools/tool.js";

export default toolFactory((t) =>
  defineTool({
    id: "content-manifest-validate",
    title: "Content manifest validation",
    description:
      "Validate the block manifests under a path against their schemas. Exits 2 where no folio is present rather than reporting a clean run — the platform carries no content, and a validator that passes over nothing is how this one validated nothing for a while.",
    install: { none: true },
    invoke: { shell: "bun run cat content:validate" },
    io: {
      inputs: [
        { name: "targetPath", schema: t("RepoPath"), required: false, arg: { positional: 0 }, description: "A paper or chapter directory; absent, every paper the folio declares." },
        { name: "strict", schema: t("Flag"), required: false, arg: { flag: "--strict" }, description: "Treat warnings as errors." },
      ],
      outputs: [
        { name: "issues", schema: t("Text"), description: "One line per issue, with its block and file. Exit 2 means NO FOLIO WAS FOUND — could-not-determine, never valid." },
      ],
    },
    satisfies: ["content-validate", "content-validation"],
    requires: { runtime: ["bun"], network: false },
  }),
);

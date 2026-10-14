/**
 * `folio-editor-checker/v1`: one node per content profile, naming the code the
 * ✍ suggest editor loads for that profile's blocks (bean folio-assistant-4dx7).
 *
 * Modelled on cat-harness `schemas/contribution-nodes.ts` (`folio-qa-checker/v1`).
 * Every code ref is `path.ts#Export`, relative to the contributing instance's
 * root, so the runtime resolves it through the declaration, never through a
 * path written into the runtime.
 *
 * @module folio-assistant-sci/schemas/editor-checker
 */

import { z } from "zod";

export const EDITOR_CHECKER_NODE_SCHEMA = "folio-editor-checker/v1" as const;

/** `path#Export`, instance-relative, no `..`, no `instance:` prefix. The same rule as cat-harness `OwnCodeRefSchema`. */
export const OwnCodeRefSchema = z
  .string()
  .regex(/^(?![a-z][a-z0-9-]*:)(?!\/)(?!\.\.)[^#\s]+\.ts#[A-Za-z_$][\w$]*$/, {
    message: "a code ref is `path.ts#Export`, relative to the contributing instance's own root",
  });

const Name = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const EditorCheckerNodeSchema = z
  .object({
    $schema: z.literal(EDITOR_CHECKER_NODE_SCHEMA),
    id: Name,
    /** The content type whose blocks this profile serves (a declared `contentAdapters[].contentType`). */
    contentType: Name,
    /** Block kinds it is limited to. Absent means every Markdown block of the content type. */
    kinds: z.array(Name).nonempty().optional(),
    /** `checkSuggestion(before, after, ctx)` → findings. Errors are syntax errors; warnings never block. */
    check: OwnCodeRefSchema,
    /** Crepe settings for the profile. */
    crepe: z
      .object({
        /** `(katexMacros) => featureConfigs[Crepe.Feature.Latex]`. */
        latexConfig: OwnCodeRefSchema.optional(),
        /** ProseMirror node-view factories, by node name. */
        nodeViews: z.record(z.string(), OwnCodeRefSchema).optional(),
        /** A `remarkPluginsCtx` updater that puts a transformer first. */
        remarkFirst: OwnCodeRefSchema.optional(),
      })
      .strict()
      .optional(),
    /** Block kinds whose raw-LaTeX pane is offered up front (owner, 2026-10-14: "both"). */
    rawLatexFirstFor: z.array(Name).optional(),
    rationale: z.string().optional(),
  })
  .strict();

export type EditorCheckerNode = z.infer<typeof EditorCheckerNodeSchema>;

/** Every code ref a node names. */
export function codeRefs(node: EditorCheckerNode): string[] {
  return [node.check, node.crepe?.latexConfig, ...Object.values(node.crepe?.nodeViews ?? {}), node.crepe?.remarkFirst]
    .filter((r): r is string => typeof r === "string");
}

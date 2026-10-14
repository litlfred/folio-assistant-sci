# ✍ suggest — the paper profile's LaTeX checks

Bean `4dx7`. The ✍ suggest editor lives in the shared edit-links runtime
(`cat-harness-tools/src/core/edit-links.ts`); what is here is what a **paper**
needs from it and no other profile does.

| | |
|---|---|
| [`latex-check.ts`](latex-check.ts) | Pure checks over a block's Markdown: syntax (braces, `\begin`/`\end`, macro arity, `$$`), and references against the KG. |
| [`latex-check.test.ts`](latex-check.test.ts) | Held against a real block of this library — LeanArchitect §3.4, `prose-sec-006`. |

## The rule it keeps

Owner, 2026-10-14: *"I only want that the syntax is valid."* A reader may
change, add or delete any macro, reference or environment.

- **error** — not well-formed LaTeX: an unbalanced brace, an `\end` closing
  nothing or the wrong environment, an environment left open, a macro short of
  its arguments, an unclosed `$$`.
- **warning** — a `\ref`/`\eqref`/`\cref`/`\uses` label no block node carries,
  a `\cite` key the bibliography lacks. Never an error.

`checkSuggestion(before, after)` reports only what the edit **introduces**, so
an untouched block reports nothing and an ingested block's own OCR defects are
not blamed on the reader.

## Where the pieces come from

- **Macro arity**: built-ins, then the paper preamble's `\newcommand`s
  ([`../latex/paper-preamble.tex`](../latex/paper-preamble.tex)), then the
  paper's `manifest.macros` — counted the way `blueprint-layout.ts`'s
  `macroArity` counts them. A macro with no known shape is not checked.
- **Labels**: the `label` of each block node, as `gen-block-jsonld` writes it.
- **KaTeX rendering** is not here: the editor should get the same table the
  site renderer does, `katexMacros(manifest.macros)` in folio-assistant-core's
  `build-document-site.ts`, published with the page config.

## What the runtime still needs (cat-harness-tools, not here)

A checker hook: the page config names checker modules, the runtime imports
them lazily beside Crepe and calls `checkSuggestion(before, after, ctx)`,
showing errors and warnings in its panel. `latexSpans` / `protectLatex` give
the spans (environments, argument-taking commands outside math) to keep
verbatim with the runtime's ⟦ ⟧ convention.

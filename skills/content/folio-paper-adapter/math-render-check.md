---
name: math-render-check
description: >-
  The math half of the harness's markdown-render-check: grep checks for
  display math, KaTeX and LaTeX patterns that GitHub's renderer breaks, and
  the fix recipe for multi-line display equations.
---

# Math render check

The harness skill `markdown-render-check` checks any `.md` content block
before the user sees it on GitHub. A paper folio's blocks carry math
(`$...$`, `$$...$$`, fenced ```tex blocks), and GitHub's renderer breaks
some math patterns that the LaTeX pipeline accepts, especially display
blocks hijacked by markdown's list parser. These checks lived in
`markdown-render-check` until 2026-10-24 and moved here under bean `syiq`
(the owner's ruling Q3 of 2026-10-01: split markdown-render-check).

Run them in step 2 of `markdown-render-check`, beside its own checks, and
report the same way.

## When to use

- After editing any `.md` file that contains math.
- After authoring a new `.md` with multi-line display math, or tables and
  lists next to math.

## Grep checks for math

| Check | Grep | What breaks |
|-------|------|-------------|
| `+` / `-` / `*` at line start inside `$$...$$` | `awk '/^\$\$/{m=!m; next} m && /^[+\-*] /' file.md` | Continuation line of a multi-line display equation gets parsed as a bulleted list, breaking out of math mode. |
| Missing blank line before `$$` | `grep -nB1 '^\$\$' file.md \| awk 'NR%3==1 && $0!~/^--$/ && $0!~/^[[:space:]]*$/' ` | `mdToHtml` regex needs a paragraph break before `$$` to detect display math. |
| `\operatorname{` in math | `grep -n '\\\\operatorname{' file.md` | KaTeX rejects without an extension; use `\mathrm{}`. |
| `\cite{` reference | `grep -n '\\\\cite{' file.md` | OK in this repo (handled by both pipelines), but verify the key exists in `references.ts`. |
| Bare `_` outside math | `grep -nE '[^$\\][_][^$]' file.md` | LaTeX subscript trigger; wrap identifier in backticks or `$...$`. |

## Multi-line display equations — fix recipe

The single most common breakage. **Wrong** (each `+` becomes a bullet):

```md
$$
F(x) = a
+ b
+ c
$$
```

**Right** — operator at end of line, no list trigger:

```md
$$
F(x) = a \;+\;
       b \;+\;
       c
$$
```

`\;` controls the spacing; `,`/`;` after the operator are also fine.
The rule: never start a line inside `$$...$$` with `+`, `-`, or `*`.

## Cross-references

- `markdown-render-check` (harness) — the generic checks these sit beside.
- `latex-validation` — LaTeX-side render checks (complementary).
- `rendering-auditor` — full pass over rendered LaTeX/HTML output.

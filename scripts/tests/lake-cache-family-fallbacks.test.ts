/**
 * The Lean cache scripts' BUILT-IN family names agree with each other.
 *
 * A family's name is the declaring folio's `storage.branchPrefix`, read first
 * by every script (owner, 2026-10-05); each script keeps the same built-in
 * names only as a fallback when nothing is declared. So the drift worth
 * catching is between the scripts themselves — one whose fallback list lost a
 * name, or reordered it, resolves a different branch from the rest when no
 * declaration is present.
 *
 * Moved here with the scripts from the tools layer's
 * `cache-family-fallbacks.test.ts` (folio-assistant#2598): the lake-cache half
 * is this layer's, and the tools layer keeps the rest. The restore action of
 * the paper template is checked by `paper-templates.test.ts`.
 *
 * Each script names the names as whole tokens: `lake-cache` is a substring of
 * both newer names, so a bare `toContain` would pass a file that never names it.
 *
 * @module folio-assistant-sci/scripts/tests/lake-cache-family-fallbacks
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPTS = resolve(import.meta.dir, "..");

/** Newest first: the name a script writes when nothing exists, then its legacy names in resolution order. */
const NAMES = ["cat/folio-assistant-sci/lake-cache", "cat-lake-cache", "lake-cache"] as const;
const FILES = [
  "lake-cache.sh",
  "lake-cache-fetch.sh",
  "lake-cache-fetch-multi.py",
  "lake-cache-produce.py",
  "reseed-lean-cache.sh",
] as const;

const esc = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Index of the first whole-token occurrence of `name` in `text`, or -1. */
function tokenAt(text: string, name: string): number {
  const m = new RegExp(`(?<![\\w/-])${esc(name)}(?![\\w.-])`).exec(text);
  return m ? m.index : -1;
}

describe("the Lean cache scripts carry the same built-in fallback names, in the same order", () => {
  for (const file of FILES) {
    test(`${file}: every lake-cache name, newest first`, () => {
      const text = readFileSync(resolve(SCRIPTS, file), "utf-8");
      for (const n of NAMES) expect(tokenAt(text, n), `${file} names ${n}`).toBeGreaterThanOrEqual(0);
    });
  }

  // The order matters where the list is written as one literal. Pinned on the
  // literal a reader would copy: lake-cache.sh's.
  test("lake-cache.sh's fallback list is newest first", () => {
    const text = readFileSync(resolve(SCRIPTS, "lake-cache.sh"), "utf-8");
    expect(text).toContain('CACHE_PREFIX="cat/folio-assistant-sci/lake-cache"');
    expect(text).toContain('LEGACY_CACHE_PREFIXES="cat-lake-cache lake-cache"');
  });
});

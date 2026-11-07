Feature: the Lean cache scripts carry the same built-in cache family name, and no retired one

  @test:scripts/tests/lake-cache-family-fallbacks.test.ts::scriptNamesNewFamilyOnly
  Scenario Outline: <file>: the new family only
    When the script <file> is read
    Then it contains the literal <literal>

    Examples:
      | file                      | literal                                                         |
      | lake-cache.sh             | LEGACY_CACHE_PREFIXES=""                                        |
      | lake-cache-fetch.sh       | CANDIDATES="cat/folio-assistant-sci/lake-cache/qou-${slug}"     |
      | lake-cache-fetch-multi.py | CACHE_PREFIXES = ("cat/folio-assistant-sci/lake-cache/",)       |
      | lake-cache-produce.py     | CACHE_PREFIXES = ("cat/folio-assistant-sci/lake-cache/",)       |
      | reseed-lean-cache.sh      | _cands="cat/folio-assistant-sci/lake-cache"                     |

  @test:scripts/tests/lake-cache-family-fallbacks.test.ts::lakeCacheWritesNewNameByDefault
  Scenario: lake-cache.sh writes the new name when nothing is declared
    When lake-cache.sh is read
    Then it contains CACHE_PREFIX="cat/folio-assistant-sci/lake-cache"

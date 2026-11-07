Feature: Lean declaration starts are detected once, and shared by every projection

  @test:scripts/tests/lean-decl-starts-are-shared.test.ts::charAndLineSpansSameNames
  Scenario: character spans and line spans report the SAME names, in order
    Given Lean source with a theorem, an axiom, an unsafe def, an opaque and a namespaced def, comments stripped
    Then leanDeclSpans and splitDeclarations report the same names in the same order

  @test:scripts/tests/lean-decl-starts-are-shared.test.ts::offsetsToStrippedLineNumbers
  Scenario: offsets convert to STRIPPED-text line numbers exactly
    Given source with a line comment, def a, a two-line block comment and def b
    When its comments are stripped
    Then the stripped text is as long as the source
    And leanDeclSpans puts a on line 2 and b on line 5

  @test:scripts/tests/lean-decl-starts-are-shared.test.ts::lineSpanSlicesItsDecl
  Scenario: a line span indexes the stripped text it will be sliced from
    Given source with a two-line module doc comment, def a and def b, comments stripped
    Then slicing the stripped lines by each span yields text containing "def <name>"

  @test:scripts/tests/lean-decl-starts-are-shared.test.ts::matchNotStartOnBlankLine
  Scenario: a match cannot begin on a blank line above its declaration
    Given "def a := 1", two blank lines and "def b := 2", comments stripped
    Then leanDeclSpans puts a on line 1 and b on line 4

  @test:scripts/tests/lean-decl-starts-are-shared.test.ts::namespaceMembersDistinctKeys
  Scenario: the namespace members are distinct keys, not one
    Given Lean source declaring Monomial, structure AlgElement, AlgElement.add and AlgElement.sub
    Then leanDeclSpans names them Monomial, AlgElement, AlgElement.add and AlgElement.sub, all distinct

  @test:scripts/tests/lean-decl-starts-are-shared.test.ts::scopeReachesReferencesNotSiblings
  Scenario: a scope reaches what it references, not its namespace siblings
    When scopeLeanToDecl scopes that source to AlgElement
    Then the scope is defined
    And it keeps "abbrev Monomial" and "structure AlgElement"
    And it does not keep AlgElement.sub

  @test:scripts/tests/lean-decl-starts-are-shared.test.ts::onlyFiveModulesCarryLocalPattern
  Scenario: only the five pre-existing modules carry a local pattern, and the list may only shrink
    Given every non-test .ts file in this repository
    Then the ones with an uncommented "theorem|lemma|def" pattern are exactly pipeline/conjectural-propagation-audit.ts, pipeline/generate-lean-stubs.ts, pipeline/lean-formal-ref.ts, pipeline/proof-narrative-lean-equiv-sweep.ts and scripts/lean-coverage.ts

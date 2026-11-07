Feature: check-editor-checkers — an editor-checkers node is judged on what the runtime loads

  @test:scripts/check-editor-checkers.test.ts::exportsNameReadsDeclsAndAliases
  Scenario: declarations and export lists, with aliases
    Then exportsName finds checkSuggestion in "export function checkSuggestion() {}"
    And it finds x in "export const x = 1;"
    And in "export { a as b }" it finds b but not a
    And it does not find gone in a commented-out export

  @test:scripts/check-editor-checkers.test.ts::nodeWithCodePresentIsClean
  Scenario: a node whose code is there is clean
    Given a/check.ts exporting checkSuggestion
    And editor-checkers/n.json whose check is "a/check.ts#checkSuggestion"
    When judgeEditorChecker judges the node
    Then there are no findings

  @test:scripts/check-editor-checkers.test.ts::missingFileOrExportIsFinding
  Scenario: a missing file and a missing export are findings
    When a node's check is "a/none.ts#checkSuggestion"
    Then a finding says "no file a/none.ts"
    When a node's macros is "a/check.ts#macroTable"
    Then a finding says "exports no macroTable"

  @test:scripts/check-editor-checkers.test.ts::unparsedOrMisnamedNodeIsFinding
  Scenario: a node that does not parse, or whose id is not its file name, is a finding
    When a node's check is "../escape.ts#x"
    Then a finding says "not a folio-editor-checker/v1 node"
    When a node with id "n" is in m.json
    Then a finding says id "n" is not its file name "m"

  @test:scripts/check-editor-checkers.test.ts::ownNodesClean
  Scenario: this instance's own nodes are clean
    When judgeEditorChecker judges this instance's editor-checkers/paper-latex.json
    Then there are no findings

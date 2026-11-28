Feature: lean-kg-viewer — static guards on the published viewer's source

  @test:adapters/paper/lean/lean-kg-viewer.test.ts::lean-kg-viewer::thirdPartyScriptsPinnedWithSri
  Scenario: every third-party script is version-pinned and carries SRI + crossorigin
    Given the external script tags of lean-kg-viewer/index.html
    Then there is at least one
    And each src names an exact x.y.z version
    And each tag has a sha384 or sha512 integrity attribute and crossorigin="anonymous"

  @test:adapters/paper/lean/lean-kg-viewer.test.ts::lean-kg-viewer::domPurifyLoaded
  Scenario: DOMPurify is loaded
    Then one external script is DOMPurify's dist/purify.js or purify.min.js

  @test:adapters/paper/lean/lean-kg-viewer.test.ts::lean-kg-viewer::innerHtmlOnlyFromPurify
  Scenario: innerHTML is assigned only from DOMPurify's output
    Given the source of viewer.js
    Then it assigns innerHTML exactly once, from purify.sanitize(
    And it uses no outerHTML assignment, insertAdjacentHTML or document.write

  @test:adapters/paper/lean/lean-kg-viewer.test.ts::lean-kg-viewer::fallsBackToTextWithoutPurify
  Scenario: without DOMPurify the viewer falls back to text, not raw HTML
    Given the source of viewer.js
    Then it renders HTML only when both window.marked and window.DOMPurify exist
    And otherwise it sets the node's textContent

  @test:adapters/paper/lean/lean-kg-viewer.test.ts::lean-kg-viewer::blockBadgeOpensThePaperWhenPaperBaseIsSet
  Scenario: a block badge opens the rendered paper when config.json names paperBase
    Given the source of viewer.js
    Then with config.paperBase a block links to <paperBase><paper>/#<label>
    And every block href passes through safeHref

  @test:adapters/paper/lean/lean-kg-viewer.test.ts::lean-kg-viewer::treeHidesEmptyModulesAndListsBlocksApart
  Scenario: the module list hides empty modules and lists block files apart from the libraries
    Given the source of viewer.js
    Then a module with no declarations is listed only when the reader asks for empty modules
    And the library tree holds only modules that are not a block's own Lean file
    And block files are listed under "Formalized blocks"

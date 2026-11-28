Feature: lean-kg-ingest — turning doc-gen4 doc-data into the Lean KG viewer's data

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest::moduleOfDocPathMapsModuleFragment
  Scenario: moduleOfDocPath maps doc-gen4 paths to module + fragment
    Then "./QOU/Mass/X.html#QOU.Mass.X.y" maps to module "QOU.Mass.X" and fragment "QOU.Mass.X.y"
    And "./foundational_types.html" maps to nothing

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest::rewriteHeaderRoutesLinks
  Scenario: rewriteHeader routes kept modules to the viewer and the rest to the external docs
    Given the header of QOU.A.x, linking to itself and to Mathlib's Field
    When rewriteHeader rewrites it keeping the root "qou" with external docs at "https://ext/"
    Then the link to QOU.A.x is "#/m/QOU.A/QOU.A.x"
    And the link to Field is "https://ext/Mathlib/Algebra/Field/Defs.html#Field"

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest::ingestPrunesChunksLinks
  Scenario: ingest prunes to kept roots, chunks signatures, links lean.ref blocks
    Given doc-data for QOU.A (2 declarations), QOU.Big (CHUNK_SIZE + 3) and a Mathlib module
    And a content block prop:x whose lean.ref is "qou:QOU.A.x"
    When ingest runs keeping the module root QOU
    Then it reports 2 modules, 2 + CHUNK_SIZE + 3 declarations and 1 formalized
    And index.json lists QOU.A and QOU.Big, with QOU.Big in 2 chunks
    And the QOU.Big files are QOU.Big.0.sig.json, QOU.Big.1.sig.json and QOU.Big.jsonld
    And in QOU.A.jsonld, QOU.A.x formalizes block:prop:x with md "ch/blk.md", via lean.ref

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest::overlayWritesOnlyChangedModules
  Scenario: overlay mode writes only changed modules
    Given a base ingest of the fixture
    And QOU.A's doc-data then changed to a single declaration QOU.A.z
    When ingest runs again with that base and its index
    Then it writes 1 module and leaves 1 unchanged
    And overlay.json lists only QOU.A as changed
    And no QOU.Big file is written

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest::refusesNonDocGenDir
  Scenario: ingest refuses a directory that is not doc-gen4 doc-data
    When ingest runs on an empty directory
    Then it throws "not a doc-gen4"

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::signatureStyles::signatureStylesScopedDropsLayout
  Scenario: keeps custom properties and signature rules, scoped; drops page layout
    Given CSS with rules for *, body, nav, :root, .decl_header and ".fn, .impl_arg", and a dark-mode media query
    When signatureStyles filters it
    Then it keeps ":root{ --x: 1 }"
    And it scopes .decl_header and .impl_arg under .lkg-sig
    And it has no rule for body, nav or *
    And it keeps the media query with only its :root rule

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest-paper-links::sourcePathReadsTheRepositoryPath
  Scenario: a declaration's sourceLink names its repository path
    When sourcePath reads "https://github.com/o/r/blob/abc123/folio/p/c/x.lean#L3-L9"
    Then it returns "folio/p/c/x.lean"
    And a link with no /blob/<ref>/ segment, or none at all, gives nothing

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest-paper-links::collectContentBlocksFindsRefsAndSiblings
  Scenario: the content tree yields lean.refs and block .lean siblings
    Given a block def:sib with a .lean sibling and a block prop:lib whose lean.ref is "qou:QOU.A.x"
    When collectContentBlocks reads it with content prefix "folio/"
    Then QOU.A.x maps to prop:lib
    And "folio/paper/ch/sib.lean" maps to def:sib

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest-paper-links::attachBlocksLinksSiblingAndRefAndMarksTheModule
  Scenario: declarations in a block's own .lean file link to that block, and stale edges are replaced
    Given a module whose declarations all have their source in def:sib's .lean sibling, one named by prop:lib's lean.ref and one carrying a stale edge
    When attachBlocks links the graph
    Then both declarations formalize def:sib via sibling, the first also prop:lib via lean.ref
    And the stale edge is gone
    And the module node carries block def:sib

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest-paper-links::attachBlocksMarksTheModuleWhenTheBlockAlsoNamesItByLeanRef
  Scenario: a block's own .lean file is marked even when the block also names its declaration by lean.ref
    Given a block prop:b whose lean.ref names Ch.B.t, which sits in prop:b's .lean sibling
    When attachBlocks links the module
    Then the declaration has one edge to prop:b, via lean.ref
    And the module carries block prop:b

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest-paper-links::attachBlocksLeavesALibraryModuleUnmarked
  Scenario: a library module is not marked as a block
    Given a library module with an old block mark
    When attachBlocks links it
    Then only the declaration named by a lean.ref formalizes a block
    And the module carries no block

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest-paper-links::splitFromKgRelinksAStaleStoreAgainstCurrentContent
  Scenario: a split with content blocks re-links the published store
    Given a published KG built with no content root, holding a block sibling module and an empty module
    When splitFromKg cuts it with the current content blocks
    Then the sibling module's index entry carries its block, and its declaration formalizes it via sibling
    And the empty module carries no block

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest_—_one_sub-KG_per_package_(root_bases,_split)::parseSiblingsMapsEachRootToItsPackageBesideThisOne
  Scenario: --sibling values map each module root to its package's viewer beside this one
    When parseSiblings reads "qou/QOU,qou/MassTheory" and "ugb/UGB"
    Then qou and masstheory map to ../qou/ and ugb to ../ugb/
    And a value without a package, with a path, or with other characters is refused

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest_—_one_sub-KG_per_package_(root_bases,_split)::rewriteHeaderSendsSiblingRootToItsSubKgAndMathlibOutside
  Scenario: a signature link into a sibling package goes to its sub-KG
    Given a Fred2005 signature linking to Fred2005, QOU and Mathlib declarations
    When rewriteHeader keeps fred2005 with qou as a sibling
    Then the Fred2005 link is a viewer route, the QOU link goes to ../qou/ and Mathlib to the external docs

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest_—_one_sub-KG_per_package_(root_bases,_split)::linkForWithoutSiblingFallsBackToExternalDocPath
  Scenario: a root that is neither kept nor a sibling goes to the external docs
    When linkFor routes QOU.A.x keeping only fred2005, with no siblings
    Then it returns the external doc-gen4 page for QOU/A.html#QOU.A.x

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest_—_one_sub-KG_per_package_(root_bases,_split)::rerouteSignatureRewritesOnlyRoutesOutOfTheKeptRoots
  Scenario: re-routing an already-published signature touches only routes out of the kept roots
    Given viewer routes into QOU, UGB and another root, and an external link
    When rerouteSignature keeps qou with ugb as a sibling
    Then the QOU route stays, the UGB route goes to ../ugb/, the other root to the external docs, and the external link is unchanged

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest_—_one_sub-KG_per_package_(root_bases,_split)::splitFromKgCutsOnePackageWithNoDocData
  Scenario: one package's sub-KG is cut from a combined KG with no doc-data
    Given a combined KG of QOU and Fred2005
    When splitFromKg keeps Fred2005 with qou as a sibling
    Then it writes 1 module and 1 declaration, renumbers names.json and sends the QOU link to ../qou/
    And the QOU split keeps both QOU declarations

  @test:adapters/paper/lean/lean-kg-ingest.test.ts::lean-kg-ingest_—_one_sub-KG_per_package_(root_bases,_split)::splitFromKgRefusesOverlayEmptySelectionAndNonKg
  Scenario: the split refuses a directory that is not a KG, an empty selection, and an overlay
    Then each throws with its reason

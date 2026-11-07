Feature: the lean-toolchain role held to its contract

  @test:schemas/lean-toolchain-contract.test.ts::playedBySystemActorWithContract
  Scenario: played only by a system Actor, carrying lean-toolchain-contract
    Given the lean-toolchain role in scenarios/roles.json
    Then it is played only by system Actors
    And it carries the skill lean-toolchain-contract

  @test:schemas/lean-toolchain-contract.test.ts::actorPlaysRoleWithCapability
  Scenario: the Actor named in the contract plays it, with the lean-toolchain capability
    Given the actor scenarios/actors/lean-mcp.json
    Then it is a system Actor that plays lean-toolchain and has the lean-toolchain capability

  @test:schemas/lean-toolchain-contract.test.ts::capabilitySatisfiesLeanCompiles
  Scenario: the capability satisfies req:lean-verification#lean-compiles
    Then the lean-toolchain capability satisfies req:lean-verification#lean-compiles

  @test:schemas/lean-toolchain-contract.test.ts::leanCompilesStatementDemandsCleanBuild
  Scenario: that statement demands exactly that: lake build, exit code 0, no compilation errors, verified by test
    Given the lean-compiles statement of skills/requirements/lean-verification.json
    Then its requirement names "`lake build` without errors"
    And it has one success criterion naming "exit code 0" and "no compilation errors", verified by test

  @test:schemas/lean-toolchain-contract.test.ts::detectionIsLeanVersion
  Scenario: detection is the command `lean --version`
    Then the lean-toolchain capability is detected by the command "lean --version"

  @test:schemas/lean-toolchain-contract.test.ts::fallbackIsLeanMcp
  Scenario: the fallback is lean-mcp, which runs Lean server-side and so does not itself need a local toolchain
    Then the lean-toolchain capability falls back to lean-mcp
    And the lean-mcp capability is detected by an MCP probe and does not require lean-toolchain

  @test:schemas/lean-toolchain-contract.test.ts::toolWritesCommittableStatus
  Scenario: the lean-build Tool writes the committable lean-build-status.json as its output
    Given the lean-build Tool
    Then its id is "lean-build"
    And its "status" output's description names lean-build-status.json and says it is committable

  @test:schemas/lean-toolchain-contract.test.ts::toolDeclaresRuntimeNeeds
  Scenario: and it says what it needs to run, rather than leaving a caller to find out
    Then the lean-build Tool's runtime requirements include lean and lake

  @test:schemas/lean-toolchain-contract.test.ts::sorryTrackingByInspectionOnly
  Scenario: req:lean-verification#sorry-tracking is verified by inspection only
    Given the sorry-tracking statement
    Then its only verification method is inspection

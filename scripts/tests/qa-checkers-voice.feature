Feature: checkEditorializing over this instance's milnorlink library entry

  @test:scripts/tests/qa-checkers-voice.test.ts::milnorlinkExemplarScoresOneFinding
  Scenario: the exemplar scores exactly ONE finding — not zero
    Given the milnorlink entry of this instance's declared libraries
    Then the entry is found
    When checkEditorializing runs over every .md file in its sections directory
    Then the hits add up to exactly 1

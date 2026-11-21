import { describe, expect, it } from "vitest";
import { nextStatusAfterStep, quorumReached, requiredApprovals, roleForStep, stepForStatus } from "../../src/domain/stateMachine";

describe("M04 routing by batch size", () => {
  it("M04 small batch goes district -> state review", () => {
    expect(nextStatusAfterStep("DISTRICT", 4, 5)).toBe("STATE_REVIEW");
  });

  it("M04 batch at the threshold goes through quality review", () => {
    expect(nextStatusAfterStep("DISTRICT", 5, 5)).toBe("QUALITY_REVIEW");
    expect(nextStatusAfterStep("DISTRICT", 500, 5)).toBe("QUALITY_REVIEW");
  });

  it("M04 quality then state then approved", () => {
    expect(nextStatusAfterStep("QUALITY", 500, 5)).toBe("STATE_REVIEW");
    expect(nextStatusAfterStep("STATE", 500, 5)).toBe("APPROVED");
  });

  it("M04 only the three review statuses have a step", () => {
    expect(stepForStatus("DISTRICT_REVIEW")).toBe("DISTRICT");
    expect(stepForStatus("QUALITY_REVIEW")).toBe("QUALITY");
    expect(stepForStatus("STATE_REVIEW")).toBe("STATE");
    for (const status of ["DRAFT", "APPROVED", "ISSUING", "ISSUED", "CHANGES_REQUESTED", "REJECTED"] as const) {
      expect(stepForStatus(status)).toBeNull();
    }
  });

  it("M04 each step needs its own role", () => {
    expect(roleForStep("DISTRICT")).toBe("DISTRICT_OFFICER");
    expect(roleForStep("QUALITY")).toBe("QUALITY_OFFICER");
    expect(roleForStep("STATE")).toBe("STATE_OFFICER");
  });
});

describe("M05 quorum", () => {
  it("M05 needs two distinct officers", () => {
    expect(quorumReached(["a"], 2)).toBe(false);
    expect(quorumReached(["a", "a"], 2)).toBe(false);
    expect(quorumReached(["a", "b"], 2)).toBe(true);
  });

  it("M05 only the district step needs the quorum", () => {
    expect(requiredApprovals("DISTRICT", 2)).toBe(2);
    expect(requiredApprovals("QUALITY", 2)).toBe(1);
    expect(requiredApprovals("STATE", 2)).toBe(1);
  });
});

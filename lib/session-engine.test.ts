import { describe, expect, it } from "vitest";
import type { PawlyEvent } from "./domain";
import { deriveState, summarizeWithRules } from "./session-engine";

const event = (type: PawlyEvent["type"], minutesAgo = 0): PawlyEvent => ({
  id: `${type}-${minutesAgo}`,
  type,
  occurredAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  confidence: 0.8,
  message: type,
});

describe("session engine", () => {
  it("does not describe a disconnected room as calm", () => {
    expect(deriveState([], false)).toBe("connecting");
  });

  it("marks a paused camera unavailable", () => {
    expect(deriveState([event("camera_paused")], true)).toBe("unavailable");
  });

  it("keeps duration increases conservative", () => {
    const summary = summarizeWithRules(
      [event("settled")],
      Date.now() - 10 * 60000,
      Date.now(),
    );
    expect(summary.nextStep).toContain("11 minutes");
  });

  it("reduces the next duration after repeated motion", () => {
    const events = Array.from({ length: 6 }, (_, index) => event("motion_active", index));
    const summary = summarizeWithRules(events, Date.now() - 12 * 60000, Date.now());
    expect(summary.nextStep).toContain("9 minutes");
  });
});

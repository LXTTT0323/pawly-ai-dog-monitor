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

  it("suggests meaningful quick-check steps instead of one-minute increments", () => {
    const summary = summarizeWithRules(
      [event("settled")],
      Date.now() - 10 * 60000,
      Date.now(),
      10,
      "quick_check",
    );
    expect(summary.nextStep).toContain("15-minute");
  });

  it("does not prescribe a shorter real-world outing from motion alone", () => {
    const events = Array.from({ length: 6 }, (_, index) => event("motion_active", index));
    const summary = summarizeWithRules(
      events,
      Date.now() - 180 * 60000,
      Date.now(),
      180,
      "away_monitoring",
    );
    expect(summary.nextStep).toContain("next outing of a similar length");
  });

  it("measures the first activity transition and longest calm span", () => {
    const now = Date.now();
    const events: PawlyEvent[] = [
      { ...event("motion_active"), occurredAt: new Date(now - 40 * 60000).toISOString() },
      { ...event("settled"), occurredAt: new Date(now - 30 * 60000).toISOString() },
    ];
    const summary = summarizeWithRules(events, now - 60 * 60000, now, 60);
    expect(summary.firstActivityMinute).toBe(20);
    expect(summary.longestCalmMinutes).toBe(30);
  });
});

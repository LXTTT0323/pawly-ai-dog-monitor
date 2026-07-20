import type { BehaviorState, PawlyEvent, SessionSummary } from "./domain";

export function deriveState(events: PawlyEvent[], connected: boolean): BehaviorState {
  if (!connected) return "connecting";
  const latest = events[0];
  if (!latest) return "calm";
  if (latest.type === "camera_paused" || latest.type === "camera_stopped") return "unavailable";
  if (latest.type === "motion_active") return "active";
  return "calm";
}

export function summarizeWithRules(
  events: PawlyEvent[],
  startedAt: number,
  endedAt = Date.now(),
): SessionSummary {
  const totalMinutes = Math.max(1, Math.round((endedAt - startedAt) / 60000));
  const activeEvents = events.filter((event) => event.type === "motion_active").length;
  const unavailable = events.some(
    (event) => event.type === "camera_paused" || event.type === "camera_stopped",
  );
  const estimatedActiveMinutes = Math.min(totalMinutes, Math.ceil(activeEvents * 0.5));
  const calmMinutes = Math.max(0, totalMinutes - estimatedActiveMinutes);
  const calmRatio = calmMinutes / totalMinutes;

  let nextStep = "Repeat the same duration once more before increasing it.";
  if (!unavailable && calmRatio >= 0.8 && activeEvents <= 2) {
    nextStep = `Try ${Math.min(totalMinutes + 1, Math.ceil(totalMinutes * 1.15))} minutes next time.`;
  } else if (activeEvents >= 5) {
    nextStep = `Reduce the next session to ${Math.max(1, Math.floor(totalMinutes * 0.75))} minutes.`;
  }

  return {
    headline: unavailable
      ? "Part of this session could not be observed"
      : calmRatio >= 0.8
        ? "A mostly calm session"
        : "An active session worth repeating",
    calmMinutes,
    activeEvents,
    longestCalmMinutes: calmMinutes,
    nextStep,
    source: "rules",
  };
}

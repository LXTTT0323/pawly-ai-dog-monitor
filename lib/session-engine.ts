import type { BehaviorState, PawlyEvent, SessionKind, SessionSummary } from "./domain";

export function deriveState(events: PawlyEvent[], connected: boolean): BehaviorState {
  if (!connected) return "connecting";
  const latest = events[0];
  if (!latest) return "calm";
  if (latest.type === "camera_paused" || latest.type === "camera_stopped") return "unavailable";
  if (latest.type === "dog_not_visible") return "out_of_view";
  if (latest.type === "motion_active" || latest.type === "sound_active" || latest.type === "repeated_movement") return "active";
  return "calm";
}

export function summarizeWithRules(
  events: PawlyEvent[],
  startedAt: number,
  endedAt = Date.now(),
  targetMinutes?: number,
  sessionKind: SessionKind = "away_monitoring",
): SessionSummary {
  const observedMs = Math.max(1_000, endedAt - startedAt);
  const observedSeconds = Math.max(1, Math.round(observedMs / 1_000));
  const observedMinutes = Math.max(0.02, Math.round((observedMs / 60_000) * 100) / 100);
  const orderedEvents = [...events]
    .filter((event) => {
      const timestamp = Date.parse(event.occurredAt);
      return Number.isFinite(timestamp) && timestamp >= startedAt && timestamp <= endedAt;
    })
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const activeTypes = new Set(["motion_active", "sound_active", "repeated_movement"]);
  const settledTypes = new Set(["settled", "sound_settled"]);
  const activeEvents = orderedEvents.filter((event) => activeTypes.has(event.type)).length;
  const movementEvents = orderedEvents.filter((event) => event.type === "motion_active" || event.type === "repeated_movement").length;
  const soundEvents = orderedEvents.filter((event) => event.type === "sound_active").length;
  const outOfViewEvents = orderedEvents.filter((event) => event.type === "dog_not_visible").length;
  const unavailable = orderedEvents.some(
    (event) => event.type === "camera_paused" || event.type === "camera_stopped",
  );

  let state: "calm" | "active" = "calm";
  let stateStartedAt = startedAt;
  let calmMs = 0;
  let longestCalmMs = 0;
  let firstActivityMinute: number | null = null;
  let firstActivitySecond: number | null = null;

  for (const event of orderedEvents) {
    const timestamp = Date.parse(event.occurredAt);
    if (activeTypes.has(event.type) && state === "calm") {
      const span = Math.max(0, timestamp - stateStartedAt);
      calmMs += span;
      longestCalmMs = Math.max(longestCalmMs, span);
      state = "active";
      stateStartedAt = timestamp;
      firstActivitySecond ??= Math.max(0, Math.round((timestamp - startedAt) / 1_000));
      firstActivityMinute ??= Math.max(0, Math.round(((timestamp - startedAt) / 60_000) * 10) / 10);
    }
    if (settledTypes.has(event.type) && state === "active") {
      state = "calm";
      stateStartedAt = timestamp;
    }
  }
  if (state === "calm") {
    const span = Math.max(0, endedAt - stateStartedAt);
    calmMs += span;
    longestCalmMs = Math.max(longestCalmMs, span);
  }

  const calmMinutes = activeEvents === 0
    ? observedMinutes
    : Math.min(observedMinutes, Math.round((calmMs / 60_000) * 100) / 100);
  const longestCalmMinutes = activeEvents === 0
    ? observedMinutes
    : Math.min(observedMinutes, Math.round((longestCalmMs / 60_000) * 100) / 100);
  const calmRatio = calmMinutes / observedMinutes;
  const target = targetMinutes ?? observedMinutes;

  let nextStep: string;
  if (unavailable) {
    nextStep = "Check the camera setup before using this session to make a training decision.";
  } else if (sessionKind === "away_monitoring") {
    nextStep = activeEvents === 0
      ? "Keep this as a baseline for the next similar outing. There is no need to increase the duration minute by minute."
      : "Compare this with the next outing of a similar length. Review sustained activity and recovery, not isolated movement.";
  } else if (calmRatio >= 0.8 && activeEvents <= 2) {
    const nextOptions = [15, 20, 30, 45, 60];
    const suggested = nextOptions.find((minutes) => minutes > target) ?? target;
    nextStep = suggested > target
      ? `This is a useful baseline. When convenient, compare it with a ${suggested}-minute check rather than adding one minute at a time.`
      : "This is a useful baseline. Repeat it once or move to a normal outing when it fits your day.";
  } else {
    nextStep = `Repeat a ${target}-minute check when you can supervise the result, and compare when activity began and whether your puppy settled again.`;
  }

  return {
    headline: unavailable
      ? "Part of this session could not be observed"
      : activeEvents === 0
        ? "No meaningful changes detected"
      : calmRatio >= 0.8
        ? "A mostly calm observation"
        : "An active observation with useful context",
    behaviorSummary: activeEvents === 0
      ? "No sustained movement or sound changes were detected during this observation."
      : `Pawly noticed ${movementEvents} movement change${movementEvents === 1 ? "" : "s"} and ${soundEvents} sustained sound event${soundEvents === 1 ? "" : "s"}.`,
    notablePatterns: [
      ...(movementEvents > 0 ? [`${movementEvents} meaningful movement change${movementEvents === 1 ? "" : "s"}`] : []),
      ...(soundEvents > 0 ? [`${soundEvents} sustained sound event${soundEvents === 1 ? "" : "s"}`] : []),
      ...(outOfViewEvents > 0 ? [`Dog moved out of view ${outOfViewEvents} time${outOfViewEvents === 1 ? "" : "s"}`] : []),
    ].slice(0, 3),
    observedMinutes,
    observedSeconds,
    calmMinutes,
    activeEvents,
    longestCalmMinutes,
    firstActivityMinute,
    firstActivitySecond,
    nextStep,
    source: "rules",
  };
}

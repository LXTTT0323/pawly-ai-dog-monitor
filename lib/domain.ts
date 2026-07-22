export type EventType =
  | "monitoring_started"
  | "motion_active"
  | "settled"
  | "dog_visible"
  | "dog_not_visible"
  | "sound_active"
  | "sound_settled"
  | "repeated_movement"
  | "camera_paused"
  | "camera_resumed"
  | "camera_stopped";

export type BehaviorState = "calm" | "active" | "out_of_view" | "unavailable" | "connecting";

export type SessionKind = "quick_check" | "away_monitoring";

export interface PawlyEvent {
  id: string;
  type: EventType;
  occurredAt: string;
  confidence: number;
  motionScore?: number;
  message: string;
}

export interface SessionSummary {
  headline: string;
  behaviorSummary: string;
  notablePatterns: string[];
  observedMinutes: number;
  calmMinutes: number;
  activeEvents: number;
  longestCalmMinutes: number;
  firstActivityMinute: number | null;
  nextStep: string;
  source: "rules" | "openai";
  estimatedAiCostUsd?: number;
}

export function createRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function isRoomCode(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{12}$/.test(value.toUpperCase());
}

export function eventMessage(type: EventType): string {
  const messages: Record<EventType, string> = {
    monitoring_started: "Monitoring started",
    motion_active: "Dog movement increased",
    settled: "Dog settled again",
    dog_visible: "Dog detected in the room",
    dog_not_visible: "Dog is out of view",
    sound_active: "Sustained sound noticed",
    sound_settled: "The room became quiet again",
    repeated_movement: "Repeated dog movement noticed",
    camera_paused: "Camera page is not visible",
    camera_resumed: "Camera monitoring resumed",
    camera_stopped: "Camera stopped monitoring",
  };
  return messages[type];
}

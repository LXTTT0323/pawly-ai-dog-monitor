export type EventType =
  | "monitoring_started"
  | "motion_active"
  | "settled"
  | "camera_paused"
  | "camera_resumed"
  | "camera_stopped";

export type BehaviorState = "calm" | "active" | "unavailable" | "connecting";

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
  calmMinutes: number;
  activeEvents: number;
  longestCalmMinutes: number;
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
    motion_active: "Movement increased",
    settled: "The room became calm again",
    camera_paused: "Camera page is not visible",
    camera_resumed: "Camera monitoring resumed",
    camera_stopped: "Camera stopped monitoring",
  };
  return messages[type];
}

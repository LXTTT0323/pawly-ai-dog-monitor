import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { SessionSummary } from "@/lib/domain";
import { isRoomCode } from "@/lib/domain";
import { getPawlyUser } from "@/lib/auth";
import { assertSameOrigin, noStoreHeaders } from "@/lib/request-security";
import { consumeRateLimit, getRoomByCode, logAccess } from "@/lib/security-store";
import { summarizeWithRules } from "@/lib/session-engine";

export const runtime = "nodejs";

const eventSchema = z.object({ id: z.string(), type: z.enum(["monitoring_started", "motion_active", "settled", "dog_visible", "dog_not_visible", "sound_active", "sound_settled", "repeated_movement", "camera_paused", "camera_resumed", "camera_repositioned", "camera_stopped"]), occurredAt: z.string(), confidence: z.number().min(0).max(1), motionScore: z.number().optional(), message: z.string().max(120) });
const bodySchema = z.object({ roomCode: z.string().transform((value) => value.toUpperCase()).refine(isRoomCode), dogName: z.string().max(60), sessionKind: z.enum(["quick_check", "away_monitoring"]).default("away_monitoring"), targetMinutes: z.number().int().min(1).max(720), startedAt: z.number(), events: z.array(eventSchema).max(100) });

const globalBudget = globalThis as typeof globalThis & { pawlyAiSpend?: number };
globalBudget.pawlyAiSpend ??= 0;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403, headers: noStoreHeaders() });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid session" }, { status: 400, headers: noStoreHeaders() });
  const user = await getPawlyUser();
  const room = await getRoomByCode(parsed.data.roomCode);
  if (!user || !room || room.ownerEmail !== user.email) {
    return NextResponse.json({ error: "Sign in as this room's owner" }, { status: 401, headers: noStoreHeaders() });
  }
  const fallback = summarizeWithRules(parsed.data.events, parsed.data.startedAt, Date.now(), parsed.data.targetMinutes, parsed.data.sessionKind);

  if (process.env.AI_FEATURE_ENABLED !== "true" || !process.env.OPENAI_API_KEY) {
    console.info("Pawly AI summary using rules", {
      featureEnabled: process.env.AI_FEATURE_ENABLED === "true",
      apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    });
    return NextResponse.json(fallback, { headers: noStoreHeaders() });
  }

  const dailyLimit = Number(process.env.AI_DAILY_REQUEST_LIMIT ?? 20);
  const monthlyBudget = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 5);
  if (!await consumeRateLimit(`ai:${user.email}`, dailyLimit, 24 * 60 * 60 * 1000) || globalBudget.pawlyAiSpend! >= monthlyBudget) {
    return NextResponse.json({ ...fallback, budgetLimited: true }, { headers: noStoreHeaders() });
  }

  const observedSeconds = fallback.observedSeconds ?? Math.max(1, Math.round(fallback.observedMinutes * 60));
  const observedDuration = observedSeconds < 60
    ? `${observedSeconds} seconds`
    : `${Math.floor(observedSeconds / 60)} minutes ${observedSeconds % 60} seconds`;
  const compactEvents = parsed.data.events
    .filter(({ type }) => type !== "camera_repositioned")
    .map(({ type, occurredAt, confidence }) => ({
      type,
      secondsAfterStart: Math.max(0, Math.round((Date.parse(occurredAt) - parsed.data.startedAt) / 1_000)),
      confidence,
    }));
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      reasoning: { effort: "none" },
      max_output_tokens: 300,
      store: false,
      input: `Summarize one pet room observation for the owner. Use only the relative-time sensor events provided. Describe observable behavior sequences such as movement, sustained sound, going out of view, and settling again. Never quote wall-clock times or UTC timestamps; use relative wording such as "7 seconds after monitoring began." Never label a sound as barking or meowing unless the events explicitly classify it. Camera reposition events have already been removed and must not be interpreted as pet behavior. Do not diagnose emotion, health, distress, or separation anxiety. Make the summary specific enough that a user can tell it came from these events, not a generic template. The session kind is ${parsed.data.sessionKind}; the user planned ${parsed.data.targetMinutes} minutes, but exactly ${observedDuration} were observed. Never round an observation shorter than one minute up to "1 minute", and never imply the full planned window was observed when it was not. For an away_monitoring session, never prescribe a longer or shorter absence from motion alone: compare sustained activity and recovery with a similar outing. For a quick_check session, suggest useful checkpoints such as 15, 20, 30, 45, or 60 minutes instead of minute-by-minute progression. Pet: ${parsed.data.dogName}. Events: ${JSON.stringify(compactEvents)}`,
      text: { verbosity: "low", format: { type: "json_schema", name: "pawly_session_summary", strict: true, schema: { type: "object", additionalProperties: false, properties: { headline: { type: "string" }, behaviorSummary: { type: "string" }, notablePatterns: { type: "array", items: { type: "string" }, maxItems: 3 }, nextStep: { type: "string" } }, required: ["headline", "behaviorSummary", "notablePatterns", "nextStep"] } } },
    });
    const result = JSON.parse(response.output_text) as Pick<SessionSummary, "headline" | "behaviorSummary" | "notablePatterns" | "nextStep">;
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const estimatedAiCostUsd = inputTokens / 1_000_000 + (outputTokens * 6) / 1_000_000;
    globalBudget.pawlyAiSpend! += estimatedAiCostUsd;
    await logAccess(room.id, "owner", user.email, "ai_summary_created");
    return NextResponse.json({ ...fallback, ...result, source: "openai", estimatedAiCostUsd }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("Pawly AI summary failed", error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "UnknownError", message: "Unknown AI summary failure" });
    return NextResponse.json(fallback, { headers: noStoreHeaders() });
  }
}

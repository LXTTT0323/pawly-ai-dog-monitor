"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "./brand";
import type { PawlyEvent, SessionKind, SessionSummary } from "@/lib/domain";
import { deriveState, summarizeWithRules } from "@/lib/session-engine";

interface Props { roomCode: string; }

const stateCopy = { calm: ["Calm", "The room has settled"], active: ["Active", "Movement is elevated"], unavailable: ["Unavailable", "The camera needs attention"], connecting: ["Connecting", "Looking for the camera"] } as const;
const durationOptions: Record<SessionKind, number[]> = {
  quick_check: [10, 15, 20, 30],
  away_monitoring: [30, 60, 120, 180, 240],
};

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function OwnerRoom({ roomCode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<PawlyEvent[]>([]);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [sessionKind, setSessionKind] = useState<SessionKind>("away_monitoring");
  const [targetMinutes, setTargetMinutes] = useState(180);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [wakeSent, setWakeSent] = useState(false);
  const state = deriveState(events, connected);

  const connect = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/livekit-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomCode, role: "owner" }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not join room");
      const { token, serverUrl } = await response.json();
      const room = new Room({ adaptiveStream: true, disconnectOnPageLeave: true });
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current); });
      room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach());
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== "pawly-event") return;
        try {
          const event = JSON.parse(new TextDecoder().decode(payload)) as PawlyEvent;
          setEvents((current) => [event, ...current].slice(0, 100));
          if (document.hidden && event.type === "motion_active" && Notification.permission === "granted") new Notification("Pawly noticed more movement", { body: "Open the room to check in." });
        } catch { /* ignore malformed participant data */ }
      });
      room.on(RoomEvent.ParticipantConnected, () => setConnected(true));
      room.on(RoomEvent.ParticipantDisconnected, () => setConnected(room.remoteParticipants.size > 0));
      room.on(RoomEvent.Disconnected, () => setConnected(false));
      await room.connect(serverUrl, token);
      setConnected(room.remoteParticipants.size > 0);
      for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) if (publication.track?.kind === Track.Kind.Video && videoRef.current) publication.track.attach(videoRef.current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join room"); }
  }, [roomCode]);

  useEffect(() => {
    // Connection state is synchronized from the external LiveKit room.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void connect();
    return () => { void roomRef.current?.disconnect(); };
  }, [connect]);
  useEffect(() => { const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000); return () => window.clearInterval(timer); }, [startedAt]);

  const sessionTime = useMemo(() => `${String(Math.floor(elapsed / 60000)).padStart(2, "0")}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}`, [elapsed]);
  const [label, sublabel] = stateCopy[state];

  const finishSession = async (useAi: boolean) => {
    const rulesSummary = summarizeWithRules(events, startedAt, Date.now(), targetMinutes, sessionKind);
    if (!useAi) { setSummary(rulesSummary); return; }
    setSummaryLoading(true);
    try {
      const response = await fetch("/api/session-summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dogName: "Your puppy", sessionKind, targetMinutes, startedAt, events }) });
      if (!response.ok) throw new Error("AI summary unavailable");
      setSummary(await response.json());
    } catch { setSummary(rulesSummary); } finally { setSummaryLoading(false); }
  };

  const requestNotifications = async () => { if ("Notification" in window) await Notification.requestPermission(); };

  const wakeIpadDisplay = async () => {
    const room = roomRef.current;
    if (!room || !connected) return;
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: "wake_display" })),
      { reliable: true, topic: "pawly-command" },
    );
    setWakeSent(true);
    window.setTimeout(() => setWakeSent(false), 2500);
  };

  return <main className="dashboard-page">
    <nav className="dashboard-nav"><Brand /><div className="dashboard-nav-actions"><button className="icon-button" onClick={requestNotifications} title="Enable notifications">♢</button><Link className="button button-small button-ghost" href="/setup">Room settings</Link></div></nav>
    <div className="dashboard-grid">
      <section className="live-panel">
        <div className="panel-title"><div><span className={`status-dot ${connected ? "live" : "connecting"}`} /><span>{connected ? "Camera online" : "Waiting for camera"}</span></div><code>{roomCode}</code></div>
        <div className="owner-video"><video ref={videoRef} autoPlay playsInline />{!connected && <div className="video-placeholder"><div className="camera-lens">◉</div><h2>The room is quiet for now</h2><p>Start camera mode on the other device using this room key.</p><button className="button button-light" onClick={connect}>Try again</button></div>}<div className={`current-state ${state}`}><span /><div><small>Current observation</small><strong>{label}</strong><em>{sublabel}</em></div></div></div>
        {error && <p className="error-banner">{error}</p>}
        <div className="session-bar">
          <div><small>Observed</small><strong>{sessionTime}</strong></div>
          <div className="session-kind-control" aria-label="Observation type">
            <button className={sessionKind === "quick_check" ? "selected" : ""} onClick={() => { setSessionKind("quick_check"); setTargetMinutes(10); }}>Quick check</button>
            <button className={sessionKind === "away_monitoring" ? "selected" : ""} onClick={() => { setSessionKind("away_monitoring"); setTargetMinutes(180); }}>Going out</button>
          </div>
          <label className="target-control"><small>Planned window</small><select value={targetMinutes} onChange={(event) => setTargetMinutes(Number(event.target.value))}>{durationOptions[sessionKind].map((minutes) => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}</select></label>
          <button className="button button-ghost wake-ipad-button" onClick={() => void wakeIpadDisplay()} disabled={!connected}>{wakeSent ? "Display awake for 60s" : "Wake camera display"}</button><button className="button button-dark" onClick={() => void finishSession(false)}>Finish & review</button>
        </div>
      </section>

      <aside className="timeline-panel">
        <div className="timeline-heading"><div><span className="eyebrow">Live timeline</span><h2>What matters</h2></div><span className="event-count">{events.length}</span></div>
        <div className="timeline-list">{events.length === 0 ? <div className="empty-timeline"><span>◌</span><p>Meaningful changes will appear here. Pawly intentionally ignores ordinary frame-to-frame movement.</p></div> : events.map((event) => <article className="timeline-event" key={event.id}><div className={`event-symbol ${event.type}`}>{event.type === "motion_active" ? "↗" : event.type.includes("camera") ? "!" : "✓"}</div><div><strong>{event.message}</strong><span>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · {Math.round(event.confidence * 100)}% confidence</span>{event.motionScore != null && <small>Local motion score {Math.round(event.motionScore * 100)}%</small>}</div></article>)}</div>
        <div className="ai-card"><div><span className="ai-spark">✦</span><div><strong>Optional AI reflection</strong><p>Summarizes event text only. The live video is never sent.</p></div></div><button className="button button-ghost full" onClick={() => void finishSession(true)} disabled={summaryLoading}>{summaryLoading ? "Reflecting…" : "Generate once"}</button></div>
      </aside>
    </div>
    {summary && <div className="modal-backdrop" onClick={() => setSummary(null)}><section className="summary-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSummary(null)}>×</button><span className="eyebrow">Observation review · {summary.source === "openai" ? "AI assisted" : "on-device rules"}</span><h2>{summary.headline}</h2><div className="summary-stats"><div><strong>{summary.observedMinutes}</strong><span>minutes observed</span></div><div><strong>{summary.firstActivityMinute ?? "—"}</strong><span>first activity minute</span></div><div><strong>{summary.activeEvents}</strong><span>active changes</span></div><div><strong>{summary.longestCalmMinutes}</strong><span>longest calm</span></div></div><div className="next-step"><small>What to do with this result</small><p>{summary.nextStep}</p></div>{summary.estimatedAiCostUsd != null && <p className="cost-note">Estimated model cost for this summary: ${summary.estimatedAiCostUsd.toFixed(5)}</p>}<button className="button button-primary full" onClick={() => { setEvents([]); setStartedAt(Date.now()); setSummary(null); }}>Start a fresh observation</button></section></div>}
  </main>;
}

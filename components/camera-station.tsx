"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { eventMessage, type EventType, type PawlyEvent } from "@/lib/domain";
import { startMotionAnalyzer } from "@/lib/motion-analyzer";

interface Props { roomCode: string; }

export function CameraStation({ roomCode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const standbyTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [standby, setStandby] = useState(false);
  const [error, setError] = useState("");
  const [motionScore, setMotionScore] = useState(0);
  const lastStateRef = useRef<"active" | "settled">("settled");
  const sustainedRef = useRef({ active: 0, settled: 0 });

  const publishEvent = useCallback(async (type: EventType, score?: number) => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    const event: PawlyEvent = { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), confidence: type === "motion_active" ? 0.72 : 0.95, motionScore: score, message: eventMessage(type) };
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(event)), { reliable: true, topic: "pawly-event" });
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
      wakeLockRef.current = nav.wakeLock ? await nav.wakeLock.request("screen") : null;
    } catch { /* iPad can deny wake lock; UI already explains the fallback. */ }
  }, []);

  const clearStandbyTimer = useCallback(() => {
    if (standbyTimerRef.current != null) window.clearTimeout(standbyTimerRef.current);
    standbyTimerRef.current = null;
  }, []);

  const enterStandby = useCallback(() => {
    clearStandbyTimer();
    setStandby(true);
  }, [clearStandbyTimer]);

  const wakeDisplay = useCallback((returnToStandbyAfterMs = 60_000) => {
    clearStandbyTimer();
    setStandby(false);
    standbyTimerRef.current = window.setTimeout(() => setStandby(true), returnToStandbyAfterMs);
  }, [clearStandbyTimer]);

  const stop = useCallback(async () => {
    clearStandbyTimer();
    setStandby(false);
    await publishEvent("camera_stopped");
    roomRef.current?.disconnect();
    roomRef.current = null;
    await wakeLockRef.current?.release().catch(() => undefined);
    setStatus("idle");
  }, [clearStandbyTimer, publishEvent]);

  const start = useCallback(async () => {
    setStatus("connecting"); setError("");
    try {
      const tokenResponse = await fetch("/api/livekit-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomCode, role: "camera" }) });
      if (!tokenResponse.ok) throw new Error((await tokenResponse.json()).error ?? "Could not open the private room");
      const { token, serverUrl } = await tokenResponse.json();
      const room = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
      roomRef.current = room;
      room.on(RoomEvent.Disconnected, () => setStatus("idle"));
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== "pawly-command") return;
        try {
          const command = JSON.parse(new TextDecoder().decode(payload)) as { type?: string };
          if (command.type === "wake_display") wakeDisplay();
        } catch { /* Ignore malformed remote commands. */ }
      });
      await room.connect(serverUrl, token);
      await room.localParticipant.setCameraEnabled(true, { facingMode: "environment", resolution: { width: 1280, height: 720, frameRate: 20 } });
      await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true });
      const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (videoRef.current && publication?.track) publication.track.attach(videoRef.current);
      await requestWakeLock();
      setStatus("live");
      wakeDisplay(30_000);
      await publishEvent("monitoring_started");
    } catch (cause) {
      roomRef.current?.disconnect(); roomRef.current = null;
      setError(cause instanceof Error ? cause.message : "Camera could not start"); setStatus("error");
    }
  }, [publishEvent, requestWakeLock, roomCode, wakeDisplay]);

  useEffect(() => {
    if (status !== "live" || !videoRef.current) return;
    return startMotionAnalyzer(videoRef.current, ({ score, active }) => {
      setMotionScore(score);
      if (active) { sustainedRef.current.active += 1; sustainedRef.current.settled = 0; }
      else { sustainedRef.current.settled += 1; sustainedRef.current.active = 0; }
      if (sustainedRef.current.active >= 3 && lastStateRef.current !== "active") { lastStateRef.current = "active"; void publishEvent("motion_active", score); }
      if (sustainedRef.current.settled >= 8 && lastStateRef.current !== "settled") { lastStateRef.current = "settled"; void publishEvent("settled", score); }
    });
  }, [publishEvent, status]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void publishEvent("camera_paused");
      else if (status === "live") { void requestWakeLock(); void publishEvent("camera_resumed"); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [publishEvent, requestWakeLock, status]);

  useEffect(() => () => {
    clearStandbyTimer();
    roomRef.current?.disconnect();
  }, [clearStandbyTimer]);

  return <div className="camera-station">
    <div className="camera-header"><div><span className={`status-dot ${status}`} /><strong>{status === "live" ? "Monitoring live" : status === "connecting" ? "Opening room…" : "Camera ready"}</strong></div><code>{roomCode}</code></div>
    <div className="camera-frame"><video ref={videoRef} autoPlay muted playsInline /><div className="camera-overlay"><span>Motion gate</span><strong>{Math.round(motionScore * 100)}%</strong></div>{status !== "live" && <div className="camera-empty"><div className="camera-lens">◉</div><h1>Let the room stay still.</h1><p>Place the iPad where the floor, bed, or crate is visible. Keep it plugged in and this page open.</p>{status === "error" && <p className="error-text">{error}</p>}<button className="button button-light" onClick={start} disabled={status === "connecting"}>{status === "connecting" ? "Connecting…" : "Allow camera & start"}</button></div>}</div>
    {status === "live" && <div className="camera-controls"><div><strong>Dark standby keeps monitoring active</strong><span>Do not lock the iPad—Pawly blacks out this page instead.</span></div><div className="camera-control-actions"><button className="button button-ghost camera-standby-button" onClick={enterStandby}>Dark standby now</button><button className="button button-danger" onClick={stop}>Stop monitoring</button></div></div>}
    <p className="camera-privacy">Live stream only · no continuous recording · local motion gate</p>
    {status === "live" && standby && <button className="standby-screen" onClick={() => wakeDisplay()} aria-label="Wake the iPad monitoring display"><span className="standby-dot" /><strong>Pawly is monitoring</strong><small>Tap anywhere to show the camera for 60 seconds</small></button>}
  </div>;
}

"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { startAudioEnergyAnalyzer } from "@/lib/audio-energy-analyzer";
import { BehaviorTracker } from "@/lib/behavior-tracker";
import { clipFileName, listSavedClips, saveClip, type ClipTrigger, type SavedClip } from "@/lib/clip-store";
import { startDogDetector, type DogDetectorController, type DogDetectorStatus, type DogReading } from "@/lib/dog-detector";
import { eventMessage, type EventType, type PawlyEvent } from "@/lib/domain";
import { recordEventClip } from "@/lib/event-clip-recorder";
import { startMotionAnalyzer } from "@/lib/motion-analyzer";

interface Props { roomCode: string; }

function cameraErrorMessage(cause: unknown) {
  if (!(cause instanceof Error)) return "The camera could not start. Reload this page and try again.";
  if (cause.name === "NotAllowedError") return "Camera access is blocked for this site. Open the browser's site settings, allow Camera, then try again.";
  if (cause.name === "NotFoundError") return "No usable camera was found on this device.";
  if (cause.name === "NotReadableError") return "The camera is busy in another app. Close FaceTime or other camera apps, then try again.";
  return cause.message || "The camera could not start. Reload this page and try again.";
}

export function CameraStation({ roomCode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const standbyTimerRef = useRef<number | null>(null);
  const dogDetectorRef = useRef<DogDetectorController | null>(null);
  const behaviorTrackerRef = useRef(new BehaviorTracker());
  const dogVisibilityRef = useRef<{ candidate: boolean | null; count: number; published: boolean | null }>({ candidate: null, count: 0, published: null });
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [standby, setStandby] = useState(false);
  const [error, setError] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioStatus, setAudioStatus] = useState<"off" | "requesting" | "on" | "blocked">("off");
  const [audioLevel, setAudioLevel] = useState(0);
  const [dogStatus, setDogStatus] = useState<DogDetectorStatus>("loading");
  const [dogReading, setDogReading] = useState<DogReading | null>(null);
  const [motionScore, setMotionScore] = useState(0);
  const lastStateRef = useRef<"active" | "settled">("settled");
  const sustainedRef = useRef({ activeMs: 0, settledMs: 0 });
  const lastAudioStateRef = useRef<"active" | "settled">("settled");
  const sustainedAudioRef = useRef({ activeMs: 0, settledMs: 0 });
  const clipRecordingRef = useRef(false);
  const lastClipAtRef = useRef(0);
  const [clipStatus, setClipStatus] = useState<"ready" | "recording" | "saved" | "unsupported">("ready");

  const publishEvent = useCallback(async (type: EventType, score?: number, confidenceOverride?: number) => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    const event: PawlyEvent = { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), confidence: confidenceOverride ?? (type === "motion_active" ? 0.72 : 0.95), motionScore: score, message: eventMessage(type) };
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(event)), { reliable: true, topic: "pawly-event" });
  }, []);

  const sendClip = useCallback(async (clip: SavedClip, destinationIdentities?: string[]) => {
    const room = roomRef.current;
    if (!room || room.remoteParticipants.size === 0) return;
    const file = new File([clip.blob], clipFileName(clip), { type: clip.mimeType });
    await room.localParticipant.sendFile(file, {
      topic: "pawly-clip",
      mimeType: clip.mimeType,
      destinationIdentities,
    });
  }, []);

  const sendSavedClips = useCallback(async (destinationIdentity?: string) => {
    const recentClips = (await listSavedClips(roomCode)).slice(0, 6);
    for (const clip of recentClips) {
      await sendClip(clip, destinationIdentity ? [destinationIdentity] : undefined).catch(() => undefined);
    }
  }, [roomCode, sendClip]);

  const captureEventClip = useCallback(async (trigger: ClipTrigger) => {
    const now = Date.now();
    if (clipRecordingRef.current || now - lastClipAtRef.current < 20_000) return;
    const room = roomRef.current;
    const videoTrack = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack;
    const audioTrack = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (!videoTrack) return;

    clipRecordingRef.current = true;
    lastClipAtRef.current = now;
    setClipStatus("recording");
    try {
      const clip = await recordEventClip(new MediaStream([videoTrack, ...(audioTrack ? [audioTrack] : [])]), roomCode, trigger);
      await saveClip(clip);
      setClipStatus("saved");
      await sendClip(clip).catch(() => undefined);
      window.setTimeout(() => setClipStatus("ready"), 4_000);
    } catch {
      setClipStatus("unsupported");
    } finally {
      clipRecordingRef.current = false;
    }
  }, [roomCode, sendClip]);

  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
      wakeLockRef.current = nav.wakeLock ? await nav.wakeLock.request("screen") : null;
    } catch { /* Some browsers deny wake lock; the UI already explains the fallback. */ }
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
    setAudioEnabled(false);
    setAudioStatus("off");
    await publishEvent("camera_stopped");
    roomRef.current?.disconnect();
    roomRef.current = null;
    await wakeLockRef.current?.release().catch(() => undefined);
    setStatus("idle");
  }, [clearStandbyTimer, publishEvent]);

  const enableAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    setAudioStatus("requesting");
    try {
      await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true });
      setAudioEnabled(true);
      setAudioStatus("on");
    } catch {
      setAudioEnabled(false);
      setAudioStatus("blocked");
    }
  }, []);

  const disableAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
    setAudioEnabled(false);
    setAudioStatus("off");
    setAudioLevel(0);
  }, []);

  const start = useCallback(async () => {
    setStatus("connecting"); setError("");
    try {
      const tokenResponse = await fetch("/api/livekit-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomCode, role: "camera" }) });
      if (!tokenResponse.ok) throw new Error((await tokenResponse.json()).error ?? "Could not open the private room");
      const { token, serverUrl } = await tokenResponse.json();
      const room = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
      roomRef.current = room;
      room.on(RoomEvent.Disconnected, () => setStatus("idle"));
      room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== "pawly-command") return;
        try {
          const command = JSON.parse(new TextDecoder().decode(payload)) as { type?: string };
          if (command.type === "wake_display") wakeDisplay();
          if (command.type === "request_saved_clips") void sendSavedClips(participant?.identity);
        } catch { /* Ignore malformed remote commands. */ }
      });
      await room.connect(serverUrl, token);
      try {
        await room.localParticipant.setCameraEnabled(true, { facingMode: "environment" });
      } catch {
        // Desktop cameras and some iOS browsers reject a rear-camera preference.
        // Retry with the device default instead of failing the whole session.
        await room.localParticipant.setCameraEnabled(true);
      }
      const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (videoRef.current && publication?.track) publication.track.attach(videoRef.current);
      await requestWakeLock();
      setStatus("live");
      wakeDisplay(30_000);
      await publishEvent("monitoring_started");
      void enableAudio();
    } catch (cause) {
      roomRef.current?.disconnect(); roomRef.current = null;
      setError(cameraErrorMessage(cause)); setStatus("error");
    }
  }, [enableAudio, publishEvent, requestWakeLock, roomCode, sendSavedClips, wakeDisplay]);

  useEffect(() => {
    if (status !== "live" || !videoRef.current) return;
    return startMotionAnalyzer(videoRef.current, ({ score, active, intervalMs }) => {
      setMotionScore(score);
      dogDetectorRef.current?.setMotionActive(active);
      if (active) { sustainedRef.current.activeMs += intervalMs; sustainedRef.current.settledMs = 0; }
      else { sustainedRef.current.settledMs += intervalMs; sustainedRef.current.activeMs = 0; }
      if (sustainedRef.current.activeMs >= 2_250 && lastStateRef.current !== "active") { lastStateRef.current = "active"; void publishEvent("motion_active", score); void captureEventClip("movement"); }
      if (sustainedRef.current.settledMs >= 12_000 && lastStateRef.current !== "settled") { lastStateRef.current = "settled"; void publishEvent("settled", score); }
    });
  }, [captureEventClip, publishEvent, status]);

  useEffect(() => {
    if (status !== "live" || !videoRef.current) return;
    behaviorTrackerRef.current.reset();
    dogVisibilityRef.current = { candidate: null, count: 0, published: null };
    const controller = startDogDetector(
      videoRef.current,
      (reading) => {
        setDogReading(reading);
        const visibility = dogVisibilityRef.current;
        if (visibility.candidate === reading.visible) visibility.count += 1;
        else { visibility.candidate = reading.visible; visibility.count = 1; }
        const requiredReadings = reading.visible ? 1 : 3;
        if (visibility.count >= requiredReadings && visibility.published !== reading.visible) {
          visibility.published = reading.visible;
          void publishEvent(reading.visible ? "dog_visible" : "dog_not_visible", undefined, Math.max(0.5, reading.confidence));
        }
        if (behaviorTrackerRef.current.addDogReading(reading)) { void publishEvent("repeated_movement", undefined, 0.68); void captureEventClip("repeated_movement"); }
      },
      setDogStatus,
    );
    dogDetectorRef.current = controller;
    return () => {
      controller.stop();
      dogDetectorRef.current = null;
    };
  }, [captureEventClip, publishEvent, status]);

  useEffect(() => {
    if (status !== "live" || !audioEnabled) return;
    const publication = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    const mediaTrack = publication?.track?.mediaStreamTrack;
    if (!mediaTrack) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void startAudioEnergyAnalyzer(mediaTrack, ({ level, active, intervalMs }) => {
      if (cancelled) return;
      setAudioLevel(level);
      if (active) { sustainedAudioRef.current.activeMs += intervalMs; sustainedAudioRef.current.settledMs = 0; }
      else { sustainedAudioRef.current.settledMs += intervalMs; sustainedAudioRef.current.activeMs = 0; }
      if (sustainedAudioRef.current.activeMs >= 2_000 && lastAudioStateRef.current !== "active") { lastAudioStateRef.current = "active"; void publishEvent("sound_active", undefined, 0.66); void captureEventClip("sound"); }
      if (sustainedAudioRef.current.settledMs >= 8_000 && lastAudioStateRef.current !== "settled") { lastAudioStateRef.current = "settled"; void publishEvent("sound_settled", undefined, 0.82); }
    }).then((stopAnalyzer) => {
      if (cancelled) stopAnalyzer();
      else cleanup = stopAnalyzer;
    }).catch(() => setAudioStatus("blocked"));
    return () => { cancelled = true; cleanup?.(); };
  }, [audioEnabled, captureEventClip, publishEvent, status]);

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
    <div className="camera-header"><div><span className={`status-dot ${status}`} /><strong>{status === "live" ? "Monitoring live" : status === "connecting" ? "Opening room…" : status === "error" ? "Camera needs attention" : "Camera ready"}</strong></div><code>{roomCode}</code></div>
    <div className="camera-frame"><video ref={videoRef} autoPlay muted playsInline />{dogReading?.visible && dogReading.box && <div className="dog-detection-box" style={{ left: `${dogReading.box.x * 100}%`, top: `${dogReading.box.y * 100}%`, width: `${dogReading.box.width * 100}%`, height: `${dogReading.box.height * 100}%` }}><span>Dog · {Math.round(dogReading.confidence * 100)}%</span></div>}<div className="camera-analysis-stack"><div className="camera-overlay"><span>Eco motion</span><strong>{Math.round(motionScore * 100)}%</strong></div><div className={`camera-overlay dog-analysis ${dogReading?.visible ? "detected" : ""}`}><span>Dog AI</span><strong>{dogStatus === "loading" ? "Loading" : dogStatus === "unavailable" ? "Motion only" : dogReading?.visible ? `${Math.round(dogReading.confidence * 100)}% visible` : "Scanning"}</strong></div><div className={`camera-overlay sound-analysis ${audioEnabled ? "detected" : ""}`}><span>Sound</span><strong>{audioStatus === "requesting" ? "Requesting" : audioEnabled ? `${Math.round(audioLevel * 100)}%` : audioStatus === "blocked" ? "Blocked" : "Off"}</strong></div><div className={`camera-overlay clip-analysis ${clipStatus === "recording" ? "recording" : ""}`}><span>Event clip</span><strong>{clipStatus === "recording" ? "Saving 12s" : clipStatus === "saved" ? "Saved" : clipStatus === "unsupported" ? "Unavailable" : "Ready"}</strong></div></div>{status !== "live" && <div className="camera-empty"><div className="camera-lens">◉</div><h1>Let the room stay still.</h1><p>Place this device where the floor, bed, or crate is visible. Pawly will request camera and microphone access; video still works if sound is declined.</p>{status === "error" && <p className="error-text" role="alert">{error}</p>}<button className="button button-light" onClick={start} disabled={status === "connecting"}>{status === "connecting" ? "Connecting…" : status === "error" ? "Try camera again" : "Allow camera, sound & start"}</button></div>}</div>
    {status === "live" && <div className="camera-controls"><div><strong>Dark standby keeps monitoring active</strong><span>Do not lock this device—Pawly blacks out the page instead.</span></div><div className="camera-control-actions">{audioEnabled ? <button className="button button-ghost camera-standby-button" onClick={() => void disableAudio()}>Sound on · turn off</button> : <button className="button button-ghost camera-standby-button" onClick={() => void enableAudio()} disabled={audioStatus === "requesting"}>{audioStatus === "requesting" ? "Opening sound…" : audioStatus === "blocked" ? "Retry sound permission" : "Enable sound"}</button>}<button className="button button-ghost camera-standby-button" onClick={enterStandby}>Dark standby now</button><button className="button button-danger" onClick={stop}>Stop monitoring</button></div></div>}
    <p className="camera-privacy">Live video · {audioEnabled ? "sound analysis on" : "sound off"} · 12-second event clips only · saved locally · local adaptive AI</p>
    {status === "live" && standby && <button className="standby-screen" onClick={() => wakeDisplay()} aria-label="Wake the camera monitoring display"><span className="standby-dot" /><strong>Pawly is monitoring</strong><small>Tap anywhere to show the camera for 60 seconds</small></button>}
  </div>;
}

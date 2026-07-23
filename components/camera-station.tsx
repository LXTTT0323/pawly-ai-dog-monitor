"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { startAudioEnergyAnalyzer } from "@/lib/audio-energy-analyzer";
import { BehaviorTracker } from "@/lib/behavior-tracker";
import { clipFileName, listSavedClips, saveClip, type ClipTrigger, type SavedClip } from "@/lib/clip-store";
import { startDogDetector, type DogBox, type DogDetectorController, type DogDetectorStatus, type DogReading } from "@/lib/dog-detector";
import { eventMessage, type EventType, type PawlyEvent } from "@/lib/domain";
import { recordEventClip } from "@/lib/event-clip-recorder";
import { startMotionAnalyzer } from "@/lib/motion-analyzer";

interface Props { roomCode: string; }

interface ZoomRange { min: number; max: number; step?: number; }
interface ZoomCapabilities extends MediaTrackCapabilities { zoom?: ZoomRange; }
interface ZoomSettings extends MediaTrackSettings { zoom?: number; }

function cameraErrorMessage(cause: unknown) {
  if (!(cause instanceof Error)) return "The camera could not start. Reload this page and try again.";
  if (cause.name === "NotAllowedError") return "Camera access is blocked for this site. Open the browser's site settings, allow Camera, then try again.";
  if (cause.name === "NotFoundError") return "No usable camera was found on this device.";
  if (cause.name === "NotReadableError") return "The camera is busy in another app. Close FaceTime or other camera apps, then try again.";
  return cause.message || "The camera could not start. Reload this page and try again.";
}

function coverBoxStyle(box: DogBox, video: HTMLVideoElement | null): CSSProperties {
  if (!video?.videoWidth || !video.videoHeight || !video.clientWidth || !video.clientHeight) {
    return {
      left: `${box.x * 100}%`,
      top: `${box.y * 100}%`,
      width: `${box.width * 100}%`,
      height: `${box.height * 100}%`,
    };
  }
  const scale = Math.max(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const offsetX = (video.clientWidth - renderedWidth) / 2;
  const offsetY = (video.clientHeight - renderedHeight) / 2;
  return {
    left: offsetX + box.x * renderedWidth,
    top: offsetY + box.y * renderedHeight,
    width: box.width * renderedWidth,
    height: box.height * renderedHeight,
  };
}

export function CameraStation({ roomCode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVoiceRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const standbyTimerRef = useRef<number | null>(null);
  const dogDetectorRef = useRef<DogDetectorController | null>(null);
  const eventHistoryRef = useRef<PawlyEvent[]>([]);
  const behaviorTrackerRef = useRef(new BehaviorTracker());
  const dogVisibilityRef = useRef<{ candidate: boolean | null; count: number; published: boolean | null }>({ candidate: null, count: 0, published: null });
  const sceneMotionScoreRef = useRef(0);
  const cameraShiftUntilRef = useRef(0);
  const cameraRecoveryRef = useRef({ pending: false, stableDogReadings: 0 });
  const lastCameraRepositionEventRef = useRef(0);
  const audioEnabledRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [standby, setStandby] = useState(false);
  const [error, setError] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioStatus, setAudioStatus] = useState<"off" | "requesting" | "on" | "blocked">("off");
  const [showMicrophoneHelp, setShowMicrophoneHelp] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [dogStatus, setDogStatus] = useState<DogDetectorStatus>("loading");
  const [dogReading, setDogReading] = useState<DogReading | null>(null);
  const [motionScore, setMotionScore] = useState(0);
  const lastAudioStateRef = useRef<"active" | "settled">("settled");
  const sustainedAudioRef = useRef({ activeMs: 0, settledMs: 0 });
  const clipRecordingRef = useRef(false);
  const lastClipAtRef = useRef(0);
  const [clipStatus, setClipStatus] = useState<"ready" | "recording" | "saved" | "unsupported">("ready");
  const [ownerVoiceActive, setOwnerVoiceActive] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`pawly-camera-events-${roomCode}`) ?? "[]");
      eventHistoryRef.current = Array.isArray(saved) ? saved.slice(0, 100) : [];
    } catch {
      eventHistoryRef.current = [];
    }
  }, [roomCode]);

  const publishEvent = useCallback(async (type: EventType, score?: number, confidenceOverride?: number) => {
    const event: PawlyEvent = { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), confidence: confidenceOverride ?? (type === "motion_active" ? 0.72 : 0.95), motionScore: score, message: eventMessage(type) };
    eventHistoryRef.current = [event, ...eventHistoryRef.current].slice(0, 100);
    try {
      localStorage.setItem(`pawly-camera-events-${roomCode}`, JSON.stringify(eventHistoryRef.current));
    } catch { /* The live event still works if local history storage is unavailable. */ }
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(event)), { reliable: true, topic: "pawly-event" });
  }, [roomCode]);

  const publishZoomStatus = useCallback(async (supported: boolean, zoom = 1, range?: ZoomRange) => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: "zoom_status", supported, zoom, min: range?.min ?? 1, max: range?.max ?? 3 })),
      { reliable: true, topic: "pawly-camera-status" },
    );
  }, []);

  const publishAudioStatus = useCallback(async (enabled: boolean) => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: "audio_status", enabled })),
      { reliable: true, topic: "pawly-camera-status" },
    );
  }, []);

  const publishDogTrack = useCallback(async (reading: DogReading) => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({
        visible: reading.visible,
        confidence: reading.confidence,
        box: reading.box,
        observedAt: reading.observedAt,
      })),
      { reliable: false, topic: "pawly-dog-track" },
    );
  }, []);

  const applyCameraZoom = useCallback(async (requestedZoom: number) => {
    const mediaTrack = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack;
    if (!mediaTrack) return;
    const range = (mediaTrack.getCapabilities() as ZoomCapabilities).zoom;
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      await publishZoomStatus(false);
      return;
    }
    const clamped = Math.min(range.max, Math.max(range.min, requestedZoom));
    const stepped = range.step ? range.min + Math.round((clamped - range.min) / range.step) * range.step : clamped;
    try {
      await mediaTrack.applyConstraints({ advanced: [{ zoom: stepped } as MediaTrackConstraintSet] });
      const applied = (mediaTrack.getSettings() as ZoomSettings).zoom ?? stepped;
      await publishZoomStatus(true, applied, range);
    } catch {
      await publishZoomStatus(false);
    }
  }, [publishZoomStatus]);

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

  const sendEventHistory = useCallback(async (destinationIdentity?: string) => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(eventHistoryRef.current.slice(0, 50))),
      {
        reliable: true,
        topic: "pawly-event-history",
        destinationIdentities: destinationIdentity ? [destinationIdentity] : undefined,
      },
    );
  }, []);

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
    audioEnabledRef.current = false;
    setAudioStatus("off");
    await publishAudioStatus(false).catch(() => undefined);
    await publishEvent("camera_stopped");
    roomRef.current?.disconnect();
    roomRef.current = null;
    await wakeLockRef.current?.release().catch(() => undefined);
    setStatus("idle");
  }, [clearStandbyTimer, publishAudioStatus, publishEvent]);

  const enableAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    setAudioStatus("requesting");
    try {
      await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true });
      setAudioEnabled(true);
      audioEnabledRef.current = true;
      setAudioStatus("on");
      setShowMicrophoneHelp(false);
      await publishAudioStatus(true);
    } catch {
      setAudioEnabled(false);
      audioEnabledRef.current = false;
      setAudioStatus("blocked");
      setShowMicrophoneHelp(true);
      await publishAudioStatus(false).catch(() => undefined);
    }
  }, [publishAudioStatus]);

  const disableAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
    setAudioEnabled(false);
    audioEnabledRef.current = false;
    setAudioStatus("off");
    setAudioLevel(0);
    await publishAudioStatus(false).catch(() => undefined);
  }, [publishAudioStatus]);

  const start = useCallback(async () => {
    setStatus("connecting"); setError("");
    setAudioStatus("requesting");
    let preparedStream: MediaStream | null = null;
    try {
      // Ask for camera and microphone together while the user's tap is still
      // active. This is substantially more reliable on iPadOS than requesting
      // the microphone after the network connection has completed.
      try {
        preparedStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        preparedStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      }
      const tokenResponse = await fetch("/api/livekit-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomCode, role: "camera" }) });
      if (!tokenResponse.ok) throw new Error((await tokenResponse.json()).error ?? "Could not open the private room");
      const { token, serverUrl } = await tokenResponse.json();
      const room = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
      roomRef.current = room;
      room.on(RoomEvent.Disconnected, () => setStatus("idle"));
      room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== "pawly-command") return;
        try {
          const command = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; zoom?: number };
          if (command.type === "wake_display") wakeDisplay();
          if (command.type === "enable_audio") {
            wakeDisplay(60_000);
            void enableAudio();
          }
          if (command.type === "request_saved_clips") void sendSavedClips(participant?.identity);
          if (command.type === "request_event_history") void sendEventHistory(participant?.identity);
          if (command.type === "set_zoom" && Number.isFinite(command.zoom)) void applyCameraZoom(command.zoom ?? 1);
        } catch { /* Ignore malformed remote commands. */ }
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio || !remoteVoiceRef.current) return;
        track.attach(remoteVoiceRef.current);
        setOwnerVoiceActive(true);
        void room.startAudio().then(() => remoteVoiceRef.current?.play()).catch(() => undefined);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        track.detach();
        setOwnerVoiceActive(false);
      });
      room.on(RoomEvent.ParticipantConnected, () => {
        void publishAudioStatus(audioEnabledRef.current);
      });
      await room.connect(serverUrl, token);
      await room.startAudio().catch(() => undefined);
      const videoTrack = preparedStream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("No usable camera was found on this device.");
      await room.localParticipant.publishTrack(videoTrack, { source: Track.Source.Camera });
      const microphoneTrack = preparedStream.getAudioTracks()[0];
      if (microphoneTrack) {
        await room.localParticipant.publishTrack(microphoneTrack, { source: Track.Source.Microphone });
        setAudioEnabled(true);
        audioEnabledRef.current = true;
        setAudioStatus("on");
        setShowMicrophoneHelp(false);
      } else {
        setAudioEnabled(false);
        audioEnabledRef.current = false;
        setAudioStatus("blocked");
        setShowMicrophoneHelp(true);
      }
      const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (videoRef.current && publication?.track) publication.track.attach(videoRef.current);
      await publishAudioStatus(audioEnabledRef.current).catch(() => undefined);
      void applyCameraZoom(1);
      await requestWakeLock();
      setStatus("live");
      wakeDisplay(30_000);
      await publishEvent("monitoring_started");
    } catch (cause) {
      preparedStream?.getTracks().forEach((track) => track.stop());
      roomRef.current?.disconnect(); roomRef.current = null;
      setAudioEnabled(false);
      audioEnabledRef.current = false;
      setAudioStatus("off");
      setError(cameraErrorMessage(cause)); setStatus("error");
    }
  }, [applyCameraZoom, enableAudio, publishAudioStatus, publishEvent, requestWakeLock, roomCode, sendEventHistory, sendSavedClips, wakeDisplay]);

  useEffect(() => {
    if (status !== "live" || !videoRef.current) return;
    return startMotionAnalyzer(videoRef.current, ({ score, active, cameraShift }) => {
      setMotionScore(score);
      sceneMotionScoreRef.current = score;
      dogDetectorRef.current?.setMotionActive(active);
      if (cameraShift) {
        const now = Date.now();
        cameraShiftUntilRef.current = now + 3_000;
        cameraRecoveryRef.current = { pending: true, stableDogReadings: 0 };
        dogVisibilityRef.current = { candidate: null, count: 0, published: null };
        behaviorTrackerRef.current.reset();
        if (now - lastCameraRepositionEventRef.current >= 5_000) {
          lastCameraRepositionEventRef.current = now;
          void publishEvent("camera_repositioned", score, 0.92);
        }
      }
    });
  }, [publishEvent, status]);

  useEffect(() => {
    if (status !== "live" || !videoRef.current) return;
    behaviorTrackerRef.current.reset();
    dogVisibilityRef.current = { candidate: null, count: 0, published: null };
    const controller = startDogDetector(
      videoRef.current,
      (reading) => {
        setDogReading(reading);
        void publishDogTrack(reading);
        const recovery = cameraRecoveryRef.current;
        if (Date.now() < cameraShiftUntilRef.current) {
          recovery.stableDogReadings = 0;
          return;
        }
        if (recovery.pending) {
          recovery.stableDogReadings = reading.visible && reading.box ? recovery.stableDogReadings + 1 : 0;
          if (recovery.stableDogReadings < 2) return;
          recovery.pending = false;
          behaviorTrackerRef.current.reset();
          dogVisibilityRef.current = { candidate: null, count: 0, published: null };
        }
        const visibility = dogVisibilityRef.current;
        if (reading.visible && visibility.published !== true) dogDetectorRef.current?.setMotionActive(true);
        if (visibility.candidate === reading.visible) visibility.count += 1;
        else { visibility.candidate = reading.visible; visibility.count = 1; }
        const requiredReadings = reading.visible ? 2 : 3;
        if (visibility.count >= requiredReadings && visibility.published !== reading.visible) {
          visibility.published = reading.visible;
          void publishEvent(reading.visible ? "dog_visible" : "dog_not_visible", undefined, Math.max(0.5, reading.confidence));
        }
        const behavior = behaviorTrackerRef.current.addDogReading(reading, sceneMotionScoreRef.current);
        if (visibility.published === true && !behavior.cameraShiftIgnored) {
          if (behavior.movementStarted) {
            void publishEvent("motion_active", behavior.movementScore, Math.max(0.65, reading.confidence));
            void captureEventClip("movement");
          }
          if (behavior.settled) void publishEvent("settled", behavior.movementScore, Math.max(0.7, reading.confidence));
          if (behavior.repeatedMovement) {
            void publishEvent("repeated_movement", behavior.movementScore, Math.max(0.68, reading.confidence));
            void captureEventClip("repeated_movement");
          }
        }
      },
      setDogStatus,
    );
    dogDetectorRef.current = controller;
    return () => {
      controller.stop();
      dogDetectorRef.current = null;
    };
  }, [captureEventClip, publishDogTrack, publishEvent, status]);

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
      if (Date.now() < cameraShiftUntilRef.current || cameraRecoveryRef.current.pending) {
        sustainedAudioRef.current = { activeMs: 0, settledMs: 0 };
        return;
      }
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
    <div className="camera-frame"><video ref={videoRef} autoPlay muted playsInline /><audio ref={remoteVoiceRef} autoPlay />{dogReading?.visible && dogReading.box && <div className="dog-detection-box" style={coverBoxStyle(dogReading.box, videoRef.current)}><span>Dog · {Math.round(dogReading.confidence * 100)}%</span></div>}<div className="camera-analysis-stack"><div className="camera-overlay"><span>Scene wake</span><strong>{Math.round(motionScore * 100)}%</strong></div><div className={`camera-overlay dog-analysis ${dogReading?.visible ? "detected" : ""}`}><span>Dog AI</span><strong>{dogStatus === "loading" ? "Loading model…" : dogStatus === "unavailable" ? "Detector unavailable" : dogReading?.visible ? `${Math.round(dogReading.confidence * 100)}% visible` : dogReading ? "No dog in view" : "Ready · scanning"}</strong>{dogStatus === "unavailable" && <button className="dog-retry-button" onClick={() => dogDetectorRef.current?.retry()}>Retry</button>}</div><div className={`camera-overlay sound-analysis ${audioEnabled ? "detected" : ""}`}><span>Room mic</span><strong>{audioStatus === "requesting" ? "Requesting" : audioEnabled ? `${Math.round(audioLevel * 100)}% · on` : audioStatus === "blocked" ? "Permission needed" : "Off"}</strong></div><div className={`camera-overlay clip-analysis ${clipStatus === "recording" ? "recording" : ""}`}><span>Event clip</span><strong>{clipStatus === "recording" ? "Saving 12s" : clipStatus === "saved" ? "Saved" : clipStatus === "unsupported" ? "Unavailable" : "Ready"}</strong></div><div className={`camera-overlay talkback-analysis ${ownerVoiceActive ? "detected" : ""}`}><span>Talkback</span><strong>{ownerVoiceActive ? "Owner speaking" : "Ready"}</strong></div></div>{status !== "live" && <div className="camera-empty"><div className="camera-lens">◉</div><h1>Let the room stay still.</h1><p>Place this device where the floor, bed, or crate is visible. Pawly will request camera and microphone access; video still works if sound is declined.</p>{status === "error" && <p className="error-text" role="alert">{error}</p>}<button className="button button-light" onClick={start} disabled={status === "connecting"}>{status === "connecting" ? "Connecting…" : status === "error" ? "Try camera again" : "Allow camera, sound & start"}</button></div>}{status === "live" && showMicrophoneHelp && <div className="microphone-permission-help" role="dialog" aria-live="polite"><span className="permission-icon">♪</span><h2>Turn on room sound</h2><p>Tap below to let Pawly use this iPad's microphone.</p><button className="button button-light" onClick={() => void enableAudio()} disabled={audioStatus === "requesting"}>{audioStatus === "requesting" ? "Opening microphone…" : "Allow microphone"}</button><small>If no permission box appears: iPad Settings → Apps → Chrome → Microphone. Turn it on, return here, then tap Allow microphone again.</small><button className="permission-later" onClick={() => setShowMicrophoneHelp(false)}>Not now</button></div>}</div>
    {status === "live" && <div className="camera-controls"><div><strong>Dark standby keeps monitoring active</strong><span>Do not lock this device—Pawly blacks out the page instead.</span>{!audioEnabled && <span className="camera-permission-tip">Need room sound? iPad Settings → Apps → Chrome → Microphone, then tap Enable sound.</span>}</div><div className="camera-control-actions">{audioEnabled ? <button className="button button-ghost camera-standby-button" onClick={() => void disableAudio()}>Sound on · turn off</button> : <button className="button button-ghost camera-standby-button" onClick={() => void enableAudio()} disabled={audioStatus === "requesting"}>{audioStatus === "requesting" ? "Opening sound…" : audioStatus === "blocked" ? "Retry sound permission" : "Enable sound"}</button>}<button className="button button-ghost camera-standby-button" onClick={enterStandby}>Dark standby now</button><button className="button button-danger" onClick={stop}>Stop monitoring</button></div></div>}
    <p className="camera-privacy">Live video · {audioEnabled ? "sound analysis on" : "sound off"} · 12-second event clips only · saved locally · local adaptive AI</p>
    {status === "live" && standby && <button className="standby-screen" onClick={() => wakeDisplay()} aria-label="Wake the camera monitoring display"><span className="standby-dot" /><strong>Pawly is monitoring</strong><small>Tap anywhere to show the camera for 60 seconds</small></button>}
  </div>;
}

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
import { createEncryptedRoom, participantRole } from "@/lib/livekit-security";

interface Props { roomCode: string; }

interface ZoomRange { min: number; max: number; step?: number; }
interface ZoomCapabilities extends MediaTrackCapabilities { zoom?: ZoomRange; torch?: boolean; }
interface ZoomSettings extends MediaTrackSettings { zoom?: number; }
type CameraFacing = "user" | "environment";

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
  const ownerVoiceTrackRef = useRef<Track | null>(null);
  const talkEnabledRef = useRef(false);
  const roomRef = useRef<Room | null>(null);
  const disposeEncryptionRef = useRef<(() => void) | null>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const standbyTimerRef = useRef<number | null>(null);
  const dogDetectorRef = useRef<DogDetectorController | null>(null);
  const ownerDogTargetRef = useRef<DogBox | null>(null);
  const eventHistoryRef = useRef<PawlyEvent[]>([]);
  const behaviorTrackerRef = useRef(new BehaviorTracker());
  const dogVisibilityRef = useRef<{ candidate: boolean | null; count: number; published: boolean | null }>({ candidate: null, count: 0, published: null });
  const sceneMotionScoreRef = useRef(0);
  const cameraShiftUntilRef = useRef(0);
  const cameraRecoveryRef = useRef({ pending: false, stableDogReadings: 0 });
  const lastCameraRepositionEventRef = useRef(0);
  const audioEnabledRef = useRef(false);
  const deviceInfoRef = useRef<{ id: string; name: string } | null>(null);
  const facingModeRef = useRef<CameraFacing>("environment");
  const ambientContextRef = useRef<AudioContext | null>(null);
  const ambientSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [standby, setStandby] = useState(false);
  const [error, setError] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioStatus, setAudioStatus] = useState<"off" | "requesting" | "on" | "blocked">("off");
  const [showMicrophoneHelp, setShowMicrophoneHelp] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [dogStatus, setDogStatus] = useState<DogDetectorStatus>("loading");
  const [dogReading, setDogReading] = useState<DogReading | null>(null);
  const [dogTargetMode, setDogTargetMode] = useState<"auto" | "owner_guided">("auto");
  const [motionScore, setMotionScore] = useState(0);
  const lastAudioStateRef = useRef<"active" | "settled">("settled");
  const sustainedAudioRef = useRef({ activeMs: 0, settledMs: 0 });
  const clipRecordingRef = useRef(false);
  const lastClipAtRef = useRef(0);
  const [clipStatus, setClipStatus] = useState<"ready" | "recording" | "saved" | "unsupported">("ready");
  const [ownerVoiceActive, setOwnerVoiceActive] = useState(false);
  const [facingMode, setFacingMode] = useState<CameraFacing>("environment");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [ambientPlaying, setAmbientPlaying] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`pawly-camera-events-${roomCode}`) ?? "[]");
      eventHistoryRef.current = Array.isArray(saved) ? saved.slice(0, 100) : [];
    } catch {
      eventHistoryRef.current = [];
    }
  }, [roomCode]);

  const publishEvent = useCallback(async (type: EventType, score?: number, confidenceOverride?: number) => {
    const event: PawlyEvent = { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), confidence: confidenceOverride ?? (type === "motion_active" ? 0.72 : 0.95), motionScore: score, message: eventMessage(type), deviceId: deviceInfoRef.current?.id, deviceName: deviceInfoRef.current?.name };
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
        petKind: reading.petKind,
        targetMode: reading.targetMode,
        observedAt: reading.observedAt,
      })),
      { reliable: false, topic: "pawly-dog-track" },
    );
  }, []);

  const publishCameraHealth = useCallback(async () => {
    const room = roomRef.current;
    const mediaTrack = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack;
    if (!room?.localParticipant || !mediaTrack) return;
    const settings = mediaTrack.getSettings();
    const capabilities = mediaTrack.getCapabilities() as ZoomCapabilities;
    setTorchSupported(Boolean(capabilities.torch));
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({
        type: "health_status",
        camera: mediaTrack.readyState === "live" && mediaTrack.enabled,
        microphone: audioEnabledRef.current,
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate,
        facingMode: facingModeRef.current,
        torchSupported: Boolean(capabilities.torch),
        torchOn,
        detector: dogStatus,
        observedAt: Date.now(),
      })),
      { reliable: true, topic: "pawly-camera-status" },
    );
  }, [dogStatus, torchOn]);

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

  const applyTorch = useCallback(async (enabled: boolean) => {
    const mediaTrack = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack;
    if (!mediaTrack) return;
    const supported = Boolean((mediaTrack.getCapabilities() as ZoomCapabilities).torch);
    setTorchSupported(supported);
    if (!supported) {
      setTorchOn(false);
      await publishCameraHealth();
      return;
    }
    try {
      await mediaTrack.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
      setTorchOn(enabled);
    } catch {
      setTorchOn(false);
    }
    window.setTimeout(() => void publishCameraHealth(), 50);
  }, [publishCameraHealth]);

  const replaceCamera = useCallback(async (nextFacing: CameraFacing) => {
    const room = roomRef.current;
    if (!room) return;
    const previousPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const previousTrack = previousPublication?.track?.mediaStreamTrack;
    const nextStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const nextTrack = nextStream.getVideoTracks()[0];
    if (!nextTrack) throw new Error("No usable camera was found on this device.");
    if (previousTrack) {
      await room.localParticipant.unpublishTrack(previousTrack);
      previousTrack.stop();
    }
    await room.localParticipant.publishTrack(nextTrack, { source: Track.Source.Camera });
    const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (videoRef.current && publication?.track) publication.track.attach(videoRef.current);
    facingModeRef.current = nextFacing;
    setFacingMode(nextFacing);
    setTorchOn(false);
    ownerDogTargetRef.current = null;
    setDogTargetMode("auto");
    dogDetectorRef.current?.setTargetBox(null);
    cameraRecoveryRef.current = { pending: true, stableDogReadings: 0 };
    await applyCameraZoom(1);
    await publishCameraHealth();
  }, [applyCameraZoom, publishCameraHealth]);

  const stopAmbient = useCallback(() => {
    ambientSourceRef.current?.stop();
    ambientSourceRef.current = null;
    setAmbientPlaying(false);
  }, []);

  const startAmbient = useCallback(async () => {
    stopAmbient();
    const context = ambientContextRef.current ?? new AudioContext();
    ambientContextRef.current = context;
    await context.resume();
    const seconds = 8;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.018 * white) / 1.018;
      channel[index] = last * 0.7;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 650;
    gain.gain.value = 0.12;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    ambientSourceRef.current = source;
    setAmbientPlaying(true);
  }, [stopAmbient]);

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
    stopAmbient();
    setTorchOn(false);
    await publishAudioStatus(false).catch(() => undefined);
    await publishEvent("camera_stopped");
    roomRef.current?.disconnect();
    roomRef.current = null;
    await wakeLockRef.current?.release().catch(() => undefined);
    setStatus("idle");
  }, [clearStandbyTimer, publishAudioStatus, publishEvent, stopAmbient]);

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
      if (!ambientContextRef.current) ambientContextRef.current = new AudioContext();
      await ambientContextRef.current.resume().catch(() => undefined);
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
      const tokenResponse = await fetch("/api/livekit-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomCode, mode: "camera" }) });
      if (!tokenResponse.ok) throw new Error((await tokenResponse.json()).error ?? "Could not open the private room");
      const { token, serverUrl, e2eeKey, device } = await tokenResponse.json();
      deviceInfoRef.current = device ?? null;
      const encrypted = await createEncryptedRoom(e2eeKey, { adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
      const room = encrypted.room;
      disposeEncryptionRef.current = encrypted.disposeEncryption;
      roomRef.current = room;
      room.registerByteStreamHandler("pawly-sound", (reader) => {
        void reader.readAll().then(async (chunks) => {
          const blob = new Blob(chunks.map((chunk) => Uint8Array.from(chunk).buffer), { type: reader.info.mimeType || "audio/webm" });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.volume = 0.8;
          await audio.play();
          audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
        }).catch(() => undefined);
      });
      room.on(RoomEvent.Disconnected, () => { setStatus("idle"); disposeEncryptionRef.current?.(); disposeEncryptionRef.current = null; });
      room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (participantRole(participant) !== "owner") return;
        if (topic !== "pawly-command") return;
        try {
          const command = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; zoom?: number; box?: DogBox | null; enabled?: boolean };
          if (command.type === "wake_display") wakeDisplay();
          if (command.type === "enable_audio") {
            wakeDisplay(60_000);
            void enableAudio();
          }
          if (command.type === "request_saved_clips") void sendSavedClips(participant?.identity);
          if (command.type === "request_event_history") void sendEventHistory(participant?.identity);
          if (command.type === "request_status") void publishCameraHealth();
          if (command.type === "set_zoom" && Number.isFinite(command.zoom)) void applyCameraZoom(command.zoom ?? 1);
          if (command.type === "flip_camera") void replaceCamera(facingModeRef.current === "environment" ? "user" : "environment");
          if (command.type === "set_torch") void applyTorch(command.enabled === true);
          if (command.type === "play_ambient") void startAmbient();
          if (command.type === "stop_ambient") stopAmbient();
          if (command.type === "talk_target") {
            talkEnabledRef.current = command.enabled === true;
            const voiceTrack = ownerVoiceTrackRef.current;
            if (voiceTrack && remoteVoiceRef.current) {
              if (talkEnabledRef.current) {
                voiceTrack.attach(remoteVoiceRef.current);
                setOwnerVoiceActive(true);
                void room.startAudio().then(() => remoteVoiceRef.current?.play()).catch(() => undefined);
              } else {
                voiceTrack.detach(remoteVoiceRef.current);
                setOwnerVoiceActive(false);
              }
            }
          }
          if (command.type === "set_dog_target") {
            const box = command.box;
            const validBox = box &&
              [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
              box.width > 0.01 &&
              box.height > 0.01;
            ownerDogTargetRef.current = validBox ? box : null;
            setDogTargetMode(validBox ? "owner_guided" : "auto");
            dogDetectorRef.current?.setTargetBox(ownerDogTargetRef.current);
          }
          if (command.type === "stop_monitoring") void stop();
        } catch { /* Ignore malformed remote commands. */ }
      });
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (participantRole(participant) !== "owner") return;
        if (track.kind !== Track.Kind.Audio || !remoteVoiceRef.current) return;
        ownerVoiceTrackRef.current = track;
        if (talkEnabledRef.current) {
          track.attach(remoteVoiceRef.current);
          setOwnerVoiceActive(true);
          void room.startAudio().then(() => remoteVoiceRef.current?.play()).catch(() => undefined);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        track.detach();
        if (ownerVoiceTrackRef.current === track) ownerVoiceTrackRef.current = null;
        setOwnerVoiceActive(false);
      });
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (participantRole(participant) !== "owner") return;
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
      void publishCameraHealth();
      await requestWakeLock();
      setStatus("live");
      wakeDisplay(30_000);
      await publishEvent("monitoring_started");
    } catch (cause) {
      preparedStream?.getTracks().forEach((track) => track.stop());
      roomRef.current?.disconnect(); roomRef.current = null;
      disposeEncryptionRef.current?.(); disposeEncryptionRef.current = null;
      setAudioEnabled(false);
      audioEnabledRef.current = false;
      setAudioStatus("off");
      setError(cameraErrorMessage(cause)); setStatus("error");
    }
  }, [applyCameraZoom, applyTorch, enableAudio, publishAudioStatus, publishCameraHealth, publishEvent, replaceCamera, requestWakeLock, roomCode, sendEventHistory, sendSavedClips, startAmbient, stop, stopAmbient, wakeDisplay]);

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
        if (ownerDogTargetRef.current) {
          ownerDogTargetRef.current = null;
          setDogTargetMode("auto");
          dogDetectorRef.current?.setTargetBox(null);
          const room = roomRef.current;
          if (room?.localParticipant) {
            void room.localParticipant.publishData(
              new TextEncoder().encode(JSON.stringify({ type: "target_invalidated" })),
              { reliable: true, topic: "pawly-camera-status" },
            );
          }
        }
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
    controller.setTargetBox(ownerDogTargetRef.current);
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

  useEffect(() => {
    if (status !== "live") return;
    void publishCameraHealth();
    const timer = window.setInterval(() => void publishCameraHealth(), 8_000);
    return () => window.clearInterval(timer);
  }, [publishCameraHealth, status]);

  useEffect(() => () => {
    clearStandbyTimer();
    roomRef.current?.disconnect();
    stopAmbient();
    void ambientContextRef.current?.close().catch(() => undefined);
    ambientContextRef.current = null;
    disposeEncryptionRef.current?.();
    disposeEncryptionRef.current = null;
  }, [clearStandbyTimer, stopAmbient]);

  return <div className="camera-station">
    <div className="camera-header"><div><span className={`status-dot ${status}`} /><strong>{status === "live" ? "Monitoring live" : status === "connecting" ? "Opening room…" : status === "error" ? "Camera needs attention" : "Camera ready"}</strong></div><code>{roomCode}</code></div>
    <div className="camera-frame"><video ref={videoRef} autoPlay muted playsInline /><audio ref={remoteVoiceRef} autoPlay />{dogReading?.visible && dogReading.box && <div className={`dog-detection-box ${dogTargetMode === "owner_guided" ? "owner-guided" : ""}`} style={coverBoxStyle(dogReading.box, videoRef.current)}><span>{dogTargetMode === "owner_guided" ? "Your pet" : dogReading.petKind === "cat" ? "Cat" : "Dog"} · {Math.round(dogReading.confidence * 100)}%</span></div>}<div className="camera-analysis-stack"><div className="camera-overlay"><span>Scene wake</span><strong>{Math.round(motionScore * 100)}%</strong></div><div className={`camera-overlay dog-analysis ${dogReading?.visible ? "detected" : ""}`}><span>{dogTargetMode === "owner_guided" ? "Owner-guided AI" : "Pet AI"}</span><strong>{dogStatus === "loading" ? "Loading model…" : dogStatus === "unavailable" ? "Detector unavailable" : dogReading?.visible ? `${dogReading.petKind === "cat" ? "Cat" : "Dog"} · ${Math.round(dogReading.confidence * 100)}% visible` : dogReading ? "No pet in view" : "Ready · scanning"}</strong>{dogStatus === "unavailable" && <button className="dog-retry-button" onClick={() => dogDetectorRef.current?.retry()}>Retry</button>}</div><div className={`camera-overlay sound-analysis ${audioEnabled ? "detected" : ""}`}><span>Room mic</span><strong>{audioStatus === "requesting" ? "Requesting" : audioEnabled ? `${Math.round(audioLevel * 100)}% · on` : audioStatus === "blocked" ? "Permission needed" : "Off"}</strong></div><div className={`camera-overlay clip-analysis ${clipStatus === "recording" ? "recording" : ""}`}><span>Event clip</span><strong>{clipStatus === "recording" ? "Saving 12s" : clipStatus === "saved" ? "Saved" : clipStatus === "unsupported" ? "Unavailable" : "Ready"}</strong></div><div className={`camera-overlay talkback-analysis ${ownerVoiceActive ? "detected" : ""}`}><span>Talkback</span><strong>{ownerVoiceActive ? "Owner speaking" : ambientPlaying ? "Ambient sound" : "Ready"}</strong></div></div>{status !== "live" && <div className="camera-empty"><div className="camera-lens">◉</div><h1>Let the room stay still.</h1><p>Place this device where the floor, bed, or crate is visible. Pawly will request camera and microphone access; video still works if sound is declined.</p>{status === "error" && <p className="error-text" role="alert">{error}</p>}<button className="button button-light" onClick={start} disabled={status === "connecting"}>{status === "connecting" ? "Connecting…" : status === "error" ? "Try camera again" : "Resume Pawly camera"}</button></div>}{status === "live" && showMicrophoneHelp && <div className="microphone-permission-help" role="dialog" aria-live="polite"><span className="permission-icon">♪</span><h2>Turn on room sound</h2><p>Tap below to let Pawly use this device's microphone.</p><button className="button button-light" onClick={() => void enableAudio()} disabled={audioStatus === "requesting"}>{audioStatus === "requesting" ? "Opening microphone…" : "Allow microphone"}</button><small>If no permission box appears: open this browser's site settings, allow Microphone, return here, then tap Allow microphone again.</small><button className="permission-later" onClick={() => setShowMicrophoneHelp(false)}>Not now</button></div>}</div>
    {status === "live" && <div className="camera-controls"><div><strong>Dark standby keeps monitoring active</strong><span>{facingMode === "environment" ? "Back camera" : "Front camera"} · Pet AI {dogStatus === "ready" ? "ready" : dogStatus}. Do not lock this device—Pawly blacks out the page instead.</span>{!audioEnabled && <span className="camera-permission-tip">Need room sound? Allow Microphone in this browser's site settings, then tap Enable sound.</span>}</div><div className="camera-control-actions"><button className="button button-ghost camera-standby-button" onClick={() => void replaceCamera(facingMode === "environment" ? "user" : "environment")}>Flip camera</button>{torchSupported && <button className="button button-ghost camera-standby-button" onClick={() => void applyTorch(!torchOn)}>{torchOn ? "Flashlight on" : "Flashlight off"}</button>}{audioEnabled ? <button className="button button-ghost camera-standby-button" onClick={() => void disableAudio()}>Sound on · turn off</button> : <button className="button button-ghost camera-standby-button" onClick={() => void enableAudio()} disabled={audioStatus === "requesting"}>{audioStatus === "requesting" ? "Opening sound…" : audioStatus === "blocked" ? "Retry sound permission" : "Enable sound"}</button>}<button className="button button-ghost camera-standby-button" onClick={enterStandby}>Dark standby now</button><button className="button button-danger" onClick={stop}>Stop monitoring</button></div></div>}
    <p className="camera-privacy">End-to-end encrypted · {audioEnabled ? "sound analysis on" : "sound off"} · 12-second event clips only · saved locally · local adaptive AI</p>
    {status === "live" && standby && <button className="standby-screen" onClick={() => wakeDisplay()} aria-label="Wake the camera monitoring display"><span className="standby-dot" /><strong>Pawly is monitoring</strong><small>Tap anywhere to show the camera for 60 seconds</small></button>}
  </div>;
}

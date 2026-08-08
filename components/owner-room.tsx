"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Brand } from "./brand";
import { clipFileName, deleteClip, listSavedClips, parseClipFileName, saveClip, type SavedClip } from "@/lib/clip-store";
import type { PawlyEvent, SessionKind, SessionSummary } from "@/lib/domain";
import type { DogBox, PetKind } from "@/lib/dog-detector";
import { deriveState, summarizeWithRules } from "@/lib/session-engine";
import { dragSelectionToVideoBox, type DragSelection } from "@/lib/video-coordinates";
import { createEncryptedRoom, participantRole } from "@/lib/livekit-security";
import { deleteSound, listSavedSounds, saveSound, type SavedSound } from "@/lib/sound-store";

interface Props { roomCode: string; }
type ZoomMode = "checking" | "camera" | "view";
interface CameraHealth {
  camera: boolean;
  microphone: boolean;
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: "user" | "environment";
  torchSupported?: boolean;
  torchOn?: boolean;
  detector?: string;
  observedAt?: number;
  connectionQuality?: string;
}
interface CameraDeviceState {
  identity: string;
  id: string;
  name: string;
  health?: CameraHealth;
}

const stateCopy = { calm: ["Calm", "The room has settled"], active: ["Active", "A sustained change was noticed"], out_of_view: ["Out of view", "The camera is still online"], unavailable: ["Unavailable", "The camera needs attention"], connecting: ["Connecting", "Looking for the camera"] } as const;
const durationOptions: Record<SessionKind, number[]> = {
  quick_check: [10, 15, 20, 30],
  away_monitoring: [30, 60, 120, 180, 240],
};

function preferredAudioRecordingType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
    .find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function compactDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes}m ${remainder}s` : `${minutes} min`;
}

function coverBoxStyle(box: DogBox, video: HTMLVideoElement | null) {
  if (!video?.videoWidth || !video.videoHeight || !video.clientWidth || !video.clientHeight) {
    return { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` };
  }
  const scale = Math.max(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  return {
    left: (video.clientWidth - renderedWidth) / 2 + box.x * renderedWidth,
    top: (video.clientHeight - renderedHeight) / 2 + box.y * renderedHeight,
    width: box.width * renderedWidth,
    height: box.height * renderedHeight,
  };
}

async function requestSessionSummary(
  roomCode: string,
  events: PawlyEvent[],
  startedAt: number,
  targetMinutes: number,
  sessionKind: SessionKind,
  petName: string,
) {
  const fallback = summarizeWithRules(events, startedAt, Date.now(), targetMinutes, sessionKind);
  try {
    const response = await fetch("/api/session-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode, dogName: petName, sessionKind, targetMinutes, startedAt, events }),
    });
    if (!response.ok) throw new Error("AI summary unavailable");
    return await response.json() as SessionSummary;
  } catch {
    return fallback;
  }
}

function eventSymbol(type: PawlyEvent["type"]) {
  if (type === "motion_active" || type === "repeated_movement") return "↗";
  if (type === "sound_active") return "♪";
  if (type === "dog_visible") return "●";
  if (type === "dog_not_visible") return "?";
  if (type === "camera_repositioned") return "↻";
  if (type.includes("camera")) return "!";
  return "✓";
}

function cameraInfo(participant: { identity: string; metadata?: string | null }): CameraDeviceState {
  try {
    const metadata = JSON.parse(participant.metadata ?? "{}") as { deviceId?: string; deviceName?: string };
    return {
      identity: participant.identity,
      id: metadata.deviceId ?? participant.identity.replace(/^camera-/, ""),
      name: metadata.deviceName?.trim() || "Pet camera",
    };
  } catch {
    return { identity: participant.identity, id: participant.identity.replace(/^camera-/, ""), name: "Pet camera" };
  }
}

function SavedClipCard({ clip, onDelete }: { clip: SavedClip; onDelete(id: string): void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const nextUrl = URL.createObjectURL(clip.blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [clip.blob]);
  const label = clip.trigger === "sound" ? "Sustained sound" : clip.trigger === "repeated_movement" ? "Repeated dog movement" : "Dog movement";
  return <article className="saved-clip-card">
    {url && <video src={url} controls playsInline preload="metadata" />}
    <div><strong>{label}</strong><span>{new Date(clip.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {Math.round(clip.durationMs / 1000)} sec</span></div>
    <div className="clip-actions"><a href={url} download={clipFileName(clip)}>Download</a><button onClick={() => onDelete(clip.id)}>Delete</button></div>
  </article>;
}

export function OwnerRoom({ roomCode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  const cameraTracksRef = useRef(new Map<string, { video?: Track; audio?: Track }>());
  const selectedCameraIdentityRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const soundRecordingTimerRef = useRef<number | null>(null);
  const soundDeliveryTimerRef = useRef<number | null>(null);
  const localSoundPreviewRef = useRef<HTMLAudioElement | null>(null);
  const disposeEncryptionRef = useRef<(() => void) | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<PawlyEvent[]>([]);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [sessionKind, setSessionKind] = useState<SessionKind>("away_monitoring");
  const [targetMinutes, setTargetMinutes] = useState(180);
  const [customAwayHours, setCustomAwayHours] = useState(5);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [arrivalSummary, setArrivalSummary] = useState<SessionSummary | null>(null);
  const [arrivalSummaryLoading, setArrivalSummaryLoading] = useState(false);
  const [wakeSent, setWakeSent] = useState(false);
  const [remoteAudioAvailable, setRemoteAudioAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [cameraAudioStatus, setCameraAudioStatus] = useState<"unknown" | "on" | "off">("unknown");
  const [roomSoundRequest, setRoomSoundRequest] = useState<"idle" | "requesting" | "sent">("idle");
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [clipReceiveProgress, setClipReceiveProgress] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("checking");
  const [zoomBounds, setZoomBounds] = useState({ min: 1, max: 3 });
  const [talking, setTalking] = useState(false);
  const [talkStatus, setTalkStatus] = useState<"ready" | "requesting" | "blocked">("ready");
  const [dogTrack, setDogTrack] = useState<{ visible: boolean; confidence: number; box: DogBox | null; targetMode: "auto" | "owner_guided" } | null>(null);
  const [dogSelectionMode, setDogSelectionMode] = useState(false);
  const [dogSelection, setDogSelection] = useState<DragSelection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roomCodeVisible, setRoomCodeVisible] = useState(false);
  const [roomLinkCopied, setRoomLinkCopied] = useState<"camera" | "owner" | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [endingMonitoring, setEndingMonitoring] = useState(false);
  const [trackingAssistReady, setTrackingAssistReady] = useState(false);
  const [cameras, setCameras] = useState<CameraDeviceState[]>([]);
  const [selectedCameraIdentity, setSelectedCameraIdentity] = useState<string | null>(null);
  const [petKind, setPetKind] = useState<PetKind | null>(null);
  const [activePets, setActivePets] = useState<Array<{ name: string; species: PetKind }>>([]);
  const [savedSounds, setSavedSounds] = useState<SavedSound[]>([]);
  const [recordingSound, setRecordingSound] = useState<"No" | "Good job" | null>(null);
  const [ambientPlaying, setAmbientPlaying] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const [soundNotice, setSoundNotice] = useState("");
  const [soundDelivery, setSoundDelivery] = useState<{ soundId: string; status: "sending" | "playing" | "finished" | "blocked"; message: string } | null>(null);
  const [recapExpanded, setRecapExpanded] = useState(false);
  const [cameraMediaRevision, setCameraMediaRevision] = useState(0);
  const reviewSinceRef = useRef(Date.now() - 4 * 60 * 60 * 1000);
  const autoSummaryRequestedRef = useRef(false);
  const sessionSettingsRef = useRef({ sessionKind, targetMinutes });
  const activePetNameRef = useRef("Your pet");
  const state = deriveState(events, connected);

  useEffect(() => {
    selectedCameraIdentityRef.current = selectedCameraIdentity;
    const selectedTracks = selectedCameraIdentity ? cameraTracksRef.current.get(selectedCameraIdentity) : null;
    for (const tracks of cameraTracksRef.current.values()) {
      tracks.video?.detach();
      tracks.audio?.detach();
    }
    if (videoRef.current && selectedTracks?.video) selectedTracks.video.attach(videoRef.current);
    if (audioRef.current && selectedTracks?.audio) {
      selectedTracks.audio.attach(audioRef.current);
      audioRef.current.muted = !listening;
      if (listening) void audioRef.current.play().catch(() => undefined);
    }
    setRemoteAudioAvailable(Boolean(selectedTracks?.audio));
  }, [cameraMediaRevision, listening, selectedCameraIdentity]);

  const commandOptions = useCallback(() => ({
    reliable: true,
    topic: "pawly-command",
    destinationIdentities: selectedCameraIdentity ? [selectedCameraIdentity] : undefined,
  }), [selectedCameraIdentity]);

  const sendCommand = useCallback(async (command: Record<string, unknown>) => {
    const room = roomRef.current;
    if (!room || !connected) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(command)), commandOptions());
  }, [commandOptions, connected]);
  const selectedDeviceId = cameras.find((camera) => camera.identity === selectedCameraIdentity)?.id ?? null;

  const refreshClips = useCallback(async () => {
    setClips(await listSavedClips(roomCode));
  }, [roomCode]);

  useEffect(() => { void refreshClips(); }, [refreshClips]);
  useEffect(() => { void listSavedSounds(roomCode).then(setSavedSounds).catch(() => undefined); }, [roomCode]);
  useEffect(() => () => {
    if (soundRecordingTimerRef.current != null) window.clearTimeout(soundRecordingTimerRef.current);
    if (soundDeliveryTimerRef.current != null) window.clearTimeout(soundDeliveryTimerRef.current);
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    localSoundPreviewRef.current?.pause();
  }, []);
  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ pets?: Array<{ name: string; species: PetKind; isPrimary: boolean; isMonitored: boolean }> }> : null)
      .then((profile) => {
        const savedPets = profile?.pets ?? [];
        const monitoredPets = savedPets.filter((candidate) => candidate.isMonitored);
        const selectedPets = monitoredPets.length > 0 ? monitoredPets : savedPets.slice(0, 1);
        setActivePets(selectedPets);
        activePetNameRef.current = selectedPets.length > 0 ? selectedPets.map((pet) => pet.name).join(" and ") : "Your pet";
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!selectedCameraIdentity || !selectedDeviceId || !connected) return;
    void fetch(`/api/devices/${selectedDeviceId}/target`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ target?: { box?: DogBox } | null }> : null)
      .then((data) => {
        const box = data?.target?.box;
        if (box && [box.x, box.y, box.width, box.height].every(Number.isFinite)) void sendCommand({ type: "set_dog_target", box });
      })
      .catch(() => {
        try {
          const saved = JSON.parse(localStorage.getItem(`pawly-pet-target-${roomCode}-${selectedCameraIdentity}`) ?? "null") as DogBox | null;
          if (saved) void sendCommand({ type: "set_dog_target", box: saved });
        } catch { /* Auto detection remains available if calibration cannot be restored. */ }
      });
  }, [connected, roomCode, selectedCameraIdentity, selectedDeviceId, sendCommand]);
  useEffect(() => {
    if (!connected || !selectedCameraIdentity) return;
    setZoom(1);
    setZoomMode("checking");
    setDogTrack(null);
    setPetKind(null);
    void sendCommand({ type: "request_status" });
    void sendCommand({ type: "set_zoom", zoom: 1 });
    void sendCommand({ type: "request_event_history" });
  }, [connected, selectedCameraIdentity, sendCommand]);
  useEffect(() => {
    sessionSettingsRef.current = { sessionKind, targetMinutes };
  }, [sessionKind, targetMinutes]);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(`pawly-last-review-${roomCode}`));
      if (Number.isFinite(saved) && saved > Date.now() - 24 * 60 * 60 * 1000) reviewSinceRef.current = saved;
    } catch { /* A four-hour recap window remains available without local storage. */ }
  }, [roomCode]);

  const connect = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/livekit-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomCode, mode: "owner" }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not join room");
      const { token, serverUrl, e2eeKey } = await response.json();
      const encrypted = await createEncryptedRoom(e2eeKey, { adaptiveStream: true, disconnectOnPageLeave: true });
      const room = encrypted.room;
      disposeEncryptionRef.current = encrypted.disposeEncryption;
      roomRef.current = room;
      const requestSavedClips = () => room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: "request_saved_clips" })),
        { reliable: true, topic: "pawly-command" },
      );
      const requestEventHistory = () => room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: "request_event_history" })),
        { reliable: true, topic: "pawly-command" },
      );
      const requestCameraZoom = () => room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: "set_zoom", zoom: 1 })),
        { reliable: true, topic: "pawly-command" },
      );
      room.registerByteStreamHandler("pawly-clip", (reader) => {
        reader.onProgress = (progress) => setClipReceiveProgress(progress ?? 0);
        void reader.readAll().then(async (chunks) => {
          const parsedName = parseClipFileName(reader.info.name);
          if (!parsedName) return;
          const blob = new Blob(chunks.map((chunk) => Uint8Array.from(chunk).buffer), { type: reader.info.mimeType || "video/webm" });
          await saveClip({ ...parsedName, roomCode, durationMs: 12_000, mimeType: blob.type, blob });
          await refreshClips();
        }).finally(() => setClipReceiveProgress(null));
      });
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (participantRole(participant) !== "camera") return;
        const current = cameraTracksRef.current.get(participant.identity) ?? {};
        if (track.kind === Track.Kind.Video) current.video = track;
        if (track.kind === Track.Kind.Audio) current.audio = track;
        cameraTracksRef.current.set(participant.identity, current);
        setCameraMediaRevision((revision) => revision + 1);
        const info = cameraInfo(participant);
        setCameras((items) => items.some((item) => item.identity === info.identity) ? items.map((item) => item.identity === info.identity ? { ...item, ...info } : item) : [...items, info]);
        setSelectedCameraIdentity((identity) => identity ?? participant.identity);
        if (track.kind === Track.Kind.Audio) setCameraAudioStatus("on");
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        const current = cameraTracksRef.current.get(participant.identity);
        if (current?.video === track) delete current.video;
        if (current?.audio === track) delete current.audio;
        if (track.kind === Track.Kind.Audio && participant.identity === selectedCameraIdentityRef.current) {
          setRemoteAudioAvailable(false);
          setListening(false);
          setCameraAudioStatus("off");
        }
        track.detach();
        setCameraMediaRevision((revision) => revision + 1);
      });
      room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (participantRole(participant) !== "camera") return;
        if (topic === "pawly-event-history") {
          try {
            const history = JSON.parse(new TextDecoder().decode(payload)) as PawlyEvent[];
            if (!Array.isArray(history)) return;
            setEvents((current) => {
              const unique = new Map([...history, ...current].map((event) => [event.id, event]));
              return [...unique.values()].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, 100);
            });
            if (!autoSummaryRequestedRef.current) {
              autoSummaryRequestedRef.current = true;
              const now = Date.now();
              const recent = history
                .filter((event) => {
                  const timestamp = Date.parse(event.occurredAt);
                  return Number.isFinite(timestamp) && timestamp >= reviewSinceRef.current && timestamp <= now;
                })
                .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
              const settings = sessionSettingsRef.current;
              const recapStartedAt = recent.length
                ? Math.min(...recent.map((event) => Date.parse(event.occurredAt)))
                : Math.max(reviewSinceRef.current, now - 5 * 60 * 1000);
              setArrivalSummaryLoading(true);
              void requestSessionSummary(roomCode, recent, recapStartedAt, settings.targetMinutes, settings.sessionKind, activePetNameRef.current)
                .then(setArrivalSummary)
                .finally(() => setArrivalSummaryLoading(false));
              try {
                localStorage.setItem(`pawly-last-review-${roomCode}`, String(now));
              } catch { /* Recap still works when visit state cannot be persisted. */ }
            }
          } catch { /* ignore malformed event history */ }
          return;
        }
        if (topic === "pawly-dog-track") {
          if (selectedCameraIdentityRef.current && participant?.identity !== selectedCameraIdentityRef.current) return;
          try {
            const reading = JSON.parse(new TextDecoder().decode(payload)) as { visible?: boolean; confidence?: number; box?: DogBox | null; targetMode?: "auto" | "owner_guided"; petKind?: PetKind | null };
            setDogTrack({
              visible: reading.visible === true,
              confidence: Number.isFinite(reading.confidence) ? reading.confidence ?? 0 : 0,
              box: reading.box ?? null,
              targetMode: reading.targetMode === "owner_guided" ? "owner_guided" : "auto",
            });
            setPetKind(reading.petKind === "cat" ? "cat" : reading.petKind === "dog" ? "dog" : null);
          } catch { /* ignore malformed tracking data */ }
          return;
        }
        if (topic === "pawly-camera-status") {
          try {
            const status = JSON.parse(new TextDecoder().decode(payload)) as CameraHealth & { type?: string; supported?: boolean; zoom?: number; min?: number; max?: number; enabled?: boolean; soundId?: string; status?: "playing" | "finished" | "blocked"; message?: string };
            if (status.type === "health_status" && participant) {
              setCameras((items) => items.map((item) => item.identity === participant.identity ? { ...item, health: status } : item));
            }
            if (selectedCameraIdentityRef.current && participant?.identity !== selectedCameraIdentityRef.current) return;
            if (status.type === "zoom_status") {
              setZoomMode(status.supported ? "camera" : "view");
              if (status.supported && Number.isFinite(status.zoom)) setZoom(status.zoom ?? 1);
              if (status.supported && Number.isFinite(status.min) && Number.isFinite(status.max)) setZoomBounds({ min: status.min ?? 1, max: status.max ?? 3 });
            }
            if (status.type === "audio_status") {
              setCameraAudioStatus(status.enabled ? "on" : "off");
              if (status.enabled) setRoomSoundRequest("idle");
            }
            if (status.type === "sound_playback" && status.soundId && status.status) {
              if (soundDeliveryTimerRef.current != null) window.clearTimeout(soundDeliveryTimerRef.current);
              soundDeliveryTimerRef.current = null;
              const message = status.message ?? (status.status === "playing" ? "Playing on the camera now" : status.status === "finished" ? "Played on the camera" : "Playback needs attention on the camera");
              setSoundDelivery({ soundId: status.soundId, status: status.status, message });
              if (status.status === "blocked") setError(message);
            }
            if (status.type === "target_invalidated") {
              setDogTrack((current) => current ? { ...current, targetMode: "auto" } : current);
              setError("The camera moved, so Pawly cleared the saved pet selection. Re-select your pet after the view settles.");
              if (participant && participant.identity === selectedCameraIdentityRef.current) {
                const deviceId = cameraInfo(participant).id;
                void fetch(`/api/devices/${deviceId}/target`, { method: "DELETE" }).catch(() => undefined);
              }
            }
          } catch { /* ignore malformed camera status */ }
          return;
        }
        if (topic !== "pawly-event") return;
        try {
          const event = JSON.parse(new TextDecoder().decode(payload)) as PawlyEvent;
          setEvents((current) => [event, ...current].slice(0, 100));
          const noteworthy = event.type === "motion_active" || event.type === "sound_active" || event.type === "repeated_movement" || event.type === "dog_not_visible";
          if (document.hidden && noteworthy && Notification.permission === "granted") new Notification(event.message, { body: "Open Pawly to check the room timeline." });
        } catch { /* ignore malformed participant data */ }
      });
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (participantRole(participant) !== "camera") return;
        const info = cameraInfo(participant);
        setCameras((items) => items.some((item) => item.identity === info.identity) ? items : [...items, info]);
        setSelectedCameraIdentity((identity) => identity ?? participant.identity);
        setConnected(true); setZoomMode("checking"); void requestSavedClips(); void requestEventHistory(); void requestCameraZoom();
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        cameraTracksRef.current.delete(participant.identity);
        setCameras((items) => items.filter((item) => item.identity !== participant.identity));
        setSelectedCameraIdentity((identity) => identity === participant.identity ? null : identity);
        const cameraStillOnline = [...room.remoteParticipants.values()].some((participant) => participantRole(participant) === "camera");
        setConnected(cameraStillOnline);
        if (!cameraStillOnline) {
          void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
          setTalking(false);
          setRemoteAudioAvailable(false);
          setListening(false);
          setCameraAudioStatus("unknown");
          setDogTrack(null);
        }
      });
      room.on(RoomEvent.Disconnected, () => { setConnected(false); setTalking(false); setRemoteAudioAvailable(false); setListening(false); setCameraAudioStatus("unknown"); setDogTrack(null); disposeEncryptionRef.current?.(); disposeEncryptionRef.current = null; });
      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (participantRole(participant) !== "camera") return;
        setCameras((items) => items.map((item) => item.identity === participant.identity ? { ...item, health: { ...(item.health ?? { camera: true, microphone: false }), connectionQuality: String(quality) } } : item));
      });
      await room.connect(serverUrl, token);
      const cameraOnline = [...room.remoteParticipants.values()].some((participant) => participantRole(participant) === "camera");
      setConnected(cameraOnline);
      const initialCameras = [...room.remoteParticipants.values()].filter((participant) => participantRole(participant) === "camera").map(cameraInfo);
      setCameras(initialCameras);
      setSelectedCameraIdentity((identity) => identity ?? initialCameras[0]?.identity ?? null);
      if (cameraOnline) { void requestSavedClips(); void requestEventHistory(); void requestCameraZoom(); }
      for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) {
        if (participantRole(participant) !== "camera") continue;
        const current = cameraTracksRef.current.get(participant.identity) ?? {};
        if (publication.track?.kind === Track.Kind.Video) current.video = publication.track;
        if (publication.track?.kind === Track.Kind.Audio) current.audio = publication.track;
        cameraTracksRef.current.set(participant.identity, current);
        if (publication.track?.kind === Track.Kind.Audio) setCameraAudioStatus("on");
      }
      setCameraMediaRevision((revision) => revision + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join room"); }
  }, [refreshClips, roomCode]);

  useEffect(() => {
    // Connection state is synchronized from the external LiveKit room.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void connect();
    return () => { void roomRef.current?.disconnect(); disposeEncryptionRef.current?.(); disposeEncryptionRef.current = null; };
  }, [connect]);
  useEffect(() => {
    if (!connected || zoomMode !== "checking") return;
    const timer = window.setTimeout(() => setZoomMode((current) => current === "checking" ? "view" : current), 2_500);
    return () => window.clearTimeout(timer);
  }, [connected, zoomMode]);
  useEffect(() => {
    setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);
  useEffect(() => {
    if (!connected) {
      setTrackingAssistReady(false);
      return;
    }
    const timer = window.setTimeout(() => setTrackingAssistReady(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [connected]);
  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);
  useEffect(() => { const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000); return () => window.clearInterval(timer); }, [startedAt]);

  const sessionTime = useMemo(() => `${String(Math.floor(elapsed / 60000)).padStart(2, "0")}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}`, [elapsed]);
  const [label, sublabel] = stateCopy[state];

  const finishSession = async (useAi: boolean) => {
    const rulesSummary = summarizeWithRules(events, startedAt, Date.now(), targetMinutes, sessionKind);
    if (!useAi) { setSummary(rulesSummary); return; }
    setSummaryLoading(true);
    try {
      setSummary(await requestSessionSummary(roomCode, events, startedAt, targetMinutes, sessionKind, activePetNameRef.current));
    } catch { setSummary(rulesSummary); } finally { setSummaryLoading(false); }
  };

  const requestNotifications = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    setNotificationPermission(await Notification.requestPermission());
  };

  const copyRoomLink = async (target: "camera" | "owner") => {
    const url = `${window.location.origin}/${target === "camera" ? "camera" : "watch"}?room=${roomCode}`;
    await navigator.clipboard.writeText(url);
    setRoomLinkCopied(target);
    window.setTimeout(() => setRoomLinkCopied(null), 1_800);
  };

  const toggleListening = async () => {
    const room = roomRef.current;
    const element = audioRef.current;
    if (!room || !element || !remoteAudioAvailable) return;
    if (listening) {
      element.pause();
      element.muted = true;
      setListening(false);
      return;
    }
    try {
      await room.startAudio();
      element.muted = false;
      await element.play();
      setListening(true);
    } catch {
      setListening(false);
      setError("Tap the room sound button again and allow audio playback in this browser.");
    }
  };

  const toggleTalking = async () => {
    const room = roomRef.current;
    if (!room || !connected) return;
    if (talking) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await sendCommand({ type: "talk_target", enabled: false }).catch(() => undefined);
      setTalking(false);
      setTalkStatus("ready");
      return;
    }
    setTalkStatus("requesting");
    try {
      await sendCommand({ type: "talk_target", enabled: true });
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      setTalking(true);
      setTalkStatus("ready");
    } catch {
      setTalking(false);
      setTalkStatus("blocked");
    }
  };

  const wakeIpadDisplay = async () => {
    if (!connected) return;
    await sendCommand({ type: "wake_display" });
    setWakeSent(true);
    window.setTimeout(() => setWakeSent(false), 2500);
  };

  const endMonitoring = async () => {
    const room = roomRef.current;
    if (!room || endingMonitoring) return;
    setEndingMonitoring(true);
    try {
      await sendCommand({ type: "stop_monitoring" });
      setSummary(await requestSessionSummary(roomCode, events, startedAt, targetMinutes, sessionKind, activePetNameRef.current));
      await room.disconnect();
      setConnected(false);
      setSettingsOpen(false);
      setShowEndConfirm(false);
    } catch {
      setError("Could not stop the camera remotely. Stop monitoring on the camera device.");
    } finally {
      setEndingMonitoring(false);
    }
  };

  const requestRoomSound = async () => {
    const room = roomRef.current;
    if (!room || !connected) return;
    setRoomSoundRequest("requesting");
    try {
      await sendCommand({ type: "wake_display" });
      await sendCommand({ type: "enable_audio" });
      setRoomSoundRequest("sent");
    } catch {
      setRoomSoundRequest("idle");
      setError("Could not reach the camera. Check that the iPad is still online.");
    }
  };

  const setCameraZoom = async (requestedZoom: number) => {
    const lower = zoomMode === "camera" ? zoomBounds.min : 1;
    const upper = zoomMode === "camera" ? zoomBounds.max : 3;
    const nextZoom = Math.min(upper, Math.max(lower, Math.round(requestedZoom * 10) / 10));
    setZoom(nextZoom);
    await sendCommand({ type: "set_zoom", zoom: nextZoom });
  };

  const sendDogTarget = async (box: DogBox | null) => {
    if (!connected) return;
    await sendCommand({ type: "set_dog_target", box });
    if (selectedCameraIdentity) {
      try {
        if (box) localStorage.setItem(`pawly-pet-target-${roomCode}-${selectedCameraIdentity}`, JSON.stringify(box));
        else localStorage.removeItem(`pawly-pet-target-${roomCode}-${selectedCameraIdentity}`);
      } catch { /* Calibration still works for the current session. */ }
    }
    if (selectedDeviceId) {
      void fetch(`/api/devices/${selectedDeviceId}/target`, box ? {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(box),
      } : { method: "DELETE" }).catch(() => undefined);
    }
    setDogTrack((current) => current ? { ...current, targetMode: box ? "owner_guided" : "auto" } : current);
  };

  const localPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    };
  };

  const beginDogSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dogSelectionMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPointer(event);
    setDogSelection({ startX: point.x, startY: point.y, endX: point.x, endY: point.y });
  };

  const moveDogSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dogSelectionMode || !dogSelection || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = localPointer(event);
    setDogSelection((current) => current ? { ...current, endX: point.x, endY: point.y } : current);
  };

  const finishDogSelection = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dogSelectionMode || !dogSelection) return;
    const point = localPointer(event);
    const finalSelection = { ...dogSelection, endX: point.x, endY: point.y };
    const video = videoRef.current;
    const target = video ? dragSelectionToVideoBox(finalSelection, {
      width: video.clientWidth,
      height: video.clientHeight,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      zoom: zoomMode === "camera" ? 1 : zoom,
    }) : null;
    setDogSelection(null);
    if (!target) {
      setError("Draw a slightly larger box around your dog and try again.");
      return;
    }
    setError("");
    setDogSelectionMode(false);
    await sendDogTarget(target);
  };

  const removeClip = async (id: string) => {
    await deleteClip(id);
    await refreshClips();
  };

  const togglePictureInPicture = async () => {
    const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> };
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video.requestPictureInPicture) await video.requestPictureInPicture();
      else setError("Floating view is not supported in this browser.");
    } catch {
      await sendCommand({ type: "talk_target", enabled: false }).catch(() => undefined);
      setError("This browser could not open floating view. Try Safari or Chrome outside an in-app browser.");
    }
  };

  const flipCamera = async () => {
    await sendCommand({ type: "flip_camera" });
    if (selectedCameraIdentity) {
      try { localStorage.removeItem(`pawly-pet-target-${roomCode}-${selectedCameraIdentity}`); } catch { /* no-op */ }
    }
    if (selectedDeviceId) void fetch(`/api/devices/${selectedDeviceId}/target`, { method: "DELETE" }).catch(() => undefined);
    setDogTrack(null);
    setZoom(1);
    setZoomMode("checking");
  };

  const toggleTorch = async () => {
    const selected = cameras.find((camera) => camera.identity === selectedCameraIdentity);
    await sendCommand({ type: "set_torch", enabled: !selected?.health?.torchOn });
  };

  const toggleAmbient = async () => {
    await sendCommand({ type: ambientPlaying ? "stop_ambient" : "play_ambient" });
    setAmbientPlaying((current) => !current);
  };

  const recordSound = async (label: "No" | "Good job") => {
    if (recordingSound) {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      setSoundDelivery(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = preferredAudioRecordingType();
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
      const chunks: Blob[] = [];
      setSoundNotice(`Recording “${label}”… speak clearly, then tap Stop & save.`);
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        setError("The browser interrupted this recording. Please try again.");
        setSoundNotice("");
      };
      recorder.onstop = async () => {
        if (soundRecordingTimerRef.current != null) window.clearTimeout(soundRecordingTimerRef.current);
        soundRecordingTimerRef.current = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (blob.size < 300) {
          setError("The recording was empty. Check microphone permission and try again.");
          setSoundNotice("");
          stream.getTracks().forEach((track) => track.stop());
          mediaRecorderRef.current = null;
          setRecordingSound(null);
          return;
        }
        const sound: SavedSound = { id: crypto.randomUUID(), roomCode, label, createdAt: Date.now(), mimeType: blob.type, blob };
        try {
          await saveSound(sound);
          setSavedSounds(await listSavedSounds(roomCode));
          setSoundNotice(`“${label}” saved. Tap Test here before sending it to the camera.`);
        } catch {
          setError("The recording could not be saved on this device.");
          setSoundNotice("");
        }
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        setRecordingSound(null);
      };
      mediaRecorderRef.current = recorder;
      setRecordingSound(label);
      recorder.start(250);
      soundRecordingTimerRef.current = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 6_000);
    } catch {
      setError("Allow microphone access to record a sound button.");
      setSoundNotice("");
    }
  };

  const previewSavedSound = async (sound: SavedSound) => {
    setSoundDelivery(null);
    localSoundPreviewRef.current?.pause();
    const url = URL.createObjectURL(sound.blob);
    const audio = new Audio(url);
    localSoundPreviewRef.current = audio;
    audio.addEventListener("ended", () => { URL.revokeObjectURL(url); if (localSoundPreviewRef.current === audio) localSoundPreviewRef.current = null; }, { once: true });
    audio.addEventListener("error", () => { URL.revokeObjectURL(url); setError("This browser could not play the saved recording. Record it again in this browser."); }, { once: true });
    try {
      await audio.play();
      setSoundNotice(`Testing “${sound.label}” on this owner device.`);
    } catch {
      URL.revokeObjectURL(url);
      setError("Tap Test again to allow sound playback in this browser.");
    }
  };

  const playSavedSound = async (sound: SavedSound) => {
    const room = roomRef.current;
    if (!room || !selectedCameraIdentity || soundBusy) return;
    setSoundBusy(true);
    setSoundDelivery({ soundId: sound.id, status: "sending", message: `Sending “${sound.label}” to the selected camera…` });
    try {
      const extension = sound.mimeType.includes("mp4") ? "m4a" : "webm";
      await room.localParticipant.sendFile(new File([sound.blob], `pawly-sound-${sound.id}.${extension}`, { type: sound.mimeType }), {
        topic: "pawly-sound",
        mimeType: sound.mimeType,
        destinationIdentities: [selectedCameraIdentity],
      });
      if (soundDeliveryTimerRef.current != null) window.clearTimeout(soundDeliveryTimerRef.current);
      soundDeliveryTimerRef.current = window.setTimeout(() => {
        setSoundDelivery((current) => current?.soundId === sound.id && current.status === "sending"
          ? { soundId: sound.id, status: "blocked", message: "The camera received no playback confirmation. Check that its volume is up, tap its screen once, and try again." }
          : current);
      }, 8_000);
    } catch {
      setSoundDelivery({ soundId: sound.id, status: "blocked", message: "The sound could not reach this camera." });
      setError("The sound could not reach this camera.");
    } finally {
      setSoundBusy(false);
    }
  };

  const removeSound = async (id: string) => {
    await deleteSound(id);
    setSavedSounds(await listSavedSounds(roomCode));
    setSoundDelivery((current) => current?.soundId === id ? null : current);
  };

  const selectCamera = async (identity: string) => {
    const room = roomRef.current;
    if (talking && room && selectedCameraIdentity) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: "talk_target", enabled: false })),
        { reliable: true, topic: "pawly-command", destinationIdentities: [selectedCameraIdentity] },
      ).catch(() => undefined);
      setTalking(false);
    }
    setListening(false);
    setSelectedCameraIdentity(identity);
  };

  const customAwayWindow = sessionKind === "away_monitoring" && targetMinutes > 240;
  const maskedRoomCode = `${roomCode.slice(0, 4)}••••${roomCode.slice(-4)}`;
  const dogTrackingNeedsHelp = trackingAssistReady && (!dogTrack?.visible || dogTrack.confidence < 0.55);
  const showDogTargetControls = connected && (dogSelectionMode || dogTrack?.targetMode === "owner_guided" || dogTrackingNeedsHelp);
  const dogAssistLabel = dogSelectionMode
    ? "Cancel selection"
    : dogTrack?.targetMode === "owner_guided"
      ? "Re-select your pet"
      : dogTrack?.visible
        ? "Not sure — select your pet"
        : "Pet not found — help AI";
  const hasArrivalActivity = Boolean(arrivalSummary && arrivalSummary.activeEvents > 0);
  const selectedCamera = cameras.find((camera) => camera.identity === selectedCameraIdentity) ?? null;
  const zoomMinimum = zoomMode === "camera" ? zoomBounds.min : 1;
  const zoomMaximum = zoomMode === "camera" ? zoomBounds.max : 3;

  return <main className="dashboard-page">
    <nav className="dashboard-nav">
      <Brand />
      <div className="dashboard-nav-actions">
        <Link className="camera-manager-link" href="/setup">Cameras</Link>
        <button
          className="room-menu-button"
          type="button"
          aria-label="Open room and device settings"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(true)}
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>
    </nav>
    <div className="dashboard-grid">
      <section className="live-panel">
        <div className="panel-title"><div><span className={`status-dot ${connected ? "live" : "connecting"}`} /><span>{selectedCamera ? `${selectedCamera.name} online` : connected ? "Camera online" : "Waiting for camera"}</span></div><span className="private-room-label">End-to-end encrypted</span></div>
        <div className="camera-tabs-wrap">
          <div className="camera-tabs-heading"><span>Camera devices</span><Link href="/setup">Manage cameras</Link></div>
          <div className="camera-device-tabs" aria-label="Camera devices">
            {cameras.map((camera) => <button key={camera.identity} className={camera.identity === selectedCameraIdentity ? "selected" : ""} onClick={() => void selectCamera(camera.identity)}>
              <span className="status-dot live" /><strong>{camera.name}</strong><small>{camera.health?.connectionQuality ? camera.health.connectionQuality.replace(/^CONNECTION_QUALITY_/, "").toLowerCase() : "online"}</small>
            </button>)}
            {cameras.length === 0 && <span className="camera-offline-chip"><span className="status-dot connecting" />No camera online</span>}
            <Link href="/setup" className="add-camera-tab">+ Add camera</Link>
          </div>
        </div>
        <div className="owner-video">
          <video ref={videoRef} autoPlay playsInline style={{ transform: zoomMode === "camera" ? "scale(1)" : `scale(${zoom})` }} />
          <audio ref={audioRef} playsInline />
          {connected && dogTrack?.visible && dogTrack.box && (
            <div className="dog-track-layer" style={{ transform: zoomMode === "camera" ? "scale(1)" : `scale(${zoom})` }}>
              <div className={`dog-detection-box ${dogTrack.targetMode === "owner_guided" ? "owner-guided" : ""}`} style={coverBoxStyle(dogTrack.box, videoRef.current)}>
                <span>{dogTrack.targetMode === "owner_guided" ? activePets.length === 1 ? activePets[0].name : "Your pets" : petKind === "cat" ? "Cat" : "Dog"} · {Math.round(dogTrack.confidence * 100)}%</span>
              </div>
            </div>
          )}
          {connected && <div
            className={`dog-target-selection-layer ${dogSelectionMode ? "selecting" : ""}`}
            onPointerDown={beginDogSelection}
            onPointerMove={moveDogSelection}
            onPointerUp={(event) => void finishDogSelection(event)}
            onPointerCancel={() => setDogSelection(null)}
            aria-hidden={!dogSelectionMode}
          >
            {dogSelectionMode && <div className="dog-selection-instruction">Drag a box around your pet</div>}
            {dogSelection && <div className="dog-selection-draft" style={{
              left: Math.min(dogSelection.startX, dogSelection.endX),
              top: Math.min(dogSelection.startY, dogSelection.endY),
              width: Math.abs(dogSelection.endX - dogSelection.startX),
              height: Math.abs(dogSelection.endY - dogSelection.startY),
            }} />}
          </div>}
          {!connected && <div className="video-placeholder"><div className="camera-lens">◉</div><h2>The room is quiet for now</h2><p>Start camera mode on the other device using this room key.</p><button className="button button-light" onClick={connect}>Try again</button></div>}
          {showDogTargetControls && <div className="dog-target-controls">
            <button className={dogSelectionMode ? "active" : ""} onClick={() => { setDogSelection(null); setDogSelectionMode((current) => !current); }}>
              {dogAssistLabel}
            </button>
            {dogTrack?.targetMode === "owner_guided" && <button className="target-reset" onClick={() => { setDogSelectionMode(false); setDogSelection(null); void sendDogTarget(null); }}>Use auto detection</button>}
          </div>}
          {connected && <div className="camera-quick-controls">
            <button onClick={() => void flipCamera()}>↻ Flip</button>
            <button onClick={() => void togglePictureInPicture()}>▣ Float</button>
            {selectedCamera?.health?.torchSupported && <button className={selectedCamera.health.torchOn ? "active" : ""} onClick={() => void toggleTorch()}>✦ Light</button>}
          </div>}
          {connected && <div className="zoom-control"><span>{zoomMode === "camera" ? "Camera zoom" : zoomMode === "view" ? "View zoom" : "Checking zoom"}</span><div><button aria-label="Reset zoom" onClick={() => void setCameraZoom(1)}>1×</button><input aria-label="Camera zoom" type="range" min={zoomMinimum} max={zoomMaximum} step={zoomMode === "camera" ? zoomBounds.max > 4 ? 0.5 : 0.1 : 0.1} value={zoom} onChange={(event) => void setCameraZoom(Number(event.target.value))} disabled={zoomMode === "checking"} /><strong>{zoom.toFixed(1)}×</strong></div></div>}
          {connected && <div className="voice-control-stack">{remoteAudioAvailable ? <button className={`listen-room-button ${listening ? "listening" : ""}`} aria-pressed={listening} onClick={() => void toggleListening()}>{listening ? "♪ Room sound · On" : "♪ Room sound · Off"}</button> : cameraAudioStatus === "off" ? <button className={`room-audio-status room-audio-action ${roomSoundRequest === "sent" ? "sent" : ""}`} onClick={() => void requestRoomSound()} disabled={roomSoundRequest === "requesting"}>{roomSoundRequest === "requesting" ? "Requesting room sound…" : roomSoundRequest === "sent" ? "Allow sound on the camera device" : "Room audio is off · Enable"}</button> : <span className="room-audio-status">Checking room audio…</span>}<button className={`talk-room-button ${talking ? "talking" : ""}`} onClick={() => void toggleTalking()} disabled={talkStatus === "requesting"}>{talking ? "● Talking · tap to stop" : talkStatus === "requesting" ? "Opening microphone…" : talkStatus === "blocked" ? "Retry microphone" : "◉ Talk to your pet"}</button></div>}
          <div className={`current-state ${state}`}><span /><div><small>Current observation</small><strong>{label}</strong><em>{sublabel}</em></div></div>
        </div>
        {error && <p className="error-banner">{error}</p>}
        <div className="session-bar">
          <div><small>Observed</small><strong>{sessionTime}</strong></div>
          <div className="session-kind-control" aria-label="Observation type">
            <button className={sessionKind === "quick_check" ? "selected" : ""} onClick={() => { setSessionKind("quick_check"); setTargetMinutes(10); }}>Quick check</button>
            <button className={sessionKind === "away_monitoring" ? "selected" : ""} onClick={() => { setSessionKind("away_monitoring"); setTargetMinutes(180); }}>Going out</button>
          </div>
          <label className="target-control"><small>Planned window</small><div className="target-input-row"><select value={customAwayWindow ? "custom" : targetMinutes} onChange={(event) => event.target.value === "custom" ? setTargetMinutes(customAwayHours * 60) : setTargetMinutes(Number(event.target.value))}>{durationOptions[sessionKind].map((minutes) => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}{sessionKind === "away_monitoring" && <option value="custom">4+ hr</option>}</select>{customAwayWindow && <label className="custom-hours"><input aria-label="Custom outing hours" type="number" min="5" max="12" step="1" value={customAwayHours} onChange={(event) => { const hours = Math.min(12, Math.max(5, Number(event.target.value) || 5)); setCustomAwayHours(hours); setTargetMinutes(hours * 60); }} /><span>hours</span></label>}</div></label>
          <button className="button button-dark finish-review-button" onClick={() => void finishSession(true)} disabled={summaryLoading}>{summaryLoading ? "Creating recap…" : "View recap so far"}</button>
        </div>
      </section>

      <aside className="timeline-panel">
        <div className="timeline-heading"><div><span className="eyebrow">Live activity</span><h2>What matters</h2></div>{events.length > 0 && <span className="event-count" aria-label={`${events.length} events`}>{events.length}</span>}</div>
        <section className="arrival-recap-card" aria-live="polite">
          <span className="eyebrow">Since your last check</span>
          {arrivalSummaryLoading ? (
            <p>Reviewing recent movement, sound events, and saved moments…</p>
          ) : hasArrivalActivity && arrivalSummary ? (
            <>
              <strong>{arrivalSummary.headline}</strong>
              <p>{arrivalSummary.behaviorSummary}</p>
              <button onClick={() => setSummary(arrivalSummary)}>Open full recap</button>
            </>
          ) : (
            <p>{connected ? "No new activity since you opened this page." : "Connect the camera to begin monitoring."}</p>
          )}
        </section>
        <section className="soundboard-card">
          <div className="soundboard-heading"><div><span className="eyebrow">Pet soundboard</span><strong>Familiar sounds, one tap away</strong></div><span>{selectedCamera?.name ?? "Choose a camera"}</span></div>
          <div className="soundboard-actions">
            {savedSounds.map((sound) => <div className="sound-button-group" key={sound.id}><div className="sound-button-wrap"><button disabled={!connected || soundBusy} onClick={() => void playSavedSound(sound)}>▶ {sound.label}</button><button className="sound-delete" aria-label={`Delete ${sound.label}`} onClick={() => void removeSound(sound.id)}>×</button></div><button className="sound-preview" type="button" onClick={() => void previewSavedSound(sound)}>Test here</button></div>)}
            {!savedSounds.some((sound) => sound.label === "No") && <button className={recordingSound === "No" ? "recording" : ""} onClick={() => void recordSound("No")}>{recordingSound === "No" ? "■ Stop & save" : "● Record “No”"}</button>}
            {!savedSounds.some((sound) => sound.label === "Good job") && <button className={recordingSound === "Good job" ? "recording" : ""} onClick={() => void recordSound("Good job")}>{recordingSound === "Good job" ? "■ Stop & save" : "● Record praise"}</button>}
            <button className={ambientPlaying ? "active" : ""} disabled={!connected} onClick={() => void toggleAmbient()}>{ambientPlaying ? "■ Stop quiet sound" : "♪ Play quiet ambient"}</button>
          </div>
          {(soundNotice || soundDelivery) && <div className={`sound-feedback ${soundDelivery?.status ?? "local"}`} role="status"><span aria-hidden="true">{soundDelivery?.status === "blocked" ? "!" : soundDelivery?.status === "finished" ? "✓" : "•"}</span>{soundDelivery?.message ?? soundNotice}</div>}
          <small>Custom voice buttons stay on this owner device and are sent only to the selected camera.</small>
        </section>
        <div className="timeline-list">{events.length === 0 ? <div className="empty-timeline"><span>◌</span><div><strong>No activity detected yet</strong><p>Pawly will show pet movement, sound, and visibility changes here. Camera movement is ignored.</p></div></div> : events.map((event) => <article className="timeline-event" key={event.id}><div className={`event-symbol ${event.type}`}>{eventSymbol(event.type)}</div><div><strong>{event.message}</strong><span>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · {event.deviceName ? `${event.deviceName} · ` : ""}{Math.round(event.confidence * 100)}% confidence</span>{event.motionScore != null && <small>Pet movement score {Math.round(event.motionScore * 100)}%</small>}</div></article>)}</div>
        <section className="saved-clips-section"><div className="saved-clips-heading"><div><strong>Recent activity replay</strong><span>12-second detected moments · this device</span></div><b>{clips.length}</b></div>{clipReceiveProgress != null && <div className="clip-progress"><span style={{ width: `${Math.round(clipReceiveProgress * 100)}%` }} /></div>}<div className="saved-clips-list">{clips.length === 0 ? <p>Movement or sustained sound can automatically save a short replay here.</p> : clips.slice(0, 4).map((clip) => <SavedClipCard key={clip.id} clip={clip} onDelete={(id) => void removeClip(id)} />)}</div></section>
        <div className="ai-card"><div><span className="ai-spark">✦</span><div><strong>AI recap is included</strong><p>“View recap so far” summarizes timestamped events without stopping monitoring. Video clips and the live feed are never sent to the model.</p></div></div></div>
      </aside>
    </div>
    {settingsOpen && (
      <div className="room-settings-backdrop" onClick={() => setSettingsOpen(false)}>
        <aside className="room-settings-drawer" role="dialog" aria-modal="true" aria-labelledby="room-settings-title" onClick={(event) => event.stopPropagation()}>
          <div className="room-settings-header">
            <div><span className="eyebrow">Pawly controls</span><h2 id="room-settings-title">Room & devices</h2></div>
            <button type="button" aria-label="Close room settings" onClick={() => setSettingsOpen(false)}>×</button>
          </div>

          <section className="settings-card">
            <div className="settings-card-heading"><div><span className={`status-dot ${connected ? "live" : "connecting"}`} /><strong>Camera device</strong></div><span>{connected ? "Online" : "Offline"}</span></div>
            <p>{connected ? `${selectedCamera?.name ?? "Your camera"} is connected to this private room.` : "Open camera mode on your other device to reconnect."}</p>
            <button className="settings-action" type="button" onClick={() => void wakeIpadDisplay()} disabled={!connected}>{wakeSent ? "Display awake for 60 seconds" : "Wake camera display"}</button>
          </section>

          <section className="settings-card">
            <div className="settings-card-heading"><strong>Camera health</strong><span>{selectedCamera?.health?.connectionQuality?.replace(/^CONNECTION_QUALITY_/, "") ?? (connected ? "Checking" : "Offline")}</span></div>
            <div className="camera-health-grid">
              <span><b>Video</b>{selectedCamera?.health?.camera ? `${selectedCamera.health.width ?? "—"}×${selectedCamera.health.height ?? "—"}` : "Waiting"}</span>
              <span><b>Room mic</b>{selectedCamera?.health?.microphone ? "Working" : "Off"}</span>
              <span><b>Pet AI</b>{selectedCamera?.health?.detector ?? "Checking"}</span>
              <span><b>Lens</b>{selectedCamera?.health?.facingMode === "user" ? "Front" : "Back"}</span>
            </div>
            <button className="settings-action" type="button" onClick={() => void sendCommand({ type: "request_status" })} disabled={!connected}>Refresh device check</button>
          </section>

          <section className="settings-card">
            <div className="settings-card-heading"><strong>Encrypted access</strong><span>Protected</span></div>
            <p>Only your signed-in owner account and cameras you explicitly pair can enter. Live media and room events are end-to-end encrypted.</p>
            <div className="security-mini-list"><span>◆ One-time camera pairing</span><span>◆ Short-lived connection tokens</span><span>◆ Revoke devices instantly</span></div>
            <Link className="settings-text-link" href="/setup">Manage approved devices →</Link>
          </section>

          <section className="settings-card">
            <div className="settings-card-heading"><strong>Activity notifications</strong><span>{notificationPermission === "granted" ? "On" : notificationPermission === "denied" ? "Blocked" : notificationPermission === "unsupported" ? "Unavailable" : "Off"}</span></div>
            <p>Get a browser notification for meaningful movement, sound, or when your pet leaves view.</p>
            {notificationPermission === "default" && <button className="settings-action" type="button" onClick={() => void requestNotifications()}>Enable notifications</button>}
            {notificationPermission === "denied" && <p className="settings-permission-note">Notifications are blocked. Open this site’s browser permissions to allow them.</p>}
          </section>

          <section className="settings-danger-zone">
            {!showEndConfirm ? (
              <button type="button" onClick={() => setShowEndConfirm(true)} disabled={!connected}>End monitoring</button>
            ) : (
              <div className="end-monitoring-confirm" role="alert">
                <strong>Stop the camera session?</strong>
                <p>This ends monitoring on the camera device and opens your final recap.</p>
                <div><button type="button" onClick={() => setShowEndConfirm(false)}>Keep monitoring</button><button className="confirm-stop" type="button" onClick={() => void endMonitoring()} disabled={endingMonitoring}>{endingMonitoring ? "Stopping…" : "End monitoring"}</button></div>
              </div>
            )}
          </section>
        </aside>
      </div>
    )}
    {summary && (
      <div className={`modal-backdrop ${recapExpanded ? "recap-expanded" : ""}`} onClick={() => { setSummary(null); setRecapExpanded(false); }}>
        <section className={`summary-modal ${recapExpanded ? "expanded" : ""}`} onClick={(event) => event.stopPropagation()}>
          <div className="recap-window-actions"><button aria-label={recapExpanded ? "Restore recap size" : "Expand recap"} onClick={() => setRecapExpanded((current) => !current)}>{recapExpanded ? "↙" : "↗"}</button><button aria-label="Close recap" onClick={() => { setSummary(null); setRecapExpanded(false); }}>×</button></div>
          <span className="eyebrow">Observation review · {summary.source === "openai" ? "AI assisted" : "on-device rules"}</span>
          <h2>{summary.headline}</h2>
          <p className="behavior-summary">{summary.behaviorSummary}</p>
          {summary.notablePatterns.length > 0 && <ul className="pattern-list">{summary.notablePatterns.map((pattern) => <li key={pattern}>{pattern}</li>)}</ul>}
          <div className="summary-stats">
            <div><strong>{compactDuration(summary.observedSeconds ?? summary.observedMinutes * 60)}</strong><span>observed</span></div>
            <div><strong>{summary.firstActivitySecond == null ? "—" : compactDuration(summary.firstActivitySecond)}</strong><span>first activity</span></div>
            <div><strong>{summary.activeEvents}</strong><span>active changes</span></div>
            <div><strong>{compactDuration(summary.longestCalmMinutes * 60)}</strong><span>longest calm</span></div>
          </div>
          <div className="next-step"><small>What to do with this result</small><p>{summary.nextStep}</p></div>
          {summary.estimatedAiCostUsd != null && <p className="cost-note">Estimated model cost for this summary: ${summary.estimatedAiCostUsd.toFixed(5)}</p>}
          <button className="button button-primary full" onClick={() => { setEvents([]); setStartedAt(Date.now()); setSummary(null); }}>Start a fresh observation</button>
        </section>
      </div>
    )}
  </main>;
}

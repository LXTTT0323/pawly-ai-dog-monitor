"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "./brand";
import { clipFileName, deleteClip, listSavedClips, parseClipFileName, saveClip, type SavedClip } from "@/lib/clip-store";
import type { PawlyEvent, SessionKind, SessionSummary } from "@/lib/domain";
import type { DogBox } from "@/lib/dog-detector";
import { deriveState, summarizeWithRules } from "@/lib/session-engine";

interface Props { roomCode: string; }
type ZoomMode = "checking" | "camera" | "view";

const stateCopy = { calm: ["Calm", "The room has settled"], active: ["Active", "A sustained change was noticed"], out_of_view: ["Out of view", "The camera is still online"], unavailable: ["Unavailable", "The camera needs attention"], connecting: ["Connecting", "Looking for the camera"] } as const;
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
  events: PawlyEvent[],
  startedAt: number,
  targetMinutes: number,
  sessionKind: SessionKind,
) {
  const fallback = summarizeWithRules(events, startedAt, Date.now(), targetMinutes, sessionKind);
  try {
    const response = await fetch("/api/session-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dogName: "Your puppy", sessionKind, targetMinutes, startedAt, events }),
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
  if (type.includes("camera")) return "!";
  return "✓";
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
  const [dogTrack, setDogTrack] = useState<{ visible: boolean; confidence: number; box: DogBox | null } | null>(null);
  const reviewSinceRef = useRef(Date.now() - 4 * 60 * 60 * 1000);
  const autoSummaryRequestedRef = useRef(false);
  const sessionSettingsRef = useRef({ sessionKind, targetMinutes });
  const state = deriveState(events, connected);

  const refreshClips = useCallback(async () => {
    setClips(await listSavedClips(roomCode));
  }, [roomCode]);

  useEffect(() => { void refreshClips(); }, [refreshClips]);
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
      const response = await fetch("/api/livekit-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomCode, role: "owner" }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not join room");
      const { token, serverUrl } = await response.json();
      const room = new Room({ adaptiveStream: true, disconnectOnPageLeave: true });
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
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current);
        if (track.kind === Track.Kind.Audio && audioRef.current) {
          audioRef.current.muted = true;
          track.attach(audioRef.current);
          audioRef.current.pause();
          setRemoteAudioAvailable(true);
          setCameraAudioStatus("on");
          setListening(false);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === Track.Kind.Audio) { setRemoteAudioAvailable(false); setListening(false); setCameraAudioStatus("off"); } track.detach(); });
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
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
              void requestSessionSummary(recent, recapStartedAt, settings.targetMinutes, settings.sessionKind)
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
          try {
            const reading = JSON.parse(new TextDecoder().decode(payload)) as { visible?: boolean; confidence?: number; box?: DogBox | null };
            setDogTrack({
              visible: reading.visible === true,
              confidence: Number.isFinite(reading.confidence) ? reading.confidence ?? 0 : 0,
              box: reading.box ?? null,
            });
          } catch { /* ignore malformed tracking data */ }
          return;
        }
        if (topic === "pawly-camera-status") {
          try {
            const status = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; supported?: boolean; zoom?: number; min?: number; max?: number; enabled?: boolean };
            if (status.type === "zoom_status") {
              setZoomMode(status.supported ? "camera" : "view");
              if (status.supported && Number.isFinite(status.zoom)) setZoom(status.zoom ?? 1);
              if (status.supported && Number.isFinite(status.min) && Number.isFinite(status.max)) setZoomBounds({ min: status.min ?? 1, max: status.max ?? 3 });
            }
            if (status.type === "audio_status") {
              setCameraAudioStatus(status.enabled ? "on" : "off");
              if (status.enabled) setRoomSoundRequest("idle");
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
      room.on(RoomEvent.ParticipantConnected, () => { setConnected(true); setZoomMode("checking"); void requestSavedClips(); void requestEventHistory(); void requestCameraZoom(); });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        const cameraStillOnline = room.remoteParticipants.size > 0;
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
      room.on(RoomEvent.Disconnected, () => { setConnected(false); setTalking(false); setRemoteAudioAvailable(false); setListening(false); setCameraAudioStatus("unknown"); setDogTrack(null); });
      await room.connect(serverUrl, token);
      setConnected(room.remoteParticipants.size > 0);
      if (room.remoteParticipants.size > 0) { void requestSavedClips(); void requestEventHistory(); void requestCameraZoom(); }
      for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) {
        if (publication.track?.kind === Track.Kind.Video && videoRef.current) publication.track.attach(videoRef.current);
        if (publication.track?.kind === Track.Kind.Audio && audioRef.current) {
          audioRef.current.muted = true;
          publication.track.attach(audioRef.current);
          audioRef.current.pause();
          setRemoteAudioAvailable(true);
          setCameraAudioStatus("on");
          setListening(false);
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join room"); }
  }, [refreshClips, roomCode]);

  useEffect(() => {
    // Connection state is synchronized from the external LiveKit room.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void connect();
    return () => { void roomRef.current?.disconnect(); };
  }, [connect]);
  useEffect(() => {
    if (!connected || zoomMode !== "checking") return;
    const timer = window.setTimeout(() => setZoomMode((current) => current === "checking" ? "view" : current), 2_500);
    return () => window.clearTimeout(timer);
  }, [connected, zoomMode]);
  useEffect(() => { const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000); return () => window.clearInterval(timer); }, [startedAt]);

  const sessionTime = useMemo(() => `${String(Math.floor(elapsed / 60000)).padStart(2, "0")}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}`, [elapsed]);
  const [label, sublabel] = stateCopy[state];

  const finishSession = async (useAi: boolean) => {
    const rulesSummary = summarizeWithRules(events, startedAt, Date.now(), targetMinutes, sessionKind);
    if (!useAi) { setSummary(rulesSummary); return; }
    setSummaryLoading(true);
    try {
      setSummary(await requestSessionSummary(events, startedAt, targetMinutes, sessionKind));
    } catch { setSummary(rulesSummary); } finally { setSummaryLoading(false); }
  };

  const requestNotifications = async () => { if ("Notification" in window) await Notification.requestPermission(); };

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
      setTalking(false);
      setTalkStatus("ready");
      return;
    }
    setTalkStatus("requesting");
    try {
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
    const room = roomRef.current;
    if (!room || !connected) return;
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: "wake_display" })),
      { reliable: true, topic: "pawly-command" },
    );
    setWakeSent(true);
    window.setTimeout(() => setWakeSent(false), 2500);
  };

  const requestRoomSound = async () => {
    const room = roomRef.current;
    if (!room || !connected) return;
    setRoomSoundRequest("requesting");
    try {
      const encoder = new TextEncoder();
      await room.localParticipant.publishData(
        encoder.encode(JSON.stringify({ type: "wake_display" })),
        { reliable: true, topic: "pawly-command" },
      );
      await room.localParticipant.publishData(
        encoder.encode(JSON.stringify({ type: "enable_audio" })),
        { reliable: true, topic: "pawly-command" },
      );
      setRoomSoundRequest("sent");
    } catch {
      setRoomSoundRequest("idle");
      setError("Could not reach the camera. Check that the iPad is still online.");
    }
  };

  const changeZoom = async (direction: -1 | 1) => {
    const lower = zoomMode === "camera" ? zoomBounds.min : 1;
    const upper = zoomMode === "camera" ? zoomBounds.max : 3;
    const nextZoom = Math.min(upper, Math.max(lower, Math.round((zoom + direction * 0.5) * 10) / 10));
    setZoom(nextZoom);
    const room = roomRef.current;
    if (!room || !connected) return;
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: "set_zoom", zoom: nextZoom })),
      { reliable: true, topic: "pawly-command" },
    );
  };

  const removeClip = async (id: string) => {
    await deleteClip(id);
    await refreshClips();
  };

  const customAwayWindow = sessionKind === "away_monitoring" && targetMinutes > 240;

  return <main className="dashboard-page">
    <nav className="dashboard-nav"><Brand /><div className="dashboard-nav-actions"><button className="icon-button" onClick={requestNotifications} title="Enable notifications">♢</button><Link className="button button-small button-ghost" href="/setup">Room settings</Link></div></nav>
    <div className="dashboard-grid">
      <section className="live-panel">
        <div className="panel-title"><div><span className={`status-dot ${connected ? "live" : "connecting"}`} /><span>{connected ? "Camera online" : "Waiting for camera"}</span></div><code>{roomCode}</code></div>
        <div className="owner-video">
          <video ref={videoRef} autoPlay playsInline style={{ transform: zoomMode === "camera" ? "scale(1)" : `scale(${zoom})` }} />
          <audio ref={audioRef} playsInline />
          {connected && dogTrack?.visible && dogTrack.box && (
            <div className="dog-track-layer" style={{ transform: zoomMode === "camera" ? "scale(1)" : `scale(${zoom})` }}>
              <div className="dog-detection-box" style={coverBoxStyle(dogTrack.box, videoRef.current)}>
                <span>Dog · {Math.round(dogTrack.confidence * 100)}%</span>
              </div>
            </div>
          )}
          {!connected && <div className="video-placeholder"><div className="camera-lens">◉</div><h2>The room is quiet for now</h2><p>Start camera mode on the other device using this room key.</p><button className="button button-light" onClick={connect}>Try again</button></div>}
          {connected && <div className="zoom-control"><span>{zoomMode === "camera" ? "Camera zoom" : zoomMode === "view" ? "View zoom" : "Checking zoom"}</span><div><button aria-label="Zoom out" onClick={() => void changeZoom(-1)} disabled={zoom <= (zoomMode === "camera" ? zoomBounds.min : 1)}>−</button><strong>{zoom.toFixed(1)}×</strong><button aria-label="Zoom in" onClick={() => void changeZoom(1)} disabled={zoom >= (zoomMode === "camera" ? zoomBounds.max : 3)}>+</button></div></div>}
          {connected && <div className="voice-control-stack">{remoteAudioAvailable ? <button className={`listen-room-button ${listening ? "listening" : ""}`} aria-pressed={listening} onClick={() => void toggleListening()}>{listening ? "♪ Room sound · On" : "♪ Room sound · Off"}</button> : cameraAudioStatus === "off" ? <button className={`room-audio-status room-audio-action ${roomSoundRequest === "sent" ? "sent" : ""}`} onClick={() => void requestRoomSound()} disabled={roomSoundRequest === "requesting"}>{roomSoundRequest === "requesting" ? "Requesting room sound…" : roomSoundRequest === "sent" ? "Check the iPad to allow sound" : "Turn on room sound"}</button> : <span className="room-audio-status">Waiting for room sound…</span>}<button className={`talk-room-button ${talking ? "talking" : ""}`} onClick={() => void toggleTalking()} disabled={talkStatus === "requesting"}>{talking ? "● Talking · tap to stop" : talkStatus === "requesting" ? "Opening microphone…" : talkStatus === "blocked" ? "Retry microphone" : "◉ Talk to your dog"}</button></div>}
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
          <button className="button button-ghost wake-ipad-button" onClick={() => void wakeIpadDisplay()} disabled={!connected}>{wakeSent ? "Display awake for 60s" : "Wake camera display"}</button><button className="button button-dark" onClick={() => void finishSession(false)}>Finish & review</button>
        </div>
      </section>

      <aside className="timeline-panel">
        <div className="timeline-heading"><div><span className="eyebrow">Live timeline</span><h2>What matters</h2></div><span className="event-count">{events.length}</span></div>
        <section className="arrival-recap-card" aria-live="polite">
          <span className="eyebrow">Since your last check</span>
          {arrivalSummaryLoading ? (
            <p>Reviewing recent movement, sound events, and saved moments…</p>
          ) : arrivalSummary ? (
            <>
              <strong>{arrivalSummary.headline}</strong>
              <p>{arrivalSummary.behaviorSummary}</p>
              <button onClick={() => setSummary(arrivalSummary)}>Open full recap</button>
            </>
          ) : (
            <p>Your latest activity recap will appear when the camera connects.</p>
          )}
        </section>
        <div className="timeline-list">{events.length === 0 ? <div className="empty-timeline"><span>◌</span><p>Dog visibility, sustained sound, and tracked dog movement will appear here. Moving the camera itself is ignored.</p></div> : events.map((event) => <article className="timeline-event" key={event.id}><div className={`event-symbol ${event.type}`}>{eventSymbol(event.type)}</div><div><strong>{event.message}</strong><span>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · {Math.round(event.confidence * 100)}% confidence</span>{event.motionScore != null && <small>Dog movement score {Math.round(event.motionScore * 100)}%</small>}</div></article>)}</div>
        <section className="saved-clips-section"><div className="saved-clips-heading"><div><strong>Recent activity replay</strong><span>12-second detected moments · this device</span></div><b>{clips.length}</b></div>{clipReceiveProgress != null && <div className="clip-progress"><span style={{ width: `${Math.round(clipReceiveProgress * 100)}%` }} /></div>}<div className="saved-clips-list">{clips.length === 0 ? <p>Movement or sustained sound can automatically save a short replay here.</p> : clips.slice(0, 4).map((clip) => <SavedClipCard key={clip.id} clip={clip} onDelete={(id) => void removeClip(id)} />)}</div></section>
        <div className="ai-card"><div><span className="ai-spark">✦</span><div><strong>AI behavior summary</strong><p>Uses timestamped event text only. Video clips and the live feed are never sent to the model.</p></div></div><button className="button button-ghost full" onClick={() => void finishSession(true)} disabled={summaryLoading}>{summaryLoading ? "Summarizing…" : "Summarize behavior"}</button></div>
      </aside>
    </div>
    {summary && <div className="modal-backdrop" onClick={() => setSummary(null)}><section className="summary-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSummary(null)}>×</button><span className="eyebrow">Observation review · {summary.source === "openai" ? "AI assisted" : "on-device rules"}</span><h2>{summary.headline}</h2><p className="behavior-summary">{summary.behaviorSummary}</p>{summary.notablePatterns.length > 0 && <ul className="pattern-list">{summary.notablePatterns.map((pattern) => <li key={pattern}>{pattern}</li>)}</ul>}<div className="summary-stats"><div><strong>{summary.observedMinutes}</strong><span>minutes observed</span></div><div><strong>{summary.firstActivityMinute ?? "—"}</strong><span>first activity minute</span></div><div><strong>{summary.activeEvents}</strong><span>active changes</span></div><div><strong>{summary.longestCalmMinutes}</strong><span>longest calm</span></div></div><div className="next-step"><small>What to do with this result</small><p>{summary.nextStep}</p></div>{summary.estimatedAiCostUsd != null && <p className="cost-note">Estimated model cost for this summary: ${summary.estimatedAiCostUsd.toFixed(5)}</p>}<button className="button button-primary full" onClick={() => { setEvents([]); setStartedAt(Date.now()); setSummary(null); }}>Start a fresh observation</button></section></div>}
  </main>;
}

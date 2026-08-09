"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "./brand";
import { createEncryptedRoom, participantRole } from "@/lib/livekit-security";

export function GuestRoom({ roomCode }: { roomCode: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState("Connecting to the private room…");
  const [error, setError] = useState("");
  const [hasVideo, setHasVideo] = useState(false);

  const connect = useCallback(async () => {
    setError(""); setStatus("Connecting to the private room…");
    try {
      const response = await fetch("/api/livekit-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomCode, mode: "guest" }) });
      const data = await response.json() as { token?: string; serverUrl?: string; e2eeKey?: string; error?: string };
      if (!response.ok || !data.token || !data.serverUrl || !data.e2eeKey) throw new Error(data.error ?? "Could not join this room");
      const encrypted = await createEncryptedRoom(data.e2eeKey, { adaptiveStream: true, disconnectOnPageLeave: true });
      const room = encrypted.room;
      const attach = (track: Track) => {
        if (track.kind === Track.Kind.Video && videoRef.current) { track.attach(videoRef.current); setHasVideo(true); setStatus("Camera live"); }
        if (track.kind === Track.Kind.Audio && audioRef.current) track.attach(audioRef.current);
      };
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => { if (participantRole(participant) === "camera") attach(track); });
      room.on(RoomEvent.TrackUnsubscribed, (track) => { track.detach(); if (track.kind === Track.Kind.Video) { setHasVideo(false); setStatus("Camera is offline"); } });
      await room.connect(data.serverUrl, data.token);
      room.remoteParticipants.forEach((participant) => {
        if (participantRole(participant) !== "camera") return;
        participant.trackPublications.forEach((publication) => { if (publication.track) attach(publication.track); });
      });
      if (!hasVideo) setStatus("Waiting for the camera…");
      return () => { room.disconnect(); encrypted.disposeEncryption(); };
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join this room"); return undefined; }
  }, [roomCode, hasVideo]);

  useEffect(() => { let dispose: (() => void) | undefined; void connect().then((next) => { dispose = next; }); return () => dispose?.(); }, [connect]);
  return <main className="guest-room-page"><nav className="nav shell"><Brand /><span className="guest-label">Guest view · read only</span></nav><section className="guest-room-shell shell"><span className="eyebrow"><span className="pulse-dot" /> Private guest access</span><h1>A quiet look<br /><em>from afar.</em></h1><p>Live video is end-to-end encrypted. You can watch this room, but cannot control the camera or change its settings.</p><div className="guest-video"><video ref={videoRef} autoPlay playsInline muted={!audioRef.current} /><audio ref={audioRef} autoPlay />{!hasVideo && <div className="guest-video-status">{status}</div>}</div>{error && <div className="guest-access-error">{error}<button type="button" onClick={() => void connect()}>Try again</button></div>}<Link className="text-link" href="/">Return to Pawly</Link></section></main>;
}

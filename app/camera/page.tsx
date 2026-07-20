"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CameraStation } from "@/components/camera-station";
import { isRoomCode } from "@/lib/domain";

export default function CameraPage() {
  const [roomCode, setRoomCode] = useState("");
  // The room capability is provided by the browser URL after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRoomCode(new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? ""); }, []);
  if (!roomCode) return <main className="loading-page">Opening camera…</main>;
  if (!isRoomCode(roomCode)) return <main className="loading-page"><h1>Invalid room key</h1><Link href="/setup">Return to setup</Link></main>;
  return <main className="camera-page"><CameraStation roomCode={roomCode} /></main>;
}

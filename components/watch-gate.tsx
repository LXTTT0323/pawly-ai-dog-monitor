"use client";

import { useEffect, useState } from "react";
import { GuestRoom } from "@/components/guest-room";
import { OwnerRoom } from "@/components/owner-room";

type Role = "loading" | "owner" | "guest" | "error";

export function WatchGate({ roomCode }: { roomCode: string }) {
  const [role, setRole] = useState<Role>("loading");

  useEffect(() => {
    let active = true;
    void fetch("/api/rooms", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not verify room access");
        const data = await response.json() as { room?: { code?: string } | null };
        if (active) setRole(data.room?.code === roomCode ? "owner" : "guest");
      })
      .catch(() => { if (active) setRole("error"); });
    return () => { active = false; };
  }, [roomCode]);

  if (role === "owner") return <OwnerRoom roomCode={roomCode} />;
  if (role === "guest") return <GuestRoom roomCode={roomCode} />;
  if (role === "error") return <main className="loading-page"><h1>Room unavailable</h1><p>Pawly could not verify access. Reload this page or return to setup.</p><a href="/setup">Return to Pawly</a></main>;
  return <main className="loading-page"><h1>Opening your private room…</h1><p>Verifying secure access.</p></main>;
}

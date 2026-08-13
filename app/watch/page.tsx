import Link from "next/link";
import { requirePawlyUser } from "@/lib/auth";
import { isRoomCode } from "@/lib/domain";
import { WatchGate } from "@/components/watch-gate";

export const dynamic = "force-dynamic";

export default async function WatchPage({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  const params = await searchParams;
  const roomCode = params.room?.toUpperCase() ?? "";
  await requirePawlyUser(`/watch${roomCode ? `?room=${encodeURIComponent(roomCode)}` : ""}`);
  if (!isRoomCode(roomCode)) return <main className="loading-page"><h1>Invalid room</h1><Link href="/setup">Return to your rooms</Link></main>;
  return <WatchGate roomCode={roomCode} />;
}

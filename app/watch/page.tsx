import Link from "next/link";
import { OwnerRoom } from "@/components/owner-room";
import { GuestRoom } from "@/components/guest-room";
import { requirePawlyUser } from "@/lib/auth";
import { isRoomCode } from "@/lib/domain";
import { getGuestAccess, getRoomByCode } from "@/lib/security-store";

export const dynamic = "force-dynamic";

export default async function WatchPage({ searchParams }: { searchParams: Promise<{ room?: string; guest?: string }> }) {
  const params = await searchParams;
  const roomCode = params.room?.toUpperCase() ?? "";
  const user = await requirePawlyUser(`/watch${roomCode ? `?room=${encodeURIComponent(roomCode)}` : ""}`);
  if (!isRoomCode(roomCode)) return <main className="loading-page"><h1>Invalid room</h1><Link href="/setup">Return to your rooms</Link></main>;
  const room = await getRoomByCode(roomCode);
  if (!room) return <main className="loading-page"><h1>Room unavailable</h1><Link href="/setup">Return to Pawly</Link></main>;
  if (room.ownerEmail === user.email) return <OwnerRoom roomCode={roomCode} />;
  const guestAccess = await getGuestAccess(roomCode, user.id);
  if (guestAccess) return <GuestRoom roomCode={roomCode} />;
  return <main className="loading-page"><h1>Private room</h1><p>This account has not been granted access to this room.</p><Link href="/">Return to Pawly</Link></main>;
}

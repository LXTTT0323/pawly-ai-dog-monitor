import { requirePawlyUser } from "@/lib/auth";
import { GuestRedeem } from "@/components/guest-redeem";

export const dynamic = "force-dynamic";
export default async function GuestPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  await requirePawlyUser(`/guest${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  if (token.length < 32) return <main className="loading-page"><h1>Invalid invitation</h1><p>Ask the room owner for a new guest link.</p></main>;
  return <GuestRedeem token={token} />;
}

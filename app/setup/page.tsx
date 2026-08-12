import { requirePawlyUser, signOutPath } from "@/lib/auth";
import { SetupClient } from "@/components/setup-client";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const user = await requirePawlyUser("/setup");
  return <SetupClient user={user} signOutUrl={signOutPath("/")} />;
}

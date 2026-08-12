import Link from "next/link";
import { Brand } from "@/components/brand";
import { LoginCard } from "@/components/login-card";
import { getPawlyUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const nextPath = safeNext(params.next);
  const user = await getPawlyUser();

  return <main className="login-page">
    <nav className="nav shell"><Brand /><Link className="text-link" href="/">Back to Pawly</Link></nav>
    <section className="login-shell shell">
      <div className="login-story">
        <span className="eyebrow">One account · every camera</span>
        <h2>Your pets stay<br /><em>connected to you.</em></h2>
        <p>Use the same account on your phone, iPad, or computer. Previously trusted cameras reconnect without daily pairing links.</p>
        <div className="login-promises"><span>Private room ownership</span><span>Trusted device controls</span><span>Secure email sign-in</span></div>
      </div>
      {user ? <div className="login-card login-already"><span className="eyebrow">Already signed in</span><h1>Continue to Pawly.</h1><p>You are signed in as {user.email}.</p><Link className="button button-primary" href={nextPath}>Open my Pawly</Link></div> : <LoginCard configured={isSupabaseConfigured()} nextPath={nextPath} initialError={params.error === "expired_link" ? "That sign-in link is no longer valid. Request a new one below." : ""} />}
    </section>
  </main>;
}

function safeNext(value?: string) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/setup";
  return value;
}

import Link from "next/link";
import { Brand } from "@/components/brand";

export const dynamic = "force-dynamic";

type OwnerAccessPageProps = {
  searchParams: Promise<{ error?: string; return_to?: string }>;
};

export default async function OwnerAccessPage({ searchParams }: OwnerAccessPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.return_to);

  return (
    <main className="owner-access-page">
      <nav className="nav shell">
        <Brand />
        <Link className="text-link owner-access-home" href="/">Back to Pawly</Link>
      </nav>

      <section className="owner-access-shell shell">
        <div className="owner-access-copy">
          <span className="eyebrow"><span className="pulse-dot" /> Private beta access</span>
          <h1>Your room stays<br /><em>yours.</em></h1>
          <p>
            Pawly protects setup, camera pairing, and live viewing before anything can reach your room.
            Enter the owner key from your private invite once on this browser.
          </p>
          <div className="owner-access-promises" aria-label="How Pawly access works">
            <span><b>1</b> This browser stays authorized for 180 days.</span>
            <span><b>2</b> Camera devices use separate, one-time pairing links.</span>
            <span><b>3</b> A copied room URL alone cannot open your live feed.</span>
          </div>
        </div>

        <div className="owner-access-card">
          <span className="owner-access-lock" aria-hidden="true">◎</span>
          <p className="eyebrow">Owner verification</p>
          <h2>Continue to your setup</h2>
          <p className="owner-access-help">
            Paste the private owner access key you received. You only need to do this once per browser.
          </p>

          {params.error === "invalid" ? (
            <p className="owner-access-error" role="alert">
              That key did not match this Pawly beta. Check that the complete key was pasted and try again.
            </p>
          ) : null}

          <form action="/vercel-access" method="get" className="owner-access-form">
            <input type="hidden" name="return_to" value={returnTo} />
            <label htmlFor="owner-key">Owner access key</label>
            <input
              id="owner-key"
              name="key"
              type="password"
              autoComplete="current-password"
              placeholder="Paste your private key"
              required
            />
            <button className="button button-primary" type="submit">
              Unlock Pawly setup <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="owner-access-note">Your key is verified securely and is never shown inside the app.</p>
        </div>
      </section>
    </main>
  );
}

function safeReturnTo(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/setup";
  return value;
}

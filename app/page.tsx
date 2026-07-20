import Link from "next/link";
import { Brand } from "@/components/brand";

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <Brand />
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
          <Link className="button button-small button-ghost" href="/setup">Open beta</Link>
        </div>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <span className="eyebrow"><span className="pulse-dot" /> Private beta · use the iPad you own</span>
          <h1>Leaving is hard.<br /><em>Learning</em> can be gentle.</h1>
          <p className="hero-lede">
            Pawly turns an old iPad into a calm, privacy-first puppy coach. See the room live,
            notice meaningful changes, and build alone time one small win at a time.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/setup">Set up my iPad <span>→</span></Link>
            <a className="text-link" href="#how">See how it works</a>
          </div>
          <p className="microcopy">No new camera. No continuous cloud recording. AI review is optional.</p>
        </div>

        <div className="hero-visual" aria-label="Pawly monitoring preview">
          <div className="orb orb-one" /><div className="orb orb-two" />
          <div className="device-card">
            <div className="device-top"><span>Joey&apos;s room</span><span className="live-pill">● LIVE</span></div>
            <div className="camera-scene">
              <div className="window-light" />
              <div className="rug" />
              <div className="dog-shape"><span className="dog-ear left" /><span className="dog-ear right" /><span className="dog-body" /></div>
              <div className="calm-label"><span>○</span><div><strong>Calm</strong><small>for 08:42</small></div></div>
            </div>
            <div className="device-stats">
              <div><small>Today</small><strong>3 sessions</strong></div>
              <div><small>Longest calm</small><strong>12 min</strong></div>
              <div className="trend"><small>7-day trend</small><strong>↗ 18%</strong></div>
            </div>
          </div>
          <div className="floating-note"><span>✓</span><div><strong>A small win</strong><small>Joey settled after 38 seconds.</small></div></div>
        </div>
      </section>

      <section className="trust-strip">
        <div className="shell trust-grid">
          <p>Built around positive, gradual practice</p>
          <div><strong>Live first</strong><span>Video isn&apos;t stored by default</span></div>
          <div><strong>Quiet by design</strong><span>Meaningful events, not every movement</span></div>
          <div><strong>Honest AI</strong><span>Observations, never a diagnosis</span></div>
        </div>
      </section>

      <section id="how" className="section shell">
        <span className="eyebrow">A calmer loop</span>
        <div className="section-heading"><h2>Not another pet camera.<br />A practice you can see improving.</h2><p>Start with a short session. Pawly watches for sustained changes, keeps the noisy moments in context, and gives you one conservative next step.</p></div>
        <div className="steps-grid">
          <article><span className="step-number">01</span><div className="step-icon">▣</div><h3>Place your iPad</h3><p>Open camera mode, prop it up, plug it in, and keep the room in view.</p></article>
          <article><span className="step-number">02</span><div className="step-icon">◌</div><h3>Practice briefly</h3><p>Leave for a realistic, gentle interval while Pawly tracks calm and activity.</p></article>
          <article><span className="step-number">03</span><div className="step-icon">↗</div><h3>Build from evidence</h3><p>Review the session and increase only when the previous step looked comfortable.</p></article>
        </div>
      </section>

      <section id="privacy" className="privacy-section">
        <div className="shell privacy-card"><div><span className="eyebrow light">A camera belongs to your home</span><h2>Private by default,<br />useful by choice.</h2></div><div className="privacy-list"><p><span>01</span> Live video travels through an encrypted real-time room.</p><p><span>02</span> The beta stores no continuous video.</p><p><span>03</span> Optional AI summaries use small event descriptions, not the live stream.</p></div></div>
      </section>

      <footer className="footer shell"><Brand /><p>Gentle technology for better days together.</p><Link href="/setup">Start private beta →</Link></footer>
    </main>
  );
}

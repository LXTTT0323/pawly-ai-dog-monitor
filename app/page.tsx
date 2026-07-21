import Link from "next/link";
import { Brand } from "@/components/brand";

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <Brand />
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#modes">Two ways to use it</a>
          <a href="#privacy">Privacy</a>
          <Link className="button button-small button-ghost" href="/setup">Open local beta</Link>
        </div>
      </nav>

      <section className="hero shell home-hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="pulse-dot" /> No new camera · use a screen you already own</span>
          <h1>See what happens<br /><em>after you leave.</em></h1>
          <p className="hero-lede">Pawly turns a spare phone, tablet, or computer into a private pet camera that notices when your dog is visible, when the room changes, and when sustained sound matters.</p>
          <div className="hero-actions"><Link className="button button-primary" href="/setup">Set up a spare device <span>→</span></Link><a className="text-link" href="#how">See the quiet AI</a></div>
          <p className="microcopy">Live when you want it. Local detection the rest of the time. No continuous recording.</p>
        </div>

        <div className="hero-visual" aria-label="Pawly real outing review preview">
          <div className="orb orb-one" /><div className="orb orb-two" />
          <div className="device-card outing-card">
            <div className="device-top"><span>Joey&apos;s room</span><span className="live-pill">● AI WATCHING</span></div>
            <div className="camera-scene"><div className="window-light" /><div className="rug" /><div className="dog-shape"><span className="dog-ear left" /><span className="dog-ear right" /><span className="dog-body" /></div><div className="calm-label"><span>●</span><div><strong>Dog visible</strong><small>92% confidence</small></div></div><div className="scene-sound">♪ Sound on</div></div>
            <div className="device-stats outing-stats"><div><small>Observed</small><strong>3 hr 12 min</strong></div><div><small>First activity</small><strong>42 min</strong></div><div className="trend"><small>Longest settled</small><strong>1 hr 18 min</strong></div></div>
          </div>
          <div className="floating-note outing-note"><span>✓</span><div><strong>Settled again</strong><small>After a 4-minute active period.</small></div></div>
        </div>
      </section>

      <section className="trust-strip"><div className="shell trust-grid trust-grid-four"><p>Useful now. Smarter over time.</p><div><strong>Any modern device</strong><span>Phone, tablet, laptop, or desktop</span></div><div><strong>Dog-aware</strong><span>Local presence and movement detection</span></div><div><strong>Sound by choice</strong><span>Enable, hear, or turn it off anytime</span></div></div></section>

      <section id="how" className="section shell">
        <span className="eyebrow">The simplest useful loop</span>
        <div className="section-heading"><h2>A room camera that<br />doesn&apos;t demand attention.</h2><p>Check the live stream whenever you want. When you do not, Pawly keeps a quiet timeline of dog visibility, sustained movement, sound, and camera health.</p></div>
        <div className="steps-grid"><article><span className="step-number">01</span><div className="step-icon">◎</div><h3>Place a spare screen</h3><p>Open camera mode, allow camera and sound, plug it in, and leave the page visible.</p></article><article><span className="step-number">02</span><div className="step-icon">◌</div><h3>Go live normally</h3><p>Run a quick check or monitor the real two-, three-, or four-hour outing already in your day.</p></article><article><span className="step-number">03</span><div className="step-icon">↗</div><h3>Review what changed</h3><p>See when activity began, how long settled periods lasted, and whether your dog returned to rest.</p></article></div>
      </section>

      <section id="modes" className="modes-section"><div className="shell modes-shell"><div className="modes-intro"><span className="eyebrow light">Built for real life</span><h2>Ten minutes<br />or the whole afternoon.</h2><p>Pawly does not force every dog into the same minute-by-minute course. Choose the window that matches what you are actually doing.</p></div><div className="mode-cards"><article><span className="mode-time">10–30 min</span><h3>Quick check</h3><p>Learn the room, camera angle, and your dog&apos;s first observable pattern.</p><ul><li>10, 15, 20, or 30 minutes</li><li>Useful baseline, not a diagnosis</li><li>Meaningful checkpoints, never +1 minute</li></ul></article><article className="featured-mode"><span className="mode-time">30 min–4 hr</span><h3>Going out</h3><p>Use Pawly for the grocery run, dinner, work block, or normal time away.</p><ul><li>Quiet event timeline</li><li>Live video and room sound on demand</li><li>Compare with a similar past outing</li></ul></article></div></div></section>

      <section className="section shell intelligence-section"><div className="intelligence-copy"><span className="eyebrow">AI that knows when to wake up</span><h2>Light on the device.<br />Clear in the result.</h2><p>Pawly starts with tiny local motion and audio checks. Dog detection wakes periodically and becomes more attentive only when the room changes. Large AI never watches the continuous stream.</p></div><div className="intelligence-flow" aria-label="Pawly adaptive analysis pipeline"><div><small>Always local</small><strong>Eco motion + sound gate</strong><span>Low-resolution, adaptive sampling</span></div><b>→</b><div><small>When useful</small><strong>Dog presence + location</strong><span>On-device object detection</span></div><b>→</b><div><small>What you see</small><strong>Meaningful episodes</strong><span>Timeline, comparison, review</span></div></div></section>

      <section id="privacy" className="privacy-section"><div className="shell privacy-card"><div><span className="eyebrow light">A camera belongs to your home</span><h2>Private by default,<br />useful by choice.</h2></div><div className="privacy-list"><p><span>01</span> Live camera and sound travel through an encrypted real-time room.</p><p><span>02</span> Dog, motion, and sound gating run on the camera device.</p><p><span>03</span> The beta stores no continuous footage and makes no medical diagnosis.</p></div></div></section>

      <footer className="footer shell"><Brand /><p>Understand the moments that matter. Ignore the rest.</p><Link href="/setup">Open local beta →</Link></footer>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/brand";

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <Brand />
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#modes">Ways to use it</a>
          <a href="#privacy">Privacy</a>
          <Link className="button button-small button-ghost" href="/setup">Try the beta</Link>
        </div>
      </nav>

      <section className="hero shell home-hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="pulse-dot" /> No new camera · use a screen you already own</span>
          <h1>See what happens<br /><em>after you leave.</em></h1>
          <p className="hero-lede">Pawly turns a spare phone, tablet, or computer into a private pet camera that follows your dog, notices meaningful movement and sound, and gives you a useful recap.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/setup">Set up a spare device <span aria-hidden="true">→</span></Link>
            <a className="text-link" href="#how">See how it works</a>
          </div>
          <p className="microcopy">Live when you want it. Local detection the rest of the time. No continuous recording.</p>
        </div>

        <div className="hero-visual" aria-label="Pawly real outing review preview">
          <div className="orb orb-one" /><div className="orb orb-two" />
          <div className="device-card outing-card">
            <div className="device-top"><span>Joey&apos;s room</span><span className="live-pill">● AI WATCHING</span></div>
            <div className="camera-scene">
              <Image className="hero-puppy-art" src="/pawly-german-shepherd-room.png" alt="A German Shepherd puppy resting calmly on a rug" fill sizes="(max-width: 600px) 90vw, 490px" priority />
              <div className="camera-scene-shade" />
              <div className="calm-label"><span>●</span><div><strong>Dog visible</strong><small>92% confidence</small></div></div>
              <div className="scene-sound">♪ Sound on</div>
            </div>
            <div className="device-stats outing-stats"><div><small>Observed</small><strong>3 hr 12 min</strong></div><div><small>First activity</small><strong>42 min</strong></div><div className="trend"><small>Longest settled</small><strong>1 hr 18 min</strong></div></div>
          </div>
          <div className="floating-note outing-note"><span>✓</span><div><strong>Settled again</strong><small>After a 4-minute active period.</small></div></div>
        </div>
      </section>

      <section className="trust-strip">
        <div className="shell trust-grid trust-grid-four">
          <p>Useful now. Smarter over time.</p>
          <div><strong>Any modern device</strong><span>Phone, tablet, laptop, or desktop</span></div>
          <div><strong>Dog-aware</strong><span>Local detection and continuous tracking</span></div>
          <div><strong>Two-way audio</strong><span>Listen or talk only when you choose</span></div>
        </div>
      </section>

      <section id="how" className="section shell">
        <span className="eyebrow">The simplest useful loop</span>
        <div className="section-heading">
          <h2>A room camera that<br />doesn&apos;t demand attention.</h2>
          <p>Check the live stream whenever you want. Pawly builds a quiet timeline, frames the dog it is tracking, and automatically saves a short moment when meaningful dog movement or sustained sound begins.</p>
        </div>
        <div className="steps-grid">
          <article><span className="step-number">01</span><div className="step-icon">◎</div><h3>Place a spare screen</h3><p>Open camera mode, allow the camera, plug it in, and leave the page visible. Room sound is optional.</p></article>
          <article><span className="step-number">02</span><div className="step-icon">●</div><h3>Go live normally</h3><p>Run a quick check or monitor a real two-, four-, or longer outing already in your day.</p></article>
          <article><span className="step-number">03</span><div className="step-icon">→</div><h3>Review what changed</h3><p>Replay saved moments, see when activity began, and get an evidence-based AI behavior recap when you return.</p></article>
        </div>
      </section>

      <section id="modes" className="modes-section">
        <div className="shell modes-shell">
          <div className="modes-intro"><span className="eyebrow light">Built for real life</span><h2>Ten minutes<br />or the whole afternoon.</h2><p>Pawly does not force every dog into the same minute-by-minute course. Choose the window that matches what you are actually doing.</p></div>
          <div className="mode-cards">
            <article><span className="mode-time">10–30 min</span><h3>Quick check</h3><p>Learn the room, camera angle, and your dog&apos;s first observable pattern.</p><ul><li>10, 15, 20, or 30 minutes</li><li>Useful baseline, not a diagnosis</li><li>Meaningful checkpoints, never +1 minute</li></ul></article>
            <article className="featured-mode"><span className="mode-time">30 min–4+ hr</span><h3>Going out</h3><p>Use Pawly for the grocery run, dinner, work block, or normal time away.</p><ul><li>Short clips when an event begins</li><li>Live video and two-way room audio</li><li>AI recap when you check back in</li></ul></article>
          </div>
        </div>
      </section>

      <section className="section shell intelligence-section">
        <div className="intelligence-copy"><span className="eyebrow">AI that knows when to wake up</span><h2>Light on the device.<br />Clear in the result.</h2><p>Pawly starts with lightweight local motion and audio checks. Dog detection becomes more attentive when the room changes. Large AI never watches the continuous stream.</p></div>
        <div className="intelligence-flow" aria-label="Pawly adaptive analysis pipeline">
          <div><small>Always local</small><strong>Motion + sound gate</strong><span>Low-resolution, adaptive sampling</span></div><b aria-hidden="true">→</b>
          <div><small>When useful</small><strong>Dog presence + location</strong><span>On-device object detection and tracking</span></div><b aria-hidden="true">→</b>
          <div><small>What you see</small><strong>Meaningful episodes</strong><span>Timeline, short clips, and AI recap</span></div>
        </div>
      </section>

      <section id="privacy" className="privacy-section">
        <div className="shell privacy-card">
          <div><span className="eyebrow light">A camera belongs to your home</span><h2>Private by default,<br />useful by choice.</h2></div>
          <div className="privacy-list"><p><span>01</span> Live camera and sound travel through an encrypted real-time room.</p><p><span>02</span> Dog, motion, and sound detection run on the camera device.</p><p><span>03</span> Only timestamped event text—not the live feed—is sent for AI summaries.</p><p><span>04</span> Short event clips stay in your browser; Pawly stores no continuous footage.</p></div>
        </div>
      </section>

      <footer className="footer shell"><Brand /><p>Understand the moments that matter. Ignore the rest.</p><Link href="/setup">Try the beta →</Link></footer>
    </main>
  );
}

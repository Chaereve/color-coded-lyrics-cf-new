export default {
  async fetch(request) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Under Maintenance | Chaereve</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :root {
      --bg-1: #0b1020;
      --bg-2: #111936;
      --card: rgba(255, 255, 255, 0.08);
      --border: rgba(255, 255, 255, 0.14);
      --text: #f8fafc;
      --muted: #cbd5e1;
      --accent: #8b5cf6;
      --accent-2: #ec4899;
      --accent-3: #22d3ee;
    }

    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      overflow: hidden;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(900px 500px at 10% 10%, rgba(139, 92, 246, 0.25), transparent 60%),
        radial-gradient(700px 400px at 90% 20%, rgba(34, 211, 238, 0.18), transparent 60%),
        radial-gradient(600px 400px at 50% 100%, rgba(236, 72, 153, 0.18), transparent 60%),
        linear-gradient(135deg, var(--bg-1), var(--bg-2));
      padding: 24px;
    }

    .orb {
      position: absolute;
      border-radius: 999px;
      filter: blur(40px);
      opacity: 0.45;
      animation: float 10s ease-in-out infinite;
      pointer-events: none;
    }

    .orb.one {
      width: 220px;
      height: 220px;
      background: rgba(139, 92, 246, 0.35);
      top: 8%;
      left: 8%;
    }

    .orb.two {
      width: 260px;
      height: 260px;
      background: rgba(34, 211, 238, 0.28);
      right: 6%;
      top: 14%;
      animation-delay: -2s;
    }

    .orb.three {
      width: 280px;
      height: 280px;
      background: rgba(236, 72, 153, 0.22);
      bottom: 6%;
      left: 50%;
      transform: translateX(-50%);
      animation-delay: -4s;
    }

    .card {
      position: relative;
      width: min(720px, 100%);
      padding: 40px 32px;
      border: 1px solid var(--border);
      border-radius: 28px;
      background: var(--card);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      box-shadow:
        0 20px 80px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255,255,255,0.06);
      text-align: center;
      z-index: 2;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: #e9d5ff;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 0.9rem;
      margin-bottom: 22px;
    }

    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #f59e0b;
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
      animation: pulse 1.8s infinite;
    }

    .icon-wrap {
      display: grid;
      place-items: center;
      margin-bottom: 20px;
    }

    .ring {
      width: 94px;
      height: 94px;
      border-radius: 50%;
      position: relative;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, rgba(139,92,246,0.25), rgba(34,211,238,0.18));
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
    }

    .ring::before {
      content: "";
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: var(--accent);
      border-right-color: var(--accent-3);
      animation: spin 4s linear infinite;
      opacity: 0.9;
    }

    .gear {
      font-size: 40px;
      animation: spin-reverse 8s linear infinite;
      filter: drop-shadow(0 0 14px rgba(255,255,255,0.12));
    }

    h1 {
      font-size: clamp(2rem, 4vw, 3.2rem);
      line-height: 1.08;
      letter-spacing: -0.04em;
      margin-bottom: 14px;
    }

    .gradient-text {
      background: linear-gradient(90deg, #ffffff 0%, #ddd6fe 35%, #a5f3fc 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    p {
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.75;
      max-width: 560px;
      margin: 0 auto;
    }

    .status {
      margin-top: 30px;
      padding: 16px 18px;
      border-radius: 18px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
    }

    .status strong {
      color: #fff;
      font-weight: 600;
    }

    .progress {
      width: 100%;
      height: 8px;
      margin-top: 24px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.05);
    }

    .progress > span {
      display: block;
      height: 100%;
      width: 38%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-3));
      background-size: 200% 100%;
      animation: shimmer 2.6s linear infinite;
      box-shadow: 0 0 20px rgba(139,92,246,0.28);
    }

    .footer {
      margin-top: 18px;
      font-size: 0.92rem;
      color: #94a3b8;
    }

    .brand {
      margin-top: 26px;
      font-size: 0.9rem;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.6);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes spin-reverse {
      to { transform: rotate(-360deg); }
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(245, 158, 11, 0); }
      100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
    }

    @keyframes shimmer {
      0% { background-position: 0% 50%; transform: translateX(-20%); }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; transform: translateX(180%); }
    }

    @keyframes float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-20px); }
    }

    @media (max-width: 640px) {
      .card {
        padding: 30px 20px;
        border-radius: 22px;
      }

      p {
        font-size: 0.98rem;
      }

      .status {
        padding: 14px 14px;
      }
    }
  </style>
</head>
<body>
  <div class="orb one"></div>
  <div class="orb two"></div>
  <div class="orb three"></div>

  <main class="card">
    <div class="badge">
      <span class="dot"></span>
      Scheduled Maintenance
    </div>

    <div class="icon-wrap">
      <div class="ring">
        <div class="gear">⚙️</div>
      </div>
    </div>

    <h1><span class="gradient-text">We&rsquo;ll be back soon.</span></h1>

    <p>
      Chaereve is currently undergoing maintenance and improvements.
      We&rsquo;re working to make the experience smoother, faster, and better for you.
    </p>

    <div class="status">
      <strong>Status:</strong> Temporary maintenance in progress.<br />
      <strong>Estimated downtime:</strong> A few minutes.
    </div>

    <div class="progress">
      <span></span>
    </div>

    <div class="footer">Thanks for your patience and understanding.</div>
    <div class="brand">CHAEREVE</div>
  </main>
</body>
</html>`;

    return new Response(html, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Retry-After": "3600"
      }
    });
  }
};

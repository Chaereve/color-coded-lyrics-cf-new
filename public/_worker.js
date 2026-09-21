export default {
  async fetch(request) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Under Maintenance | Chaereve</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #0c0c1d 0%, #1a1a3e 50%, #16213e 100%);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            color: #e2e8f0;
            overflow: hidden;
            position: relative;
        }

        /* Background Pattern */
        body::before {
            content: '';
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background-image: 
                radial-gradient(circle at 20% 50%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
                radial-gradient(circle at 80% 80%, rgba(236, 72, 153, 0.1) 0%, transparent 50%);
            pointer-events: none;
            z-index: 0;
        }

        .container {
            text-align: center;
            z-index: 10;
            padding: 40px;
            max-width: 600px;
        }

        .icon-wrapper {
            margin-bottom: 32px;
            position: relative;
            display: inline-block;
        }

        /* Animated Wrench & Gear */
        .gear {
            font-size: 80px;
            display: inline-block;
            animation: float 3s ease-in-out infinite;
            filter: drop-shadow(0 0 20px rgba(99, 102, 241, 0.4));
        }
        
        .wrench {
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 40px;
            animation: spin-slow 4s linear infinite;
        }

        h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 16px;
            background: linear-gradient(to right, #fff, #94a3b8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }

        p {
            font-size: 1.125rem;
            line-height: 1.6;
            color: #94a3b8;
            margin-bottom: 12px;
        }

        .highlight {
            color: #818cf8;
            font-weight: 500;
        }

        /* Progress Bar */
        .progress-container {
            margin-top: 40px;
            width: 100%;
            height: 4px;
            background: rgba(255,255,255,0.1);
            border-radius: 4px;
            overflow: hidden;
            position: relative;
        }

        .progress-bar {
            height: 100%;
            width: 60%;
            background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899);
            border-radius: 4px;
            animation: loading 2s ease-in-out infinite;
            box-shadow: 0 0 10px rgba(99, 102, 241, 0.5);
        }

        .eta {
            margin-top: 16px;
            font-size: 0.875rem;
            color: #64748b;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .pulse-dot {
            width: 8px; 
            height: 8px; 
            background: #22c55e; 
            border-radius: 50%; 
            display: inline-block;
            animation: pulse 2s infinite;
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
        }

        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-15px); }
        }

        @keyframes spin-slow {
            from { transform: translateX(-50%) rotate(0deg); }
            to { transform: translateX(-50%) rotate(360deg); }
        }

        @keyframes loading {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(400%); }
        }

        @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }

        @media (max-width: 480px) {
            h1 { font-size: 1.75rem; }
            .gear { font-size: 64px; }
            p { font-size: 1rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon-wrapper">
            <div class="gear">⚙️</div>
            <div class="wrench">🔧</div>
        </div>
        
        <h1>We'll Be Right Back!</h1>
        <p>We're currently performing <span class="highlight">scheduled maintenance</span> to upgrade our systems.</p>
        <p>This shouldn't take long. Thank you for your patience! 🙏</p>
        
        <div class="progress-container">
            <div class="progress-bar"></div>
        </div>
        
        <div class="eta">
            <span class="pulse-dot"></span>
            <span>Estimated Time: A few minutes</span>
        </div>
    </div>
</body>
</html>`;
    
    return new Response(html, {
      status: 503,
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-store',
        'Retry-After': '3600'
      },
    });
  },
};

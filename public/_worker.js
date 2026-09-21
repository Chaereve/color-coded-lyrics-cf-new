export default {
  async fetch(request, env) {
    const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Dang bao tri</title><style>body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#fff;font-family:sans-serif;text-align:center}h1{font-size:2rem}</style></head><body><div><div style="font-size:64px">⚙️</div><h1>Website dang bao tri</h1><p>Chung toi dang nang cap he thong, vui long quay lai sau it phut.</p></div></body></html>`;
    
    return new Response(html, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "no-store",
        "Retry-After": "3600"
      }
    });
  }
}

export default {
  async fetch(request, env) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Under Maintenance - Chaereve</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  min-height:100vh;
  display:flex;align-items:center;justify-content:center;
  background:#0a0e1a;
  font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif;
  color:#e2e8f0;
  overflow:hidden;
  position:relative;
}
.orb{
  position:absolute;border-radius:50%;
  filter:blur(80px);opacity:.35;
  animation:float 8s ease-in-out infinite;
}
.orb-1{width:400px;height:400px;background:#38bdf8;top:-100px;left:-100px}
.orb-2{width:350px;height:350px;background:#818cf8;bottom:-80px;right:-80px;animation-delay:-4s}
.orb-3{width:200px;height:200px;background:#c084fc;top:50%;left:60%;animation-delay:-2s}
@keyframes float{
  0%,100%{transform:translateY(0) scale(1)}
  50%{transform:translateY(-30px) scale(1.05)}
}
.card{
  position:relative;z-index:1;
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.09);
  border-radius:24px;
  padding:3.5rem 3rem;
  max-width:520px;width:90%;
  text-align:center;
  backdrop-filter:blur(20px);
  box-shadow:0 25px 60px rgba(0,0,0,.5);
}
.icon-wrap{
  position:relative;
  width:90px;height:90px;
  margin:0 auto 1.8rem;
  display:flex;align-items:center;justify-content:center;
}
.ring{
  position:absolute;inset:0;
  border-radius:50%;
  border:2px solid transparent;
  border-top-color:#38bdf8;
  border-right-color:#818cf8;
  animation:spin 1.5s linear infinite;
}
.icon{font-size:2.4rem}
@keyframes spin{to{transform:rotate(360deg)}}
h1{
  font-size:2rem;font-weight:700;
  margin-bottom:1rem;
  background:linear-gradient(135deg,#38bdf8,#818cf8,#c084fc);
  -webkit-background-clip:text;
  background-clip:text;
  -webkit-text-fill-color:transparent;
}
.sub{
  font-size:1.05rem;line-height:1.7;
  color:#94a3b8;
  margin-bottom:1.8rem;
}
.dots{display:flex;gap:8px;justify-content:center;margin-bottom:1.8rem}
.dots span{
  width:10px;height:10px;border-radius:50%;
  background:#38bdf8;
  animation:pulse 1.4s ease-in-out infinite;
}
.dots span:nth-child(2){animation-delay:.2s;background:#818cf8}
.dots span:nth-child(3){animation-delay:.4s;background:#c084fc}
@keyframes pulse{
  0%,100%{opacity:.3;transform:scale(.8)}
  50%{opacity:1;transform:scale(1.2)}
}
.note{font-size:.95rem;color:#64748b}
.footer{
  margin-top:2.2rem;padding-top:1.5rem;
  border-top:1px solid rgba(255,255,255,.07);
  font-size:.85rem;color:#475569;
}
@media(max-width:480px){
  .card{padding:2.5rem 1.5rem}
  h1{font-size:1.6rem}
}
</style>
</head>
<body>
<div class="orb orb-1"></div>
<div class="orb orb-2"></div>
<div class="orb orb-3"></div>
<div class="card">
  <div class="icon-wrap">
    <div class="ring"></div>
    <span class="icon">🛠️</span>
  </div>
  <h1>We'll Be Back Soon</h1>
  <p class="sub">Our website is currently undergoing scheduled maintenance to bring you a better experience.</p>
  <div class="dots"><span></span><span></span><span></span></div>
  <p class="note">Thank you for your patience!</p>
  <div class="footer">&copy; 2025 Chaereve. All rights reserved.</div>
</div>
</body>
</html>`;

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

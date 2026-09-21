import { useEffect, useRef } from "react";
import AuroraBackground from "@/components/AuroraBackground";
import LogoMark from "@/components/LogoMark";
import StatusBadge from "@/components/StatusBadge";
import Countdown from "@/components/Countdown";
import TaskList from "@/components/TaskList";
import NotifyForm from "@/components/NotifyForm";
import LinkRow from "@/components/LinkRow";

export default function App() {
  const cardRef = useRef<HTMLElement | null>(null);

  // One frame-limited listener drives the subtle pointer glow.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches)
      return;

    let raf = 0;
    let x = 0;
    let y = 0;

    const apply = () => {
      raf = 0;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      x = e.clientX - r.left;
      y = e.clientY - r.top;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="page">
      <AuroraBackground />

      <section
        ref={cardRef}
        className="glass-card rise z-10 w-full max-w-[560px] px-6 py-9 sm:px-9 sm:py-10"
      >
        <span aria-hidden className="card-topline" />
        <span aria-hidden className="card-glow" />

        <div className="relative flex flex-col items-center text-center">
          <LogoMark />
          <StatusBadge />

          <h1 className="rise d3 mt-5 max-w-[420px] bg-gradient-to-r from-txt via-white to-a2 bg-clip-text font-display text-[24px] font-bold leading-tight tracking-[-0.2px] text-transparent sm:text-[27px]">
            Chaereve is getting an upgrade
          </h1>

          <p className="rise d4 mx-auto mt-3 max-w-[430px] text-[13.5px] leading-relaxed text-txt2">
            We are making Chaereve better. Your requests, votes, and wallet
            balance are safe. See you soon!
          </p>

          <Countdown />
          <TaskList />
          <NotifyForm />
          <LinkRow />

          <footer className="mt-7 w-full border-t border-line/60 pt-5">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-txt3">
              © 2026 Chaereve
              <span className="mx-2 text-line2">·</span>
              chaereve.pages.dev
            </p>
          </footer>
        </div>
      </section>
    </div>
  );
}

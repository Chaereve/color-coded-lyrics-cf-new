import { useState } from "react";
import { logoUrl } from "@/lib/site";

/** Embedded fallback for when the live logo is unavailable. */
function FallbackMark() {
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
      <rect width="64" height="64" fill="#4d40f0" />
      <path
        d="M40 15v23.6a6.5 6.5 0 1 1-4-6V22.6L24.6 25.4v17.2a6.5 6.5 0 1 1-4-6V22.4L40 15z"
        fill="white"
      />
    </svg>
  );
}

/** Brand mark with the same resting shimmer used by the main app. */
export default function LogoMark() {
  const [failed, setFailed] = useState(false);

  return (
    <div className="rise relative grid place-items-center">
      <div
        aria-hidden
        className="pointer-events-none absolute h-24 w-24 rounded-full bg-a/40 blur-2xl"
      />
      <div
        className="applogo relative h-[68px] w-[68px] overflow-hidden rounded-[16px] border border-white/10"
        style={{ boxShadow: "0 18px 44px -16px rgba(77,64,240,.55)" }}
      >
        {failed ? (
          <FallbackMark />
        ) : (
          <img
            src={logoUrl}
            alt="Chaereve"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  );
}

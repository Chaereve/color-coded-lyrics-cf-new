/** Five-bar equalizer, echoing Chaereve's music identity. */
function Equalizer() {
  const heights = [0.45, 0.8, 1, 0.62, 0.36];
  return (
    <div aria-hidden className="rise d1 mt-5 flex h-4 items-end gap-[3px]">
      {heights.map((h, i) => (
        <span
          key={i}
          className="eq-bar"
          style={{ height: `${h * 100}%`, animationDelay: `${i * 0.13}s` }}
        />
      ))}
    </div>
  );
}

/** Maintenance status and equalizer. */
export default function StatusBadge() {
  return (
    <>
      <Equalizer />
      <div className="rise d2 mt-5 inline-flex items-center gap-2.5 rounded-full border border-a2/25 bg-a/[0.12] px-3.5 py-1.5">
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-a2 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-a2" />
        </span>
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-a2">
          Under maintenance
        </span>
      </div>
    </>
  );
}

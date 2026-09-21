/**
 * Three slow-moving brand gradients. Only transforms are animated to avoid
 * repainting the fixed layer while the page scrolls.
 */
export default function AuroraBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden bg-bg"
    >
      <div className="absolute -left-[18%] -top-[28%] h-[70vmax] w-[70vmax] rounded-full aurora-a" />
      <div className="absolute -right-[22%] -bottom-[32%] h-[66vmax] w-[66vmax] rounded-full aurora-b" />
      <div className="absolute left-[30%] top-[38%] h-[46vmax] w-[46vmax] rounded-full aurora-c" />
      <div className="absolute inset-0 dot-grid" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, transparent 42%, rgba(5,6,9,.55) 100%)",
        }}
      />
    </div>
  );
}

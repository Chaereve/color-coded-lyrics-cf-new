import { maintenanceDurationDays } from "@/lib/site";

/** A duration estimate rather than a fixed calendar date or fake countdown. */
export default function Countdown() {
  return (
    <div className="rise d5 mt-8 w-full">
      <div
        aria-label={`Estimated reopening in about ${maintenanceDurationDays} days`}
        className="overflow-hidden rounded-lg border border-line bg-bg2/80 px-5 py-5"
      >
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-txt3">
          Estimated reopening
        </p>
        <div className="mt-2 flex items-baseline justify-center gap-2">
          <strong className="font-mono text-[42px] font-semibold leading-none tabular-nums text-a2">
            {maintenanceDurationDays}
          </strong>
          <span className="font-display text-[18px] font-bold uppercase tracking-[0.08em] text-txt">
            days
          </span>
        </div>
        <p className="mt-2 text-[12px] text-txt3">
          We expect to be back in about seven days.
        </p>
      </div>
    </div>
  );
}

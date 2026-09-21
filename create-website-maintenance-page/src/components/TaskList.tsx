import { tasks } from "@/lib/site";
import {
  LeaderboardIcon,
  PaletteIcon,
  SparklesIcon,
  TrophyIcon,
} from "@/components/icons";

const iconMap = {
  palette: PaletteIcon,
  trophy: TrophyIcon,
  leaderboard: LeaderboardIcon,
  sparkles: SparklesIcon,
} as const;

/** Improvements included in this maintenance window. */
export default function TaskList() {
  return (
    <div className="rise d7 mt-6 w-full rounded-lg border border-line bg-bg2/60 p-3.5">
      <p className="mb-3 text-center font-mono text-[10.5px] uppercase tracking-[0.16em] text-txt3">
        What we are working on
      </p>
      <ul className="divide-y divide-line/70">
        {tasks.map((t) => {
          const Icon = iconMap[t.icon];
          return (
            <li key={t.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-surface2/80">
                <Icon className={`h-4 w-4 ${t.color}`} />
              </span>
              <span className="text-left">
                <span className="block text-[13.5px] font-semibold text-txt">
                  {t.title}
                </span>
                <span className="mt-0.5 block text-[12.5px] text-txt3">
                  {t.desc}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

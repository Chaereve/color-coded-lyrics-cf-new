/* ============================================================
   MAINTENANCE PAGE CONFIGURATION
   ============================================================ */

/** Public estimate only. No fixed calendar date is shown. */
export const maintenanceDurationDays = 7;

/** Falls back to an embedded music mark if the live logo is unavailable. */
export const logoUrl = "https://chaereve.pages.dev/logo-192.png";

/** Improvements included in this maintenance window. */
export type Task = {
  icon: "palette" | "trophy" | "leaderboard" | "sparkles";
  color: string;
  title: string;
  desc: string;
};

export const tasks: Task[] = [
  {
    icon: "palette",
    color: "text-kccl",
    title: "Interface upgrade",
    desc: "A cleaner experience with improved navigation and mobile usability.",
  },
  {
    icon: "trophy",
    color: "text-kalbum",
    title: "Expanded achievement system",
    desc: "More milestones, progress tracking, and meaningful rewards.",
  },
  {
    icon: "leaderboard",
    color: "text-kloop",
    title: "A new Leaderboards system",
    desc: "Fresh ranking rules designed to reward consistent participation.",
  },
  {
    icon: "sparkles",
    color: "text-kshort",
    title: "And much more",
    desc: "More quality-of-life improvements and community features are coming.",
  },
];

export type Channel = { label: string; href: string; icon: "youtube" };

export const channels: Channel[] = [
  {
    label: "Follow on YouTube",
    href: "https://www.youtube.com/@chaereve",
    icon: "youtube",
  },
];

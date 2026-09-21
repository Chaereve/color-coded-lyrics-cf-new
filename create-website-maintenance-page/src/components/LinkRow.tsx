import { channels } from "@/lib/site";
import { YoutubeIcon } from "@/components/icons";

const iconMap = {
  youtube: YoutubeIcon,
} as const;

/** The only external destination shown during maintenance. */
export default function LinkRow() {
  return (
    <nav
      aria-label="Chaereve channels"
      className="rise d9 mt-5 flex w-full justify-center"
    >
      {channels.map((c) => {
        const Icon = iconMap[c.icon];
        return (
          <a
            key={c.label}
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost w-full sm:w-auto sm:min-w-52"
          >
            <Icon className="h-[15px] w-[15px] flex-none" />
            <span className="truncate">{c.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

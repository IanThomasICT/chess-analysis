import type { ReactNode } from "react";

type Tone = "default" | "good" | "bad" | "accent";

const VALUE_TONE: Record<Tone, string> = {
  default: "text-fg",
  good: "text-win",
  bad: "text-loss",
  accent: "text-accent",
};

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small secondary line under the value. */
  hint?: string;
  tone?: Tone;
}

/** Compact KPI tile: small uppercase label + large mono value. */
export function StatTile({ label, value, hint, tone = "default" }: StatTileProps) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-2xl font-bold leading-tight ${VALUE_TONE[tone]}`}>
        {value}
      </div>
      {hint !== undefined && (
        <div className="text-xs text-faint mt-0.5">{hint}</div>
      )}
    </div>
  );
}

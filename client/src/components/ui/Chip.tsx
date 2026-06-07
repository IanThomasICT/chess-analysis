import type { ReactNode } from "react";

export type ChipTone =
  | "neutral"
  | "win"
  | "loss"
  | "draw"
  | "blunder"
  | "mistake"
  | "inaccuracy"
  | "good"
  | "info"
  | "swindle"
  | "accent";

const TONE: Record<ChipTone, string> = {
  neutral: "bg-raised text-muted",
  win: "bg-win/15 text-win",
  loss: "bg-loss/15 text-loss",
  draw: "bg-raised text-muted",
  blunder: "bg-blunder/15 text-blunder",
  mistake: "bg-mistake/15 text-mistake",
  inaccuracy: "bg-inaccuracy/15 text-inaccuracy",
  good: "bg-good/15 text-good",
  info: "bg-info/15 text-info",
  swindle: "bg-swindle/15 text-swindle",
  accent: "bg-accent/15 text-accent",
};

interface ChipProps {
  tone?: ChipTone;
  children: ReactNode;
  icon?: ReactNode;
  title?: string;
  className?: string;
}

/** Small tinted status pill. */
export function Chip({ tone = "neutral", children, icon, title, className = "" }: ChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${TONE[tone]} ${className}`}
      title={title}
    >
      {icon}
      {children}
    </span>
  );
}

import { Crosshair, Zap, Timer, CalendarDays, Dices, type LucideProps, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  bullet: Crosshair,
  blitz: Zap,
  rapid: Timer,
  daily: CalendarDays,
};

interface TimeClassIconProps extends LucideProps {
  timeClass: string;
}

/** Renders a lucide icon for a Chess.com time class (replaces emoji). */
export function TimeClassIcon({ timeClass, ...props }: TimeClassIconProps) {
  const Icon = ICONS[timeClass] ?? Dices;
  return <Icon {...props} />;
}

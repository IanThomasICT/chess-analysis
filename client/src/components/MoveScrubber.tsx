import { useMemo } from "react";
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
} from "lucide-react";
import type { MoveClass } from "../lib/classify";

interface Props {
  currentMove: number;
  maxMove: number;
  onSelect: (move: number) => void;
  onFlip: () => void;
  /** Per-move classification (index i = move from position i to i+1). */
  classifications: MoveClass[];
  /** True when the searched user played white — ticks mark only the user's errors. */
  userIsWhite: boolean;
}

interface Tick {
  /** Position index the tick navigates to (after the flawed move). */
  pos: number;
  pct: number;
  kind: "blunder" | "mistake";
}

const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-30";

/** Game move scrubber — a draggable timeline with blunder/mistake ticks. */
export function MoveScrubber({
  currentMove,
  maxMove,
  onSelect,
  onFlip,
  classifications,
  userIsWhite,
}: Props) {
  const ticks = useMemo<Tick[]>(() => {
    if (maxMove <= 0) {return [];}
    const out: Tick[] = [];
    for (let i = 0; i < classifications.length; i++) {
      const isUserMove = (i % 2 === 0) === userIsWhite;
      if (!isUserMove) {continue;}
      const cls = classifications[i];
      if (cls !== "blunder" && cls !== "mistake") {continue;}
      const pos = Math.min(i + 1, maxMove);
      out.push({ pos, pct: (pos / maxMove) * 100, kind: cls });
    }
    return out;
  }, [classifications, maxMove, userIsWhite]);

  const pct = maxMove > 0 ? (currentMove / maxMove) * 100 : 0;
  const pctStr = pct.toFixed(2);

  return (
    <div className="flex shrink-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => { onSelect(0); }}
          disabled={currentMove === 0}
          className={iconBtn}
          aria-label="First move"
          title="First move (Home)"
        >
          <ChevronFirst size={18} />
        </button>
        <button
          type="button"
          onClick={() => { onSelect(Math.max(0, currentMove - 1)); }}
          disabled={currentMove === 0}
          className={iconBtn}
          aria-label="Previous move"
          title="Previous move (←)"
        >
          <ChevronLeft size={18} />
        </button>

        {/* Scrubber track */}
        <div className="relative mx-1 h-8 flex-1">
          {/* Base rail */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full bg-accent/70"
              style={{ width: `${pctStr}%` }}
            />
          </div>
          {/* Blunder / mistake ticks */}
          {ticks.map((t) => (
            <button
              key={`${String(t.pos)}-${t.kind}`}
              type="button"
              onClick={() => { onSelect(t.pos); }}
              aria-label={`Go to ${t.kind} at move ${String(t.pos)}`}
              title={`${t.kind === "blunder" ? "Blunder" : "Mistake"} — move ${String(t.pos)}`}
              className={`absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm ${
                t.kind === "blunder" ? "bg-blunder" : "bg-mistake"
              } hover:h-4`}
              style={{ left: `${t.pct.toFixed(2)}%` }}
            />
          ))}
          {/* Current-move thumb */}
          <div
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface shadow"
            style={{ left: `${pctStr}%` }}
          />
          {/* Interaction layer (drag + keyboard) */}
          <input
            type="range"
            min={0}
            max={maxMove}
            value={currentMove}
            onChange={(e) => { onSelect(Number(e.target.value)); }}
            aria-label="Move scrubber"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        <button
          type="button"
          onClick={() => { onSelect(Math.min(maxMove, currentMove + 1)); }}
          disabled={currentMove >= maxMove}
          className={iconBtn}
          aria-label="Next move"
          title="Next move (→)"
        >
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          onClick={() => { onSelect(maxMove); }}
          disabled={currentMove >= maxMove}
          className={iconBtn}
          aria-label="Last move"
          title="Last move (End)"
        >
          <ChevronLast size={18} />
        </button>
        <div className="mx-0.5 h-5 w-px bg-line" />
        <button
          type="button"
          onClick={onFlip}
          className={iconBtn}
          aria-label="Flip board"
          title="Flip board"
        >
          <FlipVertical2 size={18} />
        </button>
      </div>

      <div className="text-center font-mono text-xs text-muted">
        {currentMove} / {maxMove}
      </div>
    </div>
  );
}

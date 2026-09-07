import { memo, useEffect, useMemo, useRef } from "react";
import { classToColor, type MoveClass } from "../lib/classify";

interface MoveListProps {
  moves: string[];
  currentMove: number;
  onSelectMove: (moveIndex: number) => void;
  classifications: MoveClass[];
  motifs?: Record<string, string[]>;
  /** True at index i when transition i is a missed conversion by the user. */
  missedConversions?: boolean[];
  /** Side controlled by the searched user. Drives dimming of opponent moves. */
  userIsWhite?: boolean;
}

/** Replace underscores with spaces so tooltips render "back rank mate" not "back_rank_mate". */
function motifTitle(tags: string[]): string {
  return tags.map((t) => t.replace(/_/g, " ")).join(", ");
}

interface PlyProps {
  san: string;
  isActive: boolean;
  isUserPly: boolean;
  isMissed: boolean;
  classification: MoveClass;
  motifTags: string[];
  onClick: () => void;
  activeRef?: React.Ref<HTMLButtonElement>;
}

function Ply({
  san,
  isActive,
  isUserPly,
  isMissed,
  classification,
  motifTags,
  onClick,
  activeRef,
}: PlyProps) {
  const activeClass = isActive ? "bg-accent/20 text-fg" : "text-fg";
  const dimClass = isUserPly ? "" : "opacity-50";
  return (
    <button
      type="button"
      ref={activeRef}
      onClick={onClick}
      className={`rounded px-1 text-left hover:bg-raised ${activeClass} ${dimClass} ${classToColor(classification)}`}
    >
      {san}
      {motifTags.length > 0 && (
        <span
          className="ml-1 cursor-help text-[10px] text-info"
          title={motifTitle(motifTags)}
        >
          {motifTags.map((t) => t.charAt(0).toUpperCase()).join("")}
        </span>
      )}
      {isMissed && (
        <span
          className="ml-1 cursor-help rounded bg-inaccuracy/20 px-1 text-[10px] text-inaccuracy"
          title="Missed conversion — opponent blundered, you didn't punish"
        >
          M
        </span>
      )}
    </button>
  );
}

export const MoveList = memo(function MoveList({
  moves,
  currentMove,
  onSelectMove,
  classifications,
  motifs,
  missedConversions,
  userIsWhite,
}: MoveListProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [currentMove]);

  // Group moves into pairs (white, black) — only recomputes when moves change.
  const movePairs = useMemo(() => {
    const pairs: Array<{
      number: number;
      white: { san: string; index: number };
      black?: { san: string; index: number };
    }> = [];

    for (let i = 0; i < moves.length; i += 2) {
      const hasBlack = i + 1 < moves.length;
      pairs.push({
        number: Math.floor(i / 2) + 1,
        white: { san: moves[i], index: i + 1 },
        black: hasBlack ? { san: moves[i + 1], index: i + 2 } : undefined,
      });
    }
    return pairs;
  }, [moves]);

  // Missing or unspecified userIsWhite defaults to "treat all moves as user's" — keeps
  // the component usable in contexts where user color isn't known.
  const whiteIsUser = userIsWhite ?? true;
  const blackIsUser = userIsWhite === undefined ? true : !userIsWhite;

  return (
    <div className="p-2 text-sm">
      <div className="grid grid-cols-[30px_1fr_1fr] gap-y-0.5">
        {movePairs.map((pair) => {
          const blackPly = pair.black;
          const whiteTransition = pair.white.index - 1;
          const blackTransition = blackPly !== undefined ? blackPly.index - 1 : -1;
          return (
            <div key={pair.number} className="contents">
              <span className="pr-1 text-right text-faint">
                {pair.number}.
              </span>
              <Ply
                san={pair.white.san}
                isActive={currentMove === pair.white.index}
                isUserPly={whiteIsUser}
                isMissed={missedConversions?.[whiteTransition] ?? false}
                classification={classifications[whiteTransition] ?? "good"}
                motifTags={motifs?.[String(pair.white.index)] ?? []}
                onClick={() => { onSelectMove(pair.white.index); }}
                activeRef={currentMove === pair.white.index ? activeRef : undefined}
              />
              {blackPly !== undefined ? (
                <Ply
                  san={blackPly.san}
                  isActive={currentMove === blackPly.index}
                  isUserPly={blackIsUser}
                  isMissed={missedConversions?.[blackTransition] ?? false}
                  classification={classifications[blackTransition] ?? "good"}
                  motifTags={motifs?.[String(blackPly.index)] ?? []}
                  onClick={() => { onSelectMove(blackPly.index); }}
                  activeRef={currentMove === blackPly.index ? activeRef : undefined}
                />
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

import { Chess, type Square } from "chess.js";
import { memo, useEffect, useMemo, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Color, Dests, Key, MoveMetadata } from "@lichess-org/chessground/types";

const EMPTY_SHAPES: DrawShape[] = [];

interface ChessBoardProps {
  fen: string;
  orientation?: "white" | "black";
  lastMove?: [Key, Key];
  autoShapes?: DrawShape[];
  config?: Partial<Config>;
  interactive?: boolean;
  onMove?: (orig: string, dest: string, promotion?: string) => void;
}

function legalDests(fen: string): Dests {
  const dests = new Map<Key, Key[]>();
  try {
    const chess = new Chess(fen);
    for (const move of chess.moves({ verbose: true })) {
      const from = move.from as Key;
      const to = move.to as Key;
      const list = dests.get(from) ?? [];
      list.push(to);
      dests.set(from, list);
    }
  } catch {
    // bad FEN — return empty
  }
  return dests;
}

function fenTurnColor(fen: string): Color {
  return fen.split(" ")[1] === "w" ? "white" : "black";
}

function isPromotion(fen: string, orig: Key, dest: Key): boolean {
  try {
    const chess = new Chess(fen);
    // Key "a0" is valid in Chessground but not a chess.js Square — skip it
    if (orig === "a0" || dest === "a0") {
      return false;
    }
    const piece = chess.get(orig as Square);
    if (piece?.type !== "p") {
      return false;
    }
    const destRank = dest[1];
    return (piece.color === "w" && destRank === "8") || (piece.color === "b" && destRank === "1");
  } catch {
    return false;
  }
}

export const ChessBoard = memo(function ChessBoard({
  fen,
  orientation = "white",
  lastMove,
  autoShapes,
  config,
  interactive = false,
  onMove,
}: ChessBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  const fenRef = useRef(fen);

  // Keep refs current so the stable Chessground callback always sees the latest values
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    fenRef.current = fen;
  }, [fen]);

  const legalDestsMap = useMemo(() => (interactive ? legalDests(fen) : new Map<Key, Key[]>()), [fen, interactive]);
  const turnColor = useMemo(() => fenTurnColor(fen), [fen]);

  useEffect(() => {
    if (boardRef.current === null) {
      return;
    }

    const afterMove = (orig: Key, dest: Key, _metadata: MoveMetadata): void => {
      const promotion = isPromotion(fenRef.current, orig, dest) ? "q" : undefined;
      onMoveRef.current?.(orig, dest, promotion);
    };

    const initConfig: Config = {
      fen,
      lastMove,
      orientation,
      movable: { free: false },
      draggable: { enabled: false },
      selectable: { enabled: false },
      animation: { enabled: true, duration: 200 },
      ...config,
    };

    if (interactive) {
      initConfig.movable = {
        free: false,
        color: turnColor,
        dests: legalDestsMap,
        events: { after: afterMove },
      };
      initConfig.draggable = { enabled: true };
      initConfig.selectable = { enabled: true };
    }

    apiRef.current = Chessground(boardRef.current, initConfig);
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- One-time init; updates go through api.set() in the next effect.
  }, []);

  useEffect(() => {
    if (interactive) {
      apiRef.current?.set({
        fen,
        lastMove,
        orientation,
        animation: { enabled: false },
        drawable: { autoShapes: autoShapes ?? EMPTY_SHAPES },
        movable: {
          free: false,
          color: turnColor,
          dests: legalDestsMap,
        },
        draggable: { enabled: true },
        selectable: { enabled: true },
      });
    } else {
      apiRef.current?.set({
        fen,
        lastMove,
        orientation,
        animation: { enabled: false },
        drawable: { autoShapes: autoShapes ?? EMPTY_SHAPES },
      });
    }
  }, [fen, lastMove, autoShapes, orientation, interactive, turnColor, legalDestsMap]);

  return <div ref={boardRef} className="w-full h-full aspect-square" />;
});

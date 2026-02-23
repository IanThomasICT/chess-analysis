import { memo, useEffect, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";

const EMPTY_SHAPES: DrawShape[] = [];

interface ChessBoardProps {
  fen: string;
  orientation?: "white" | "black";
  lastMove?: [Key, Key];
  autoShapes?: DrawShape[];
  config?: Partial<Config>;
}

export const ChessBoard = memo(function ChessBoard({ fen, orientation = "white", lastMove, autoShapes, config }: ChessBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (boardRef.current === null) return;
    apiRef.current = Chessground(boardRef.current, {
      fen,
      lastMove,
      orientation,
      movable: { free: false },
      draggable: { enabled: false },
      selectable: { enabled: false },
      animation: { enabled: true, duration: 200 },
      ...config,
    });
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- One-time init; updates go through api.set() in the next effect.
  }, []);

  useEffect(() => {
    apiRef.current?.set({
      fen,
      lastMove,
      orientation,
      animation: { enabled: false },
      drawable: { autoShapes: autoShapes ?? EMPTY_SHAPES },
    });
  }, [fen, lastMove, autoShapes, orientation]);

  return <div ref={boardRef} className="w-full h-full aspect-square" />;
});

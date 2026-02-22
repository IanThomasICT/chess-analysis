import { memo, useEffect, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { Key } from "@lichess-org/chessground/types";

interface ChessBoardProps {
  fen: string;
  lastMove?: [Key, Key];
  config?: Partial<Config>;
}

export const ChessBoard = memo(function ChessBoard({ fen, lastMove, config }: ChessBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (boardRef.current === null) return;
    apiRef.current = Chessground(boardRef.current, {
      fen,
      lastMove,
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
    apiRef.current?.set({ fen, lastMove, animation: { enabled: false } });
  }, [fen, lastMove]);

  return <div ref={boardRef} className="w-full h-full aspect-square" />;
});

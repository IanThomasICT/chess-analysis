import { useEffect, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { Key } from "@lichess-org/chessground/types";

interface ChessBoardProps {
  fen: string;
  lastMove?: [Key, Key];
  config?: Partial<Config>;
}

export function ChessBoard({ fen, lastMove, config }: ChessBoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (ref.current === null) return;
    api.current = Chessground(ref.current, {
      fen,
      lastMove,
      movable: { free: false },
      draggable: { enabled: false },
      selectable: { enabled: false },
      animation: { enabled: true, duration: 200 },
      ...config,
    });
    return () => {
      api.current?.destroy();
      api.current = null;
    };
    // Only initialize once — intentionally empty deps
  }, []);

  useEffect(() => {
    api.current?.set({ fen, lastMove });
  }, [fen, lastMove]);

  return <div ref={ref} className="w-full h-full aspect-square" />;
}

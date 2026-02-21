import { useState, useEffect, useCallback } from "react";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/analysis.$gameId";
import { type Key } from "@lichess-org/chessground/types";
import { db } from "../lib/db.server";
import { pgnToFens, pgnToMoves } from "../lib/pgn";
import { getGameAnalysis, isGameAnalyzed, type AnalysisRow } from "../lib/stockfish.server";
import { ChessBoard } from "../components/ChessBoard";
import { EvalBar } from "../components/EvalBar";
import { EvalGraph } from "../components/EvalGraph";
import { MoveList } from "../components/MoveList";

interface GameRow {
  id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_class: string;
  end_time: number;
  username: string;
}

/** Shape of SSE event data from the analysis endpoint */
interface AnalysisEvent {
  done?: boolean;
  error?: string;
  moveIndex: number;
  fen: string;
  moveSan?: string;
  scoreCp: number | null;
  scoreMate: number | null;
  bestMove: string;
  depth: number;
  total: number;
}

export function loader({ params }: Route.LoaderArgs) {
  const { gameId } = params;

  const game = db
    .prepare("SELECT * FROM games WHERE id = ?")
    .get(gameId) as GameRow | null;

  if (game === null) {
    throw new Error("Game not found");
  }

  const fens = pgnToFens(game.pgn);
  const moves = pgnToMoves(game.pgn);
  const analyzed = isGameAnalyzed(gameId, fens.length);

  let analysis: AnalysisRow[] = [];
  if (analyzed) {
    analysis = getGameAnalysis(gameId);
  }

  return {
    game: {
      id: game.id,
      white: game.white,
      black: game.black,
      result: game.result,
      timeClass: game.time_class,
      endTime: game.end_time,
      username: game.username,
    },
    fens,
    moves: moves.map((m) => ({
      san: m.san,
      from: m.from,
      to: m.to,
    })),
    analysis,
    analyzed,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData.game.white + " vs " + loaderData.game.black + " - Chess Analyzer" },
  ];
}

export default function AnalysisView() {
  const { game, fens, moves, analysis: initialAnalysis, analyzed } =
    useLoaderData<typeof loader>();

  const [currentMove, setCurrentMove] = useState(0);
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);

  const maxMove = fens.length - 1;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        setCurrentMove((m) => Math.min(m + 1, maxMove));
      }
      if (e.key === "ArrowLeft") {
        setCurrentMove((m) => Math.max(m - 1, 0));
      }
      if (e.key === "Home") {
        setCurrentMove(0);
      }
      if (e.key === "End") {
        setCurrentMove(maxMove);
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, [maxMove]);

  // Start analysis via SSE
  const startAnalysis = useCallback(() => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setProgress(0);

    const results: AnalysisRow[] = [];
    const eventSource = new EventSource("/api/analyze/" + game.id);

    eventSource.onmessage = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as AnalysisEvent;

      if (data.done === true) {
        eventSource.close();
        setIsAnalyzing(false);
        return;
      }

      if (data.error !== undefined) {
        eventSource.close();
        setIsAnalyzing(false);
        console.error("Analysis error:", data.error);
        return;
      }

      results.push({
        move_index: data.moveIndex,
        fen: data.fen,
        move_san: data.moveSan ?? null,
        score_cp: data.scoreCp,
        score_mate: data.scoreMate,
        best_move: data.bestMove,
        depth: data.depth,
      });

      setAnalysis([...results]);
      setProgress(((data.moveIndex + 1) / data.total) * 100);
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsAnalyzing(false);
    };
  }, [game.id, isAnalyzing]);

  // Get current eval score (from White's perspective, in pawns)
  const getCurrentScore = (): number => {
    const entry = analysis.find((a) => a.move_index === currentMove);
    if (entry === undefined) return 0;
    if (entry.score_mate !== null) {
      return entry.score_mate > 0 ? 10 : -10;
    }
    return (entry.score_cp ?? 0) / 100;
  };

  // Last move highlight
  const prevMove = currentMove > 0 ? moves[currentMove - 1] : undefined;
  const lastMove =
    prevMove !== undefined
      ? ([prevMove.from, prevMove.to] as [Key, Key])
      : undefined;

  // Build eval data for graph
  const evalData = analysis
    .sort((a, b) => a.move_index - b.move_index)
    .map((a) => ({
      moveIndex: a.move_index,
      score:
        a.score_mate !== null
          ? a.score_mate > 0
            ? 10
            : -10
          : (a.score_cp ?? 0) / 100,
    }));

  const currentScore = getCurrentScore();
  const progressStr = String(Math.round(progress));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <Link
            to="/"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            &larr; Back
          </Link>
          <div className="flex items-center gap-3 flex-1">
            <span className="font-semibold text-gray-900 dark:text-white">
              {game.white} vs {game.black}
            </span>
            <span className="text-sm px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {game.result}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {game.timeClass}
            </span>
          </div>
          {!analyzed && !isAnalyzing && (
            <button
              onClick={startAnalysis}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
            >
              Analyze with Stockfish
            </button>
          )}
          {isAnalyzing && (
            <div className="flex items-center gap-2">
              <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${progressStr}%` }}
                />
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {progressStr}%
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-4">
        <div className="grid grid-cols-[auto_1fr_280px] gap-4 h-[min(calc(100vh-200px),600px)]">
          {/* Eval Bar */}
          <div className="w-8">
            <EvalBar score={currentScore} />
          </div>

          {/* Chessground Board */}
          <div className="aspect-square max-h-full mx-auto">
            <ChessBoard fen={fens[currentMove]} lastMove={lastMove} />
          </div>

          {/* Move List */}
          <div className="overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
            <MoveList
              moves={moves.map((m) => m.san)}
              currentMove={currentMove}
              onSelectMove={setCurrentMove}
              analysis={analysis}
            />
          </div>
        </div>

        {/* Eval Graph */}
        {evalData.length > 0 && (
          <div className="mt-4 h-40 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
            <EvalGraph
              data={evalData}
              currentMove={currentMove}
              onSelectMove={setCurrentMove}
            />
          </div>
        )}

        {/* Move navigation controls */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentMove(0)}
            className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          >
            &laquo;
          </button>
          <button
            onClick={() => setCurrentMove(Math.max(0, currentMove - 1))}
            className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          >
            &lsaquo;
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400 min-w-[80px] text-center">
            {currentMove} / {maxMove}
          </span>
          <button
            onClick={() => setCurrentMove(Math.min(maxMove, currentMove + 1))}
            className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          >
            &rsaquo;
          </button>
          <button
            onClick={() => setCurrentMove(maxMove)}
            className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          >
            &raquo;
          </button>
        </div>
      </main>
    </div>
  );
}

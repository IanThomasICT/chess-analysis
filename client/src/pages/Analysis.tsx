import { useState, useEffect, useRef, useMemo, startTransition } from "react";
import { useParams, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { Key } from "@lichess-org/chessground/types";
import { fetchGame } from "../api";
import type { AnalysisRow, GameMove } from "../api";
import { ChessBoard } from "../components/ChessBoard";
import { EvalBar } from "../components/EvalBar";
import { EvalGraph } from "../components/EvalGraph";
import { MoveList } from "../components/MoveList";

// Stable empty arrays — avoids new references on every render when data is undefined.
const EMPTY_FENS: string[] = [];
const EMPTY_MOVES: GameMove[] = [];

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

export function Analysis() {
  const { gameId } = useParams<{ gameId: string }>();

  const { data, isPending, isError } = useQuery({
    queryKey: ["game", gameId],
    queryFn: () => fetchGame(gameId ?? ""),
    enabled: gameId !== undefined && gameId !== "",
  });

  const [currentMove, setCurrentMove] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisRow[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Sync initial analysis when data loads
  useEffect(() => {
    if (data !== undefined) {
      setAnalysis(data.analysis);
    }
  }, [data]);

  const game = data?.game;
  const fens = data?.fens ?? EMPTY_FENS;
  const moves = data?.moves ?? EMPTY_MOVES;
  const analyzed = data?.analyzed ?? false;
  const maxMove = fens.length - 1;

  // Set page title
  useEffect(() => {
    if (game !== undefined) {
      document.title = game.white + " vs " + game.black + " - Chess Analyzer";
    }
  }, [game]);

  // Keyboard navigation
  useEffect(() => {
    if (fens.length === 0) return;
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
  }, [maxMove, fens.length]);

  // Auto-start analysis via SSE when game loads (if not already analyzed)
  const analysisStartedRef = useRef(false);
  useEffect(() => {
    if (game === undefined || analyzed || analysisStartedRef.current) return;
    analysisStartedRef.current = true;
    setIsAnalyzing(true);
    setProgress(0);

    const results: AnalysisRow[] = [];
    const eventSource = new EventSource("/api/analyze/" + game.id);

    eventSource.onmessage = (event: MessageEvent<string>) => {
      const eventData = JSON.parse(event.data) as AnalysisEvent;

      if (eventData.done === true) {
        eventSource.close();
        setIsAnalyzing(false);
        return;
      }

      if (eventData.error !== undefined) {
        eventSource.close();
        setIsAnalyzing(false);
        console.error("Analysis error:", eventData.error);
        return;
      }

      results.push({
        move_index: eventData.moveIndex,
        fen: eventData.fen,
        move_san: eventData.moveSan ?? null,
        score_cp: eventData.scoreCp,
        score_mate: eventData.scoreMate,
        best_move: eventData.bestMove,
        depth: eventData.depth,
      });

      startTransition(() => {
        setAnalysis([...results]);
      });
      setProgress(((eventData.moveIndex + 1) / eventData.total) * 100);
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsAnalyzing(false);
    };

    return () => {
      eventSource.close();
    };
  }, [game, analyzed]);

  // Pre-indexed scores: scores[moveIndex] → pawns. Built once when analysis changes.
  const scores = useMemo(() => {
    const arr: number[] = [];
    for (const a of analysis) {
      arr[a.move_index] =
        a.score_mate !== null
          ? a.score_mate > 0 ? 10 : -10
          : (a.score_cp ?? 0) / 100;
    }
    return arr;
  }, [analysis]);

  const currentScore = scores[currentMove] ?? 0;

  // Build eval data for graph — only recomputes when analysis changes.
  const evalData = useMemo(
    () =>
      [...analysis]
        .sort((a, b) => a.move_index - b.move_index)
        .map((a) => ({
          moveIndex: a.move_index,
          score:
            a.score_mate !== null
              ? a.score_mate > 0
                ? 10
                : -10
              : (a.score_cp ?? 0) / 100,
        })),
    [analysis],
  );

  // Precompute move classifications once — O(n) with a Map, not O(n²) per render.
  // moveClasses[i] is the CSS class for the move from position i to position i+1.
  const moveClasses = useMemo(() => {
    if (analysis.length === 0) return [];
    const byIndex = new Map(analysis.map((a) => [a.move_index, a]));
    const classes: string[] = [];
    for (let i = 0; i < fens.length - 1; i++) {
      const before = byIndex.get(i);
      const after = byIndex.get(i + 1);
      if (before === undefined || after === undefined) {
        classes.push("");
        continue;
      }
      const scoreBefore =
        before.score_mate !== null
          ? before.score_mate > 0 ? 1000 : -1000
          : (before.score_cp ?? 0);
      const scoreAfter =
        after.score_mate !== null
          ? after.score_mate > 0 ? 1000 : -1000
          : (after.score_cp ?? 0);
      const isWhiteMove = i % 2 === 0;
      const swing = isWhiteMove
        ? scoreAfter - scoreBefore
        : scoreBefore - scoreAfter;
      if (swing < -300) classes.push("text-red-500 font-bold");
      else if (swing < -100) classes.push("text-orange-500 font-semibold");
      else if (swing < -50) classes.push("text-yellow-500");
      else classes.push("");
    }
    return classes;
  }, [analysis, fens.length]);

  // Stable SAN array so MoveList gets a consistent reference.
  const moveSans = useMemo(() => moves.map((m) => m.san), [moves]);

  // Last move highlight — stable reference prevents spurious ChessBoard effects.
  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    const prevMove = currentMove > 0 ? moves[currentMove - 1] : undefined;
    return prevMove !== undefined
      ? [prevMove.from, prevMove.to] as [Key, Key]
      : undefined;
  }, [currentMove, moves]);

  if (isPending) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Loading game...</p>
      </div>
    );
  }

  if (isError || game === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Game not found</h1>
          <Link to="/" className="text-blue-600 hover:text-blue-700 mt-2 inline-block">
            &larr; Back to home
          </Link>
        </div>
      </div>
    );
  }

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
              moves={moveSans}
              currentMove={currentMove}
              onSelectMove={setCurrentMove}
              moveClasses={moveClasses}
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

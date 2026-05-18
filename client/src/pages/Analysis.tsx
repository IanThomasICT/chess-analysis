import { useState, useEffect, useRef, useMemo, startTransition } from "react";
import { useParams, useSearchParams, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { fetchGame, fetchGameMetrics, fetchAlternatives, type AnalysisRow, type GameMove, type GameMetrics } from "../api";
import { ChessBoard } from "../components/ChessBoard";
import { EvalBar } from "../components/EvalBar";
import { EvalGraph } from "../components/EvalGraph";
import { MoveList } from "../components/MoveList";
import { RecurrencePanel } from "../components/RecurrencePanel";
import { AlternativesPanel } from "../components/AlternativesPanel";
import { classifySwing, type MoveClass } from "../lib/classify";

function accuracyChipClass(acc: number): string {
  const base = "px-2 py-0.5 rounded text-xs font-semibold";
  if (acc >= 90) {return `${base} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`;}
  if (acc >= 70) {return `${base} bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200`;}
  return `${base} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`;
}

// Stable empty arrays — avoids new references on every render when data is undefined.
const EMPTY_FENS: string[] = [];
const EMPTY_MOVES: GameMove[] = [];
const EMPTY_SHAPES: DrawShape[] = [];

// Convert an analysis row to a single eval number in pawns (graph / bar units).
// Mate scores collapse to ±10 pawns so the graph stays bounded.
function evalPawns(row: AnalysisRow): number {
  if (row.score_mate !== null) {
    return row.score_mate > 0 ? 10 : -10;
  }
  return (row.score_cp ?? 0) / 100;
}

// Centipawn-equivalent score for swing classification. Mates collapse to ±1000cp.
function evalCp(row: AnalysisRow): number {
  if (row.score_mate !== null) {
    return row.score_mate > 0 ? 1000 : -1000;
  }
  return row.score_cp ?? 0;
}

// Temporary Win% approximation from centipawns (will be replaced by server metrics in Phase 1).
// Returns a value in [0, 100] representing Win% for the side with positive eval.
function cpToWp(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Shape of SSE event data from the analysis endpoint */
interface AnalysisEvent {
  done?: boolean;
  error?: string;
  moveIndex: number;
  multipvRank?: number;
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

  const queryClient = useQueryClient();

  const { data, isPending, isError } = useQuery({
    queryKey: ["game", gameId],
    queryFn: async () => fetchGame(gameId ?? ""),
    enabled: gameId !== undefined && gameId !== "",
  });

  const { data: metrics } = useQuery<GameMetrics>({
    queryKey: ["metrics", gameId],
    queryFn: async () => fetchGameMetrics(gameId ?? ""),
    enabled: gameId !== undefined && gameId !== "" && (data?.analyzed ?? false),
  });

  const [searchParams] = useSearchParams();
  const [currentMove, setCurrentMove] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisRow[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [userFlipped, setUserFlipped] = useState(false);
  // Deep analysis (MultiPV=3) runs by default — top-3 arrows + AlternativesPanel
  // are visible from the moment a new game is opened, and the engine persists
  // rank 2/3 to the analysis table for later reuse.
  const [deepEnabled] = useState(true);

  // Seed analysis state from query data when it loads. SSE results extend this
  // array in-place, so we need state — pure derivation is not enough.

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

  // Deep-link support: honour ?move=N query param set by RecurrencePanel links.
  // searchParamsRef captures the value at mount; we only want to apply the
  // param once when fens first load (fens.length transitions 0 → N).
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    const moveParam = searchParamsRef.current.get("move");
    if (moveParam !== null && fens.length > 0) {
      const n = parseInt(moveParam, 10);
      if (!Number.isNaN(n) && n >= 0 && n < fens.length) {
        setCurrentMove(n);
      }
    }
  }, [fens.length]);

  // Board orientation — default to the searched user's color, toggleable via flip button
  const defaultOrientation: "white" | "black" =
    game !== undefined && game.username.toLowerCase() === game.black.toLowerCase()
      ? "black"
      : "white";
  const flippedOrientation: "white" | "black" =
    defaultOrientation === "white" ? "black" : "white";
  const orientation: "white" | "black" = userFlipped ? flippedOrientation : defaultOrientation;

  // Set page title
  useEffect(() => {
    if (game !== undefined) {
      document.title = `${game.white} vs ${game.black} - Chess Analyzer`;
    }
  }, [game]);

  // Keyboard navigation
  useEffect(() => {
    if (fens.length === 0) {return;}
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
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        const classes = classificationsRef.current;
        const cur = currentMoveRef.current;
        if (e.shiftKey) {
          for (let i = cur - 2; i >= 0; i--) {
            if (classes[i] === "blunder") {
              setCurrentMove(i + 1);
              return;
            }
          }
        } else {
          for (let i = cur; i < classes.length; i++) {
            if (classes[i] === "blunder") {
              setCurrentMove(Math.min(i + 1, maxMove));
              return;
            }
          }
        }
      }
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        const classes = classificationsRef.current;
        const cur = currentMoveRef.current;
        if (e.shiftKey) {
          for (let i = cur - 2; i >= 0; i--) {
            if (classes[i] === "mistake") {
              setCurrentMove(i + 1);
              return;
            }
          }
        } else {
          for (let i = cur; i < classes.length; i++) {
            if (classes[i] === "mistake") {
              setCurrentMove(Math.min(i + 1, maxMove));
              return;
            }
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, [maxMove, fens.length]);

  // Refs so keyboard handler always sees latest values without re-registering.
  // Declared here (before the keyboard useEffect) to satisfy rules-of-hooks order.
  // The .current assignments happen after moveClassifications is computed below.
  const currentMoveRef = useRef(currentMove);
  const classificationsRef = useRef<MoveClass[]>([]);

  // Auto-start analysis via SSE when game loads (if not already analyzed).
  // The setIsAnalyzing/setProgress calls below are part of the init sequence,
  // not a state cascade — flagging them would just push complexity into refs.
  const analysisStartedRef = useRef(false);
   
  useEffect(() => {
    if (game === undefined || analyzed || analysisStartedRef.current) {
      return;
    }
    analysisStartedRef.current = true;
    setIsAnalyzing(true);
    setProgress(0);

    const results: AnalysisRow[] = [];
    // MultiPV=3 by default — engine emits 3 events per position (rank 1/2/3).
    // Only rank 1 feeds the analysis state (eval graph, move list, recurrence).
    // Ranks 2/3 are persisted server-side; AlternativesPanel fetches them lazily.
    const eventSource = new EventSource(`/api/analyze/${game.id}?multipv=3`);

    eventSource.onmessage = (event: MessageEvent<string>) => {
      const eventData = JSON.parse(event.data) as AnalysisEvent;

      if (eventData.done === true) {
        eventSource.close();
        setIsAnalyzing(false);
        void queryClient.invalidateQueries({ queryKey: ["metrics", game.id] });
        void queryClient.invalidateQueries({ queryKey: ["alternatives", game.id] });
        return;
      }

      if (eventData.error !== undefined) {
        eventSource.close();
        setIsAnalyzing(false);
        console.error("Analysis error:", eventData.error);
        return;
      }

      // Skip non-rank-1 events for analysis-state updates.
      const rank = eventData.multipvRank ?? 1;
      if (rank !== 1) {
        return;
      }

      results.push({
        move_index: eventData.moveIndex,
        fen: eventData.fen,
        fen_key: null,
        move_san: eventData.moveSan ?? null,
        score_cp: eventData.scoreCp,
        score_mate: eventData.scoreMate,
        best_move: eventData.bestMove,
        pv: null,
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
  }, [game, analyzed, queryClient]);

  // Fetch top-3 alternatives for the current position when deep analysis is enabled.
  const { data: alts } = useQuery({
    queryKey: ["alternatives", game?.id ?? "", currentMove],
    queryFn: async () => fetchAlternatives(game?.id ?? "", currentMove),
    enabled: deepEnabled && game !== undefined,
  });

  // Pre-indexed scores: scores[moveIndex] → pawns. Built once when analysis changes.
  const scores = useMemo(() => {
    const arr: number[] = [];
    for (const a of analysis) {
      arr[a.move_index] = evalPawns(a);
    }
    return arr;
  }, [analysis]);

  // Pre-indexed mate distances: scoreMates[moveIndex] → mate count or null.
  const scoreMates = useMemo(() => {
    const arr: Array<number | null> = [];
    for (const a of analysis) {
      arr[a.move_index] = a.score_mate;
    }
    return arr;
  }, [analysis]);

  // Pre-indexed best moves: bestMoves[moveIndex] → UCI string (e.g. "e2e4").
  // Typed as (string | undefined)[] because the array is sparse (not every index has a value).
  const bestMoves = useMemo(() => {
    const arr: Array<string | undefined> = [];
    for (const a of analysis) {
      arr[a.move_index] = a.best_move;
    }
    return arr;
  }, [analysis]);

  const currentScore = scores[currentMove] ?? 0;
  const currentMate = scoreMates[currentMove] ?? null;

  // Arrow shapes for Stockfish's recommended best move(s) from the current position.
  // Rank-1 arrow is always blue; ranks 2 and 3 use paleBlue/green when deep analysis loaded.
  const bestMoveShapes = useMemo((): DrawShape[] => {
    const bm = bestMoves[currentMove];
    const shapes: DrawShape[] = [];
    if (bm !== undefined && bm.length >= 4) {
      shapes.push({ orig: bm.slice(0, 2) as Key, dest: bm.slice(2, 4) as Key, brush: "blue" });
    }
    if (alts !== undefined) {
      const brushes: string[] = ["blue", "paleBlue", "green"];
      for (const alt of alts.alternatives) {
        if (alt.multipvRank === 1) {
          continue; // already drawn above
        }
        const move = alt.bestMove;
        if (move.length >= 4) {
          shapes.push({
            orig: move.slice(0, 2) as Key,
            dest: move.slice(2, 4) as Key,
            brush: brushes[alt.multipvRank - 1] ?? "green",
          });
        }
      }
    }
    return shapes.length > 0 ? shapes : EMPTY_SHAPES;
  }, [bestMoves, currentMove, alts]);

  // Build eval data for graph — only recomputes when analysis changes.
  const evalData = useMemo(
    () =>
      [...analysis]
        .sort((a, b) => a.move_index - b.move_index)
        .map((a) => ({ moveIndex: a.move_index, score: evalPawns(a) })),
    [analysis],
  );

  // Precompute move classifications once — O(n) with a Map, not O(n²) per render.
  // moveClassifications[i] is the MoveClass for the move from position i to position i+1.
  const moveClassifications = useMemo(() => {
    if (analysis.length === 0) {
      return [] as MoveClass[];
    }
    const byIndex = new Map(analysis.map((a) => [a.move_index, a]));
    const classes: MoveClass[] = [];
    for (let i = 0; i < fens.length - 1; i++) {
      const before = byIndex.get(i);
      const after = byIndex.get(i + 1);
      if (before === undefined || after === undefined) {
        classes.push("good");
        continue;
      }
      const isWhiteMove = i % 2 === 0;
      // Convert cp to Win% from White's perspective, then adjust for mover.
      const wpBefore = cpToWp(isWhiteMove ? evalCp(before) : -evalCp(before));
      const wpAfter = cpToWp(isWhiteMove ? evalCp(after) : -evalCp(after));
      // wpDelta: how much the mover's Win% dropped (0 = no loss, 1 = total loss).
      const wpDelta = Math.max(0, wpBefore - wpAfter) / 100;
      classes.push(classifySwing(wpDelta));
    }
    return classes;
  }, [analysis, fens.length]);

  // Keep refs in sync so the keyboard handler sees the latest values each event.
  currentMoveRef.current = currentMove;
  classificationsRef.current = moveClassifications;

  // Stable SAN array so MoveList gets a consistent reference.
  const moveSans = useMemo(() => moves.map((m) => m.san), [moves]);

  // Last move highlight — stable reference prevents spurious ChessBoard effects.
  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    const prevMove = currentMove > 0 ? moves[currentMove - 1] : undefined;
    return prevMove !== undefined
      ? [prevMove.from, prevMove.to] as [Key, Key]
      : undefined;
  }, [currentMove, moves]);

  function goToNext(klass: MoveClass) {
    for (let i = currentMove; i < moveClassifications.length; i++) {
      if (moveClassifications[i] === klass) {
        setCurrentMove(Math.min(i + 1, maxMove));
        return;
      }
    }
  }

  function goToPrev(klass: MoveClass) {
    for (let i = currentMove - 2; i >= 0; i--) {
      if (moveClassifications[i] === klass) {
        setCurrentMove(i + 1);
        return;
      }
    }
  }

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

  // Player names relative to board orientation
  const topPlayerName = orientation === "white" ? game.black : game.white;
  const bottomPlayerName = orientation === "white" ? game.white : game.black;
  const topIsBlack = orientation === "white";
  const isSearchedUserTop = game.username.toLowerCase() === topPlayerName.toLowerCase();
  const isSearchedUserBottom = game.username.toLowerCase() === bottomPlayerName.toLowerCase();

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
            {metrics !== undefined && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 dark:text-gray-400">
                  Accuracy:
                </span>
                <span className={accuracyChipClass(metrics.white.accuracy)}>
                  {Math.round(metrics.white.accuracy)}% W
                </span>
                <span className={accuracyChipClass(metrics.black.accuracy)}>
                  {Math.round(metrics.black.accuracy)}% B
                </span>
                {(metrics.white.blunders > 0 || metrics.black.blunders > 0) && (
                  <span className="text-gray-500 dark:text-gray-400 ml-2">
                    Blunders:
                  </span>
                )}
                {metrics.white.blunders > 0 && (
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                    🔴 {metrics.white.blunders} W
                  </span>
                )}
                {metrics.black.blunders > 0 && (
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                    🔴 {metrics.black.blunders} B
                  </span>
                )}
              </div>
            )}
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
            <EvalBar score={currentScore} scoreMate={currentMate} orientation={orientation} />
          </div>

          {/* Board with player names */}
          <div className="flex flex-col h-full min-w-0">
            {/* Top player */}
            <div className="flex items-center gap-2 py-1">
              <div className={`w-3 h-3 rounded-full border border-gray-400 shrink-0 ${topIsBlack ? "bg-gray-800" : "bg-white"}`} />
              <span className={`text-sm truncate ${isSearchedUserTop ? "font-semibold text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400"}`}>
                {topPlayerName}
              </span>
            </div>
            {/* Chessground Board */}
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <div className="aspect-square h-full max-w-full">
                <ChessBoard fen={fens[currentMove]} lastMove={lastMove} autoShapes={bestMoveShapes} orientation={orientation} />
              </div>
            </div>
            {/* Bottom player */}
            <div className="flex items-center gap-2 py-1">
              <div className={`w-3 h-3 rounded-full border border-gray-400 shrink-0 ${topIsBlack ? "bg-white" : "bg-gray-800"}`} />
              <span className={`text-sm truncate ${isSearchedUserBottom ? "font-semibold text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400"}`}>
                {bottomPlayerName}
              </span>
            </div>
          </div>

          {/* Move List */}
          <div className="overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
            <MoveList
              moves={moveSans}
              currentMove={currentMove}
              onSelectMove={setCurrentMove}
              classifications={moveClassifications}
              motifs={data.motifs}
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
            type="button"
            onClick={() => setCurrentMove(0)}
            className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          >
            &laquo;
          </button>
          <button
            type="button"
            onClick={() => setCurrentMove(Math.max(0, currentMove - 1))}
            className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          >
            &lsaquo;
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400 min-w-[80px] text-center">
            {currentMove} / {maxMove}
          </span>
          <button
            type="button"
            onClick={() => setCurrentMove(Math.min(maxMove, currentMove + 1))}
            className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          >
            &rsaquo;
          </button>
          <button
            type="button"
            onClick={() => setCurrentMove(maxMove)}
            className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          >
            &raquo;
          </button>
          <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
          <button
            type="button"
            onClick={() => setUserFlipped((f) => !f)}
            className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            title="Flip board"
          >
            &#x21C5;
          </button>
        </div>

        {/* Blunder / Mistake navigation — only when analysis is available */}
        {moveClassifications.length > 0 && (
          <div className="mt-2 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => { goToPrev("blunder"); }}
              className="px-2 py-1 text-xs rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
              title="Previous blunder (Shift+B)"
            >
              &larr; Blunder
            </button>
            <button
              type="button"
              onClick={() => { goToNext("blunder"); }}
              className="px-2 py-1 text-xs rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
              title="Next blunder (B)"
            >
              Blunder &rarr;
            </button>
            <button
              type="button"
              onClick={() => { goToPrev("mistake"); }}
              className="px-2 py-1 text-xs rounded bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
              title="Previous mistake (Shift+M)"
            >
              &larr; Mistake
            </button>
            <button
              type="button"
              onClick={() => { goToNext("mistake"); }}
              className="px-2 py-1 text-xs rounded bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
              title="Next mistake (M)"
            >
              Mistake &rarr;
            </button>
          </div>
        )}

        {/* Recurrence Panel — shows prior games where this position was reached */}
        {analyzed && currentMove < fens.length && (
          <RecurrencePanel
            fen={fens[currentMove]}
            username={game.username}
            currentGameId={game.id}
          />
        )}

        {/* Alternatives Panel — top engine lines for the current position (deep analysis) */}
        {deepEnabled && (
          <AlternativesPanel
            gameId={game.id}
            moveIndex={currentMove}
            playedMove={moves[currentMove - 1]?.san}
          />
        )}
      </main>
    </div>
  );
}

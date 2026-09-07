import { useState, useEffect, useRef, useMemo, startTransition } from "react";
import { useParams, useSearchParams, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { Clock, AlertTriangle } from "lucide-react";
import { fetchGame, fetchGameMetrics, fetchAlternatives, type AnalysisRow, type GameMove, type GameMetrics, type PerSideMetrics } from "../api";
import { ChessBoard } from "../components/ChessBoard";
import { EvalBar } from "../components/EvalBar";
import { EvalGraph } from "../components/EvalGraph";
import { MoveList } from "../components/MoveList";
import { RecurrencePanel } from "../components/RecurrencePanel";
import { AlternativesPanel } from "../components/AlternativesPanel";
import { MetricsCard } from "../components/MetricsCard";
import { MoveScrubber } from "../components/MoveScrubber";
import { GameReviewSummary } from "../components/GameReviewSummary";
import { Chip, type ChipTone } from "../components/ui/Chip";
import { Tabs } from "../components/ui/Tabs";
import { classifySwing, type MoveClass } from "../lib/classify";

type RailTab = "moves" | "report" | "engine" | "history";

const RAIL_TABS = [
  { id: "moves", label: "Moves" },
  { id: "report", label: "Report" },
  { id: "engine", label: "Engine" },
  { id: "history", label: "History" },
];

function accuracyTone(acc: number): ChipTone {
  if (acc >= 90) {return "win";}
  if (acc >= 70) {return "inaccuracy";}
  return "loss";
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
  phase?: "shallow" | "deep";
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
  const [phase, setPhase] = useState<"shallow" | "deep" | null>(null);
  const [userFlipped, setUserFlipped] = useState(false);
  // Deep analysis (MultiPV=3) runs by default — top-3 arrows + AlternativesPanel
  // are visible from the moment a new game is opened, and the engine persists
  // rank 2/3 to the analysis table for later reuse.
  const [deepEnabled] = useState(true);
  const [railTab, setRailTab] = useState<RailTab>("moves");

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

  // User color — drives the "only count my mistakes" nav. Transition i is the
  // user's move when (i % 2 === 0) matches (userColor === "white").
  const userColor: "white" | "black" =
    game !== undefined && game.username.toLowerCase() === game.black.toLowerCase()
      ? "black"
      : "white";
  const userIsWhite = userColor === "white";

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
      const isUserMove = (i: number): boolean => (i % 2 === 0) === userIsWhite;
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        const classes = classificationsRef.current;
        const cur = currentMoveRef.current;
        if (e.shiftKey) {
          for (let i = cur - 2; i >= 0; i--) {
            if (classes[i] === "blunder" && isUserMove(i)) {
              setCurrentMove(i + 1);
              return;
            }
          }
        } else {
          for (let i = cur; i < classes.length; i++) {
            if (classes[i] === "blunder" && isUserMove(i)) {
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
            if (classes[i] === "mistake" && isUserMove(i)) {
              setCurrentMove(i + 1);
              return;
            }
          }
        } else {
          for (let i = cur; i < classes.length; i++) {
            if (classes[i] === "mistake" && isUserMove(i)) {
              setCurrentMove(Math.min(i + 1, maxMove));
              return;
            }
          }
        }
      }
      if (e.key.toLowerCase() === "x") {
        // "Missed conversion" — opponent blundered, user failed to capitalize.
        e.preventDefault();
        const missed = missedConversionsRef.current;
        const cur = currentMoveRef.current;
        if (e.shiftKey) {
          for (let i = cur - 2; i >= 0; i--) {
            if (missed[i]) {
              setCurrentMove(i + 1);
              return;
            }
          }
        } else {
          for (let i = cur; i < missed.length; i++) {
            if (missed[i]) {
              setCurrentMove(Math.min(i + 1, maxMove));
              return;
            }
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, [maxMove, fens.length, userIsWhite]);

  // Refs so keyboard handler always sees latest values without re-registering.
  // Declared here (before the keyboard useEffect) to satisfy rules-of-hooks order.
  // The .current assignments happen after moveClassifications is computed below.
  const currentMoveRef = useRef(currentMove);
  const classificationsRef = useRef<MoveClass[]>([]);
  const missedConversionsRef = useRef<boolean[]>([]);

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
    setPhase("shallow");

    // Two-phase SSE: server streams shallow (MultiPV=1, ~150ms/pos) then deep
    // (MultiPV=3, full movetime). Deep events overwrite shallow rows by
    // move_index. Keyed Map keeps state in sync without push/replace logic.
    const resultsByIndex = new Map<number, AnalysisRow>();
    let currentPhase: "shallow" | "deep" = "shallow";
    const eventSource = new EventSource(`/api/analyze/${game.id}?multipv=3`);

    eventSource.onmessage = (event: MessageEvent<string>) => {
      const eventData = JSON.parse(event.data) as AnalysisEvent;

      if (eventData.done === true) {
        eventSource.close();
        setIsAnalyzing(false);
        setPhase(null);
        // Refetch the game so `analyzed` flips true — this is what enables the
        // metrics query (and thus the accuracy strip) without a page reload.
        void queryClient.invalidateQueries({ queryKey: ["game", game.id] });
        void queryClient.invalidateQueries({ queryKey: ["metrics", game.id] });
        void queryClient.invalidateQueries({ queryKey: ["metricDetail", game.id] });
        void queryClient.invalidateQueries({ queryKey: ["alternatives", game.id] });
        return;
      }

      if (eventData.error !== undefined) {
        eventSource.close();
        setIsAnalyzing(false);
        setPhase(null);
        console.error("Analysis error:", eventData.error);
        return;
      }

      // Phase transition — reset progress when deep starts after shallow.
      const evPhase = eventData.phase ?? "deep";
      if (evPhase !== currentPhase) {
        currentPhase = evPhase;
        setPhase(evPhase);
        setProgress(0);
      }

      // Skip non-rank-1 events for analysis-state updates (rank 2/3 fed via AlternativesPanel).
      const rank = eventData.multipvRank ?? 1;
      if (rank !== 1) {
        return;
      }

      resultsByIndex.set(eventData.moveIndex, {
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
        setAnalysis(
          [...resultsByIndex.values()].sort((a, b) => a.move_index - b.move_index),
        );
      });
      setProgress(((eventData.moveIndex + 1) / eventData.total) * 100);
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsAnalyzing(false);
      setPhase(null);
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

  // "Missed conversion" — user followed an opponent blunder without playing
  // near-best. Only flagged on the user's transitions. Length matches
  // moveClassifications so indices align.
  const missedConversions = useMemo(() => {
    const missed: boolean[] = [];
    for (let i = 0; i < moveClassifications.length; i++) {
      const isUserMove = (i % 2 === 0) === userIsWhite;
      const prevWasOppBlunder = i > 0 && moveClassifications[i - 1] === "blunder";
      const userNotBest = moveClassifications[i] !== "best";
      missed.push(isUserMove && prevWasOppBlunder && userNotBest);
    }
    return missed;
  }, [moveClassifications, userIsWhite]);

  // Keep refs in sync so the keyboard handler sees the latest values each event.
  currentMoveRef.current = currentMove;
  classificationsRef.current = moveClassifications;
  missedConversionsRef.current = missedConversions;

  // Stable SAN array so MoveList gets a consistent reference.
  const moveSans = useMemo(() => moves.map((m) => m.san), [moves]);

  // Last move highlight — stable reference prevents spurious ChessBoard effects.
  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    const prevMove = currentMove > 0 ? moves[currentMove - 1] : undefined;
    return prevMove !== undefined
      ? [prevMove.from, prevMove.to] as [Key, Key]
      : undefined;
  }, [currentMove, moves]);

  function isUserMoveIdx(i: number): boolean {
    return (i % 2 === 0) === userIsWhite;
  }

  function goToNext(klass: MoveClass) {
    for (let i = currentMove; i < moveClassifications.length; i++) {
      if (moveClassifications[i] === klass && isUserMoveIdx(i)) {
        setCurrentMove(Math.min(i + 1, maxMove));
        return;
      }
    }
  }

  function goToPrev(klass: MoveClass) {
    for (let i = currentMove - 2; i >= 0; i--) {
      if (moveClassifications[i] === klass && isUserMoveIdx(i)) {
        setCurrentMove(i + 1);
        return;
      }
    }
  }

  function goToNextMissed() {
    for (let i = currentMove; i < missedConversions.length; i++) {
      if (missedConversions[i]) {
        setCurrentMove(Math.min(i + 1, maxMove));
        return;
      }
    }
  }

  function goToPrevMissed() {
    for (let i = currentMove - 2; i >= 0; i--) {
      if (missedConversions[i]) {
        setCurrentMove(i + 1);
        return;
      }
    }
  }

  if (isPending) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-muted">Loading game...</p>
      </div>
    );
  }

  if (isError || game === undefined) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-fg">Game not found</h1>
          <Link to="/" className="mt-2 inline-block text-accent hover:text-accent-hover">
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
  const topClock = orientation === "white" ? game.blackClockFinalS : game.whiteClockFinalS;
  const bottomClock = orientation === "white" ? game.whiteClockFinalS : game.blackClockFinalS;

  function fmtClock(secs: number): string {
    const total = Math.max(0, Math.floor(secs));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, "0");
    if (h > 0) {return `${String(h)}:${String(m).padStart(2, "0")}:${ss}`;}
    return `${String(m)}:${ss}`;
  }

  const lostOnTime =
    typeof game.termination === "string" &&
    game.termination.toLowerCase().includes("on time");

  // Per-side metric accessors for the always-visible accuracy strip.
  let userMetricsSide: PerSideMetrics | null = null;
  let oppMetricsSide: PerSideMetrics | null = null;
  if (metrics !== undefined) {
    userMetricsSide = userIsWhite ? metrics.white : metrics.black;
    oppMetricsSide = userIsWhite ? metrics.black : metrics.white;
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      {/* Game header strip */}
      <header className="shrink-0 border-b border-line bg-surface px-4 py-2">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link to="/" className="text-sm text-muted hover:text-fg">
            &larr; Back
          </Link>
          <span className="font-semibold text-fg">
            {game.white} vs {game.black}
          </span>
          <Chip tone="neutral">{game.result}</Chip>
          <span className="text-sm capitalize text-muted">{game.timeClass}</span>
          {lostOnTime && (
            <Chip tone="info" icon={<Clock size={11} />} title={game.termination ?? "Won on time"}>
              on time
            </Chip>
          )}
          {isAnalyzing && (
            <div className="ml-auto flex items-center gap-2">
              {phase !== null && (
                <span className="text-xs uppercase tracking-wide text-muted">
                  {phase === "shallow" ? "Quick scan" : "Deepening"}
                </span>
              )}
              <div className="h-2 w-32 overflow-hidden rounded-full bg-raised">
                <div
                  className={`h-full transition-all duration-300 ${phase === "shallow" ? "bg-inaccuracy" : "bg-accent"}`}
                  style={{ width: `${progressStr}%` }}
                />
              </div>
              <span className="text-sm text-muted">{progressStr}%</span>
            </div>
          )}
        </div>
      </header>

      {/* No-scroll main: eval bar | board column | tabbed rail */}
      <div className="mx-auto min-h-0 w-full max-w-7xl flex-1 px-4 py-3">
        <div className="grid h-full grid-cols-[auto_1fr_360px] gap-4">
          {/* Eval Bar */}
          <div className="h-full w-8">
            <EvalBar score={currentScore} scoreMate={currentMate} orientation={orientation} />
          </div>

          {/* Board column */}
          <div className="flex min-w-0 flex-col gap-2">
            {/* Top player */}
            <div className="flex shrink-0 items-center gap-2">
              <div className={`h-3 w-3 shrink-0 rounded-full border border-line ${topIsBlack ? "bg-canvas" : "bg-fg"}`} />
              <span className={`truncate text-sm ${isSearchedUserTop ? "font-semibold text-fg" : "text-muted"}`}>
                {topPlayerName}
              </span>
              {typeof topClock === "number" && (
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 font-mono text-xs ${
                    topClock <= 0.1 ? "bg-loss/15 text-loss" : "bg-raised text-muted"
                  }`}
                  title={topClock <= 0.1 ? "Flagged — ran out of time" : "Final clock"}
                >
                  {fmtClock(topClock)}
                </span>
              )}
            </div>
            {/* Board */}
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="aspect-square h-full max-w-full">
                <ChessBoard fen={fens[currentMove]} lastMove={lastMove} autoShapes={bestMoveShapes} orientation={orientation} />
              </div>
            </div>
            {/* Bottom player */}
            <div className="flex shrink-0 items-center gap-2">
              <div className={`h-3 w-3 shrink-0 rounded-full border border-line ${topIsBlack ? "bg-fg" : "bg-canvas"}`} />
              <span className={`truncate text-sm ${isSearchedUserBottom ? "font-semibold text-fg" : "text-muted"}`}>
                {bottomPlayerName}
              </span>
              {typeof bottomClock === "number" && (
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 font-mono text-xs ${
                    bottomClock <= 0.1 ? "bg-loss/15 text-loss" : "bg-raised text-muted"
                  }`}
                  title={bottomClock <= 0.1 ? "Flagged — ran out of time" : "Final clock"}
                >
                  {fmtClock(bottomClock)}
                </span>
              )}
            </div>

            {/* Eval graph strip */}
            {evalData.length > 0 && (
              <div className="h-24 shrink-0 rounded-lg border border-line bg-surface p-2">
                <EvalGraph data={evalData} currentMove={currentMove} onSelectMove={setCurrentMove} />
              </div>
            )}

            {/* Move scrubber — draggable timeline with blunder/mistake ticks */}
            <MoveScrubber
              currentMove={currentMove}
              maxMove={maxMove}
              onSelect={setCurrentMove}
              onFlip={() => { setUserFlipped((f) => !f); }}
              classifications={moveClassifications}
              userIsWhite={userIsWhite}
            />

            {/* Blunder / Mistake / Missed jump nav (user moves only) */}
            {moveClassifications.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={() => { goToPrev("blunder"); }} className="rounded bg-blunder/15 px-2 py-1 text-xs font-semibold text-blunder" title="Previous blunder (Shift+B) — my moves only">&larr; Blunder</button>
                <button type="button" onClick={() => { goToNext("blunder"); }} className="rounded bg-blunder/15 px-2 py-1 text-xs font-semibold text-blunder" title="Next blunder (B) — my moves only">Blunder &rarr;</button>
                <button type="button" onClick={() => { goToPrev("mistake"); }} className="rounded bg-mistake/15 px-2 py-1 text-xs font-semibold text-mistake" title="Previous mistake (Shift+M) — my moves only">&larr; Mistake</button>
                <button type="button" onClick={() => { goToNext("mistake"); }} className="rounded bg-mistake/15 px-2 py-1 text-xs font-semibold text-mistake" title="Next mistake (M) — my moves only">Mistake &rarr;</button>
                <button type="button" onClick={goToPrevMissed} className="rounded bg-inaccuracy/15 px-2 py-1 text-xs font-semibold text-inaccuracy" title="Previous missed conversion (Shift+X) — opponent blundered, I didn't punish">&larr; Missed</button>
                <button type="button" onClick={goToNextMissed} className="rounded bg-inaccuracy/15 px-2 py-1 text-xs font-semibold text-inaccuracy" title="Next missed conversion (X) — opponent blundered, I didn't punish">Missed &rarr;</button>
              </div>
            )}
          </div>

          {/* Tabbed rail */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
            {/* Always-visible accuracy + clickable blunder jump */}
            {userMetricsSide !== null && oppMetricsSide !== null && (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line p-2 text-xs">
                <span className="text-muted">Acc</span>
                <Chip tone={accuracyTone(userMetricsSide.accuracy)}>
                  {Math.round(userMetricsSide.accuracy)}% you
                </Chip>
                <Chip tone={accuracyTone(oppMetricsSide.accuracy)}>
                  {Math.round(oppMetricsSide.accuracy)}% opp
                </Chip>
                {userMetricsSide.blunders > 0 && (
                  <button
                    type="button"
                    onClick={() => { goToNext("blunder"); }}
                    title="Jump to next blunder (B)"
                    className="rounded-full transition-transform hover:scale-105"
                  >
                    <Chip tone="blunder" icon={<AlertTriangle size={11} />}>
                      {userMetricsSide.blunders} blunder{userMetricsSide.blunders === 1 ? "" : "s"} &rarr;
                    </Chip>
                  </button>
                )}
              </div>
            )}

            {/* Always-visible review digest: quality, Elo, top critical moves */}
            <GameReviewSummary gameId={game.id} onSelectMove={setCurrentMove} />

            <Tabs
              tabs={RAIL_TABS}
              active={railTab}
              onChange={(id) => { setRailTab(id as RailTab); }}
              className="shrink-0"
            />

            {railTab === "moves" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <MoveList
                    moves={moveSans}
                    currentMove={currentMove}
                    onSelectMove={setCurrentMove}
                    classifications={moveClassifications}
                    motifs={data.motifs}
                    missedConversions={missedConversions}
                    userIsWhite={userIsWhite}
                  />
                </div>
              </div>
            )}

            {railTab === "report" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <MetricsCard gameId={game.id} />
              </div>
            )}

            {railTab === "engine" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <AlternativesPanel
                  gameId={game.id}
                  moveIndex={currentMove}
                  playedMove={moves[currentMove - 1]?.san}
                />
              </div>
            )}

            {railTab === "history" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {analyzed && currentMove < fens.length ? (
                  <RecurrencePanel
                    fen={fens[currentMove]}
                    username={game.username}
                    currentGameId={game.id}
                  />
                ) : (
                  <p className="text-sm text-muted">No position history available.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

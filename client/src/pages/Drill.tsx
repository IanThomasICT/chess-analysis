import { useState, useRef, useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDrillQueue,
  submitDrillAttempt,
  type DrillCard,
  type AttemptResponse,
} from "../api";
import { ChessBoard } from "../components/ChessBoard";
import { useSettings } from "../context/Settings";

interface SessionStats {
  attempted: number;
  correct: number;
}

export function Drill() {
  const { username } = useSettings();
  const queryClient = useQueryClient();

  const { data: queue, isPending, isError } = useQuery({
    queryKey: ["drill", "queue", username],
    queryFn: async () => fetchDrillQueue(username, 20),
    enabled: username !== "",
  });

  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<AttemptResponse | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats>({ attempted: 0, correct: 0 });
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    setFeedback(null);
    startTimeRef.current = Date.now();
  }, [index]);

  const attempt = useMutation({
    mutationFn: async (uci: string) =>
      submitDrillAttempt({
        username,
        game_id: queue?.[index]?.game_id ?? "",
        move_index: queue?.[index]?.move_index ?? 0,
        attempted_move: uci,
        elapsed_ms: Date.now() - startTimeRef.current,
      }),
    onSuccess: (data) => {
      setFeedback(data);
      setSessionStats((s) => ({
        attempted: s.attempted + 1,
        correct: s.correct + (data.correct ? 1 : 0),
      }));
      void queryClient.invalidateQueries({ queryKey: ["drill", "queue", username] });
    },
  });

  if (username === "") {
    return (
      <FullScreenMessage>
        <p>Username required. Load games from the Games page first.</p>
      </FullScreenMessage>
    );
  }
  if (isPending) {
    return <FullScreenMessage>Loading drill queue…</FullScreenMessage>;
  }
  if (isError) {
    return <FullScreenMessage>Error loading drill queue.</FullScreenMessage>;
  }
  if (queue.length === 0) {
    return (
      <FullScreenMessage>
        <p className="mb-2">No drill positions available.</p>
        <p className="text-xs text-muted">Analyze more games to surface blunders for review.</p>
      </FullScreenMessage>
    );
  }

  if (index >= queue.length) {
    return (
      <FullScreenMessage>
        <p className="mb-2 text-lg font-semibold text-fg">Session complete</p>
        <p className="text-sm text-muted">{sessionStats.correct} / {sessionStats.attempted} correct</p>
        <Link
          to={`/?username=${encodeURIComponent(username)}`}
          className="mt-2 inline-block text-accent hover:text-accent-hover"
        >
          &larr; Back to Games
        </Link>
      </FullScreenMessage>
    );
  }

  const card: DrillCard = queue[index];
  const turn = card.fen.split(" ")[1] === "w" ? "white" : "black";

  function handleMove(orig: string, dest: string, promotion?: string) {
    if (feedback !== null || attempt.isPending) {
      return;
    }
    const uci = `${orig}${dest}${promotion ?? ""}`;
    attempt.mutate(uci);
  }

  function nextCard() {
    setIndex((i) => i + 1);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-fg">Drill — {username}</h1>
        <div className="font-mono text-sm text-muted">
          {sessionStats.correct} / {sessionStats.attempted} correct · card {index + 1} of {queue.length}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        <div className="text-sm text-muted">
          {turn === "white" ? "White" : "Black"} to move — find the best move.
          {card.motifs.length > 0 && (
            <span className="ml-2 text-info">
              ({card.motifs.join(", ").replace(/_/g, " ")})
            </span>
          )}
        </div>
        <div className="aspect-square w-full max-w-md">
          <ChessBoard
            fen={card.fen}
            interactive={feedback === null && !attempt.isPending}
            onMove={handleMove}
            orientation={turn}
          />
        </div>

        {feedback !== null && (
          <div
            className={`rounded px-3 py-2 text-sm ${
              feedback.correct ? "bg-win/15 text-win" : "bg-loss/15 text-loss"
            }`}
          >
            {feedback.correct ? "Best move!" : `Not best — engine plays ${feedback.best_move}.`}
          </div>
        )}

        {feedback !== null && (
          <button
            type="button"
            onClick={nextCard}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Next &rarr;
          </button>
        )}
      </div>
    </div>
  );
}

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
      <div className="text-center text-fg">{children}</div>
    </div>
  );
}

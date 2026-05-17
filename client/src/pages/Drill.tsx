import { useState, useRef, useEffect, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDrillQueue,
  submitDrillAttempt,
  type DrillCard,
  type AttemptResponse,
} from "../api";
import { ChessBoard } from "../components/ChessBoard";

interface SessionStats {
  attempted: number;
  correct: number;
}

export function Drill() {
  const [searchParams] = useSearchParams();
  const username = searchParams.get("username") ?? "";
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

  // Reset feedback + timer when moving to next card
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
      // Invalidate the queue so the next card list reflects FSRS state
      void queryClient.invalidateQueries({ queryKey: ["drill", "queue", username] });
    },
  });

  if (username === "") {
    return (
      <FullScreenMessage>
        <p>Username required. Open Drill via the Home page after loading games.</p>
      </FullScreenMessage>
    );
  }
  if (isPending) {
    return <FullScreenMessage>Loading drill queue&#8230;</FullScreenMessage>;
  }
  if (isError) {
    return <FullScreenMessage>Error loading drill queue.</FullScreenMessage>;
  }
  if (queue.length === 0) {
    return (
      <FullScreenMessage>
        <p className="mb-2">No drill positions available.</p>
        <p className="text-xs text-gray-500">Analyze more games to surface blunders for review.</p>
      </FullScreenMessage>
    );
  }

  if (index >= queue.length) {
    return (
      <FullScreenMessage>
        <p className="text-lg font-semibold mb-2">Session complete</p>
        <p className="text-sm text-gray-600">{sessionStats.correct} / {sessionStats.attempted} correct</p>
        <Link
          to={`/?username=${encodeURIComponent(username)}`}
          className="text-blue-600 hover:underline mt-2 inline-block"
        >
          &#8592; Back to Home
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to={`/?username=${encodeURIComponent(username)}`}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              &#8592; Back
            </Link>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Drill &#8212; {username}</h1>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {sessionStats.correct} / {sessionStats.attempted} correct &middot; card {index + 1} of {queue.length}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex flex-col items-center gap-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {turn === "white" ? "White" : "Black"} to move &#8212; find the best move.
            {card.motifs.length > 0 && (
              <span className="ml-2 text-purple-600 dark:text-purple-300">
                ({card.motifs.join(", ").replace(/_/g, " ")})
              </span>
            )}
          </div>
          <div className="w-full max-w-md aspect-square">
            <ChessBoard
              fen={card.fen}
              interactive={feedback === null && !attempt.isPending}
              onMove={handleMove}
              orientation={turn}
            />
          </div>

          {feedback !== null && (
            <div
              className={`p-3 rounded text-sm ${
                feedback.correct
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
              }`}
            >
              {feedback.correct ? "Best move!" : `Not best &#8212; engine plays ${feedback.best_move}.`}
            </div>
          )}

          {feedback !== null && (
            <button
              type="button"
              onClick={nextCard}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
            >
              Next &#8594;
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-center text-gray-700 dark:text-gray-300">{children}</div>
    </div>
  );
}

export type Metric = "Win rate" | "Accuracy" | "Elo" | "Review velocity";

export interface GlossaryEntry {
  /** URL-safe anchor (e.g. "acl", "multipv"). */
  id: string;
  term: string;
  /** Alternate names matched by the filter input. */
  aliases?: string[];
  /** One-sentence plain-English explanation. */
  plain: string;
  /** Fuller explanation — paragraphs separated by \n\n. */
  detail: string;
  /** Where it appears in the app (free-form). */
  where: string;
  /** Optional deep link into the app. Skip when no single canonical surface. */
  link?: string;
  /** Vision metric this term serves (per docs/core.md). */
  metric: Metric;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: "accuracy",
    term: "Accuracy",
    aliases: ["accuracy score"],
    plain: "A 0–100 score per game. Above 90 = very clean. Below 70 = lots of mistakes.",
    detail:
      "Lichess-style accuracy. For each move, your eval before and after the move is converted to a Win% (sigmoid of centipawns). The drop in Win% feeds a formula that gives the move a 0–100 score. Game accuracy is the mean of move scores per side.\n\nLower swing → higher accuracy. A move that loses 30 percentage points of Win% scores near zero; a move that doesn't change the eval scores near 100.",
    where: "GameCard chip on Home; the header chip on the Analysis page; the Accuracy trend tab on Stats.",
    link: "/stats",
    metric: "Accuracy",
  },
  {
    id: "blunder-mistake-inaccuracy",
    term: "Blunder / Mistake / Inaccuracy",
    aliases: ["classification", "swing"],
    plain: "Three tiers of bad move, by how much Win% you dropped on that move.",
    detail:
      "Thresholds on Win% drop (mover's perspective):\n\n• Inaccuracy — dropped at least 10 percentage points.\n• Mistake — dropped at least 20 points.\n• Blunder — dropped at least 30 points.\n\nMoves below 10 points are 'good'; very close to engine top = 'best'. These thresholds match Lichess.",
    where: "Color-coded move chips on the Analysis MoveList. Counts on GameCards and the Stats > By Side panel.",
    link: "/stats",
    metric: "Accuracy",
  },
  {
    id: "acl",
    term: "ACL (Average Centipawn Loss)",
    aliases: ["centipawn loss", "cp loss"],
    plain: "Industry-standard accuracy measure. Lower is better; 100 cp ≈ one pawn lost.",
    detail:
      "For each of your moves, the engine measures how much eval you threw away (positive only — opponent blunders don't help your number). ACL is the mean across all of your non-opening moves.\n\nOpening book plies (first 8) are skipped — they're not your choices so they shouldn't pollute the average.\n\nThe app uses the underlying accuracy score for the trend chart on Stats, since 0–100 is more intuitive than 'centipawns lost' — but the metric is the same family.",
    where: "Computed alongside accuracy; not displayed as its own chart (the Accuracy trend chart serves the same purpose).",
    metric: "Accuracy",
  },
  {
    id: "motif",
    term: "Motif",
    aliases: ["pattern", "tag"],
    plain: "The kind of mistake: hung piece, missed fork, missed mate, back-rank, pin, skewer.",
    detail:
      "When you blunder or make a mistake, the app inspects the position and tags the move with a motif (a recognizable tactical pattern). The six motifs in v1:\n\n• missed_mate — you had mate-in-N and missed it\n• back_rank_mate — engine's reply ends in mate on rank 1/8\n• fork — engine's best move attacks two of your pieces of value ≥ 3\n• pin — engine's best move pins a piece against a more valuable piece behind it\n• skewer — same idea, reversed (closer piece is more valuable)\n• hanging_piece — your piece is attacked with no equal-or-greater defender\n\nA position can have up to 3 motif tags. They're priority-ordered (missed_mate > back_rank_mate > fork > pin > skewer > hanging_piece).",
    where: "Single-letter chips next to moves in the Analysis MoveList. Aggregated on the Stats > Motifs tab with example deep-links.",
    link: "/stats",
    metric: "Accuracy",
  },
  {
    id: "drill",
    term: "Drill",
    aliases: ["puzzles", "spaced repetition"],
    plain: "Anki-style flashcards built from your own past blunders. You have to find the move you should have played.",
    detail:
      "Reading 'you blundered Nxf6' doesn't train pattern-recognition. Solving the position cold — board only, no eval, no hints — does.\n\nThe drill queue surfaces two kinds of cards: blunder positions you've never seen as a card before (new), and ones the scheduler has marked due for review (due). Drag a piece to submit your answer. Feedback shows whether you matched the engine's best move; the scheduler then sets the next review interval.",
    where: "The /drill page. Session stats and streak on Stats > Drill.",
    link: "/drill",
    metric: "Accuracy",
  },
  {
    id: "fsrs",
    term: "FSRS",
    aliases: ["spaced repetition", "scheduling"],
    plain: "The algorithm that decides when to show a drill card again.",
    detail:
      "FSRS (Free Spaced Repetition Scheduler) tracks the difficulty of each card and how reliably you remember it. After each attempt it sets the next due date:\n\n• Wrong → reschedule in ~10 minutes (Again rating)\n• Correct under 30s → reschedule in days (Good rating)\n• Correct over 30s → reschedule sooner than Good (Hard rating)\n\nSame family of algorithms as Anki — modernized. The app uses default parameters; no per-user tuning needed at this scale.",
    where: "Determines the order of the /drill queue and the due_today / streak numbers on Stats > Drill.",
    link: "/drill",
    metric: "Accuracy",
  },
  {
    id: "multipv",
    term: "MultiPV / Deep analysis",
    aliases: ["alternatives", "top moves"],
    plain: "Engine returns its top 3 candidate moves instead of just the best one. Helps you understand why a move is best.",
    detail:
      "Normal analysis tells you 'best move was Bxh7+'. Deep analysis tells you 'Bxh7+ is +2.1, Qd2 is +0.5, Nf3 is +0.4' — so you can see whether the best move was a clear standout or a tight choice.\n\nDeep analysis spends roughly 3× the search time per position. It's opt-in via the 'Deep analysis' button on the Analysis page. Top-3 arrows render on the board (blue / paleBlue / green by rank) and an Alternatives panel lists the lines with evals.",
    where: "The 'Deep analysis' button on the Analysis page and the AlternativesPanel that appears once it's enabled.",
    metric: "Accuracy",
  },
  {
    id: "pv",
    term: "Principal Variation (PV)",
    aliases: ["line", "engine line"],
    plain: "The engine's forecast: 'if this then that then this then that…' — its best-play sequence from this position.",
    detail:
      "Each engine line ends with a PV — a space-separated sequence of UCI moves the engine expects to follow if everyone plays best. Useful for seeing the tactical idea behind a move (e.g. 'Bxh7+ Kxh7 Ng5+' for a Greek-gift sacrifice).\n\nIn MultiPV mode, each of the top 3 lines has its own PV.",
    where: "The AlternativesPanel on the Analysis page lists each line's PV.",
    metric: "Accuracy",
  },
  {
    id: "fen",
    term: "FEN",
    aliases: ["position string", "fen_key", "transposition"],
    plain: "A text snapshot of a chess position. The app uses it to detect when the same position came up in multiple games.",
    detail:
      "A FEN encodes piece placement, side to move, castling rights, en passant target, and halfmove counters in one string. Example: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' (the starting position).\n\nFor recurrence matching the app uses 'fen_key' — the first four space-separated fields — so positions that differ only in clock counters still match.",
    where: "The Position recurrence panel on the Analysis page (under the board) — shows other games where this position appeared, with a red dot if you blundered there.",
    metric: "Review velocity",
  },
  {
    id: "eco",
    term: "ECO / Opening name",
    aliases: ["opening", "eco code"],
    plain: "A code (A00–E99) and human name (Sicilian Defense, Caro-Kann, …) for the opening played in a game.",
    detail:
      "Every game gets an ECO and an opening name. They come from the PGN headers when Chess.com supplies them; otherwise the app matches the move sequence against a bundled list of ~3700 named openings (lichess-org/chess-openings, CC0).\n\nThe by-opening slice on Stats answers 'which openings win for me and which don't' — strong signal for what to study next.",
    where: "Stats > By Opening tab; surfaced indirectly in the win-rate slice charts.",
    link: "/stats",
    metric: "Win rate",
  },
  {
    id: "lc0",
    term: "Lc0 / cudnn-fp16",
    aliases: ["leela", "neural engine", "engine backend"],
    plain: "An optional neural-network chess engine the app can use instead of Stockfish. Off by default — you don't need it.",
    detail:
      "Lc0 (Leela Chess Zero) is a strong, neural-net-based engine. It plays more 'positionally' than Stockfish, which is sharper tactically. For blunder-hunting Stockfish is the better critic — Lc0 is an option only if you want a second opinion for strategic re-analysis.\n\nLc0 needs a weights file and a backend setting. cudnn-fp16 means 'use the NVIDIA GPU with half-precision floats' — irrelevant unless you have an NVIDIA GPU and have Lc0 installed.\n\nControlled by env vars (ENGINE_TYPE=lc0, WEIGHTS_PATH, ENGINE_BACKEND). Default behaviour is Stockfish; ignore this entirely unless you're experimenting.",
    where: "Advanced — env-driven only. No UI surface.",
    metric: "Accuracy",
  },
];

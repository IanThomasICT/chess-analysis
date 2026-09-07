import { Chess } from "chess.js";

export interface MoveInfo {
  san: string;
  from: string;
  to: string;
  fen: string;
}

/**
 * Parse a PGN string and return an array of FENs (starting from the initial position).
 */
export function pgnToFens(pgn: string): string[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  const fens: string[] = [];
  const replay = new Chess();
  fens.push(replay.fen()); // starting position

  for (const move of history) {
    replay.move(move.san);
    fens.push(replay.fen());
  }

  return fens;
}

/**
 * Parse a PGN string and return detailed move information.
 */
export function pgnToMoves(pgn: string): MoveInfo[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  const moves: MoveInfo[] = [];
  const replay = new Chess();

  for (const move of history) {
    replay.move(move.san);
    moves.push({
      san: move.san,
      from: move.from,
      to: move.to,
      fen: replay.fen(),
    });
  }

  return moves;
}

/**
 * Parse all PGN header tags and return them as a key→value record.
 * Matches lines of the form [Key "Value"]. Returns {} if no headers are found.
 */
export type PgnHeaders = Partial<Record<string, string>>;

export function pgnHeaders(pgn: string): PgnHeaders {
  const result: PgnHeaders = {};
  const re = /^\[(\w+)\s+"([^"]*)"\]/gm;
  let match = re.exec(pgn);
  while (match !== null) {
    result[match[1]] = match[2];
    match = re.exec(pgn);
  }
  return result;
}

/**
 * Extract a game result string from PGN headers or game data.
 */
export function getGameResult(pgn: string): string | null {
  return pgnHeaders(pgn).Result ?? null;
}

/**
 * Parse a `[%clk H:MM:SS.S]` string into total seconds. Returns null if unparseable.
 */
export function clkToSeconds(clk: string): number | null {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(clk);
  if (m === null) {return null;}
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = parseFloat(m[3]);
  if (Number.isNaN(h) || Number.isNaN(min) || Number.isNaN(sec)) {return null;}
  return h * 3600 + min * 60 + sec;
}

/**
 * Walk PGN move list and pull the final `[%clk ...]` annotation for each side.
 * Chess.com PGNs annotate every move with the player's remaining clock AFTER they moved.
 * Plies alternate white/black starting from white; the LAST annotation for each side
 * is that side's remaining clock at the end of their last move played.
 *
 * Returns `{ white, black }` in seconds (float). Either side may be null if the PGN
 * has no clock annotations (e.g. daily games or older imports).
 */
export function pgnFinalClocks(pgn: string): {
  white: number | null;
  black: number | null;
} {
  const re = /\[%clk\s+([\d:.]+)\]/g;
  let i = 0;
  let lastWhite: number | null = null;
  let lastBlack: number | null = null;
  let m = re.exec(pgn);
  while (m !== null) {
    const secs = clkToSeconds(m[1]);
    if (secs !== null) {
      if (i % 2 === 0) {lastWhite = secs;}
      else {lastBlack = secs;}
    }
    i++;
    m = re.exec(pgn);
  }
  return { white: lastWhite, black: lastBlack };
}

/**
 * Parse the `[TimeControl]` header into base + increment seconds.
 * "600+5" → { baseSeconds: 600, incrementSeconds: 5 }; "180" → { 180, 0 }.
 * Returns null for correspondence/daily ("1/259200"), unlimited ("-"), or absent.
 */
export function parseTimeControl(
  pgn: string,
): { baseSeconds: number; incrementSeconds: number } | null {
  const raw = pgnHeaders(pgn).TimeControl;
  if (raw === undefined || raw === "" || raw === "-") {return null;}
  // Daily games use "days/seconds" form (e.g. "1/259200") — not a clock control.
  if (raw.includes("/")) {return null;}
  const m = /^(\d+)(?:\+(\d+))?$/.exec(raw.trim());
  if (m === null) {return null;}
  const baseSeconds = parseInt(m[1], 10);
  const incRaw = m.at(2);
  const incrementSeconds = incRaw !== undefined ? parseInt(incRaw, 10) : 0;
  if (Number.isNaN(baseSeconds) || Number.isNaN(incrementSeconds)) {return null;}
  return { baseSeconds, incrementSeconds };
}

/**
 * Per-ply remaining clock in seconds, in move order.
 * Index `i` = remaining seconds for the side that played ply `i + 1`
 * (index 0 = White's first move). Value is null when that ply has no `[%clk]`.
 *
 * Chess.com annotates every move with the mover's remaining clock AFTER the move,
 * so clock-annotation order matches ply order.
 */
export function pgnPerPlyClocks(pgn: string): Array<number | null> {
  const re = /\[%clk\s+([\d:.]+)\]/g;
  const clocks: Array<number | null> = [];
  let m = re.exec(pgn);
  while (m !== null) {
    clocks.push(clkToSeconds(m[1]));
    m = re.exec(pgn);
  }
  return clocks;
}

export type TerminationKind =
  | "checkmate"
  | "resignation"
  | "timeout"
  | "abandoned"
  | "agreement"
  | "other";

/**
 * Classify a raw Chess.com `[Termination]` header into a coarse kind.
 * Returns null when the raw value is absent.
 */
export function parseTermination(raw: string | null): TerminationKind | null {
  if (raw === null || raw === "") {return null;}
  const s = raw.toLowerCase();
  if (s.includes("checkmate")) {return "checkmate";}
  if (s.includes("on time")) {return "timeout";}
  if (s.includes("resignation") || s.includes("resigned")) {return "resignation";}
  if (s.includes("abandon")) {return "abandoned";}
  if (s.includes("agreement")) {return "agreement";}
  return "other";
}

/** Forfeit terminations (timeout or abandonment) — excluded from accuracy aggregates (D19). */
export function isForfeit(raw: string | null): boolean {
  const kind = parseTermination(raw);
  return kind === "timeout" || kind === "abandoned";
}

/** The `[Variant]` header value, or null if absent. */
export function parseVariant(pgn: string): string | null {
  return pgnHeaders(pgn).Variant ?? null;
}

/**
 * Whether a game was played against a Chess.com bot/coach rather than a real person.
 *
 * Chess.com bot accounts are NOT flagged in the public profile API (e.g. `Coach-Levy`
 * reports `status: "basic"`, like any human), so the reliable signal is the PGN
 * `[Event]` header: practice games against bots are platform-tagged `"Play vs Coach"`,
 * `"Play vs Computer"`, etc. — the `"Play vs "` prefix. Human games use `"Live Chess"`,
 * `"Daily Chess"`, or a tournament name. Matched case-insensitively. *Tunable.*
 */
export function isBotGame(pgn: string): boolean {
  const event = pgnHeaders(pgn).Event;
  if (event === undefined) {return false;}
  return /^play vs /i.test(event.trim());
}

/**
 * Whether a game is standard chess (R37/D20).
 * False if a non-Standard `[Variant]` is present, or `rules` is anything but "chess".
 * `rules` is the Chess.com PubAPI field ("chess", "chess960", "bughouse", …).
 */
export function isStandard(pgn: string, rules?: string): boolean {
  if (rules !== undefined && rules !== "chess") {return false;}
  const variant = parseVariant(pgn);
  if (variant !== null && variant.toLowerCase() !== "standard") {return false;}
  return true;
}

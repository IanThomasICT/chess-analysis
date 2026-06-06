/**
 * Opening Explorer builder (D29) — offline, manual, regenerable.
 *
 *   bun run explorer <dump.pgn.zst> [--url <href>] [--out <db>]
 *     [--min-elo 1100] [--max-elo 2200] [--max-ply 24] [--min-samples 5] [--max-games N]
 *
 * Streams one monthly Lichess **standard rated** dump (local `.pgn.zst` path, or
 * `--url` straight from database.lichess.org), zstd-decompresses on the fly, keeps
 * only games with both players in the peer band, and aggregates the first `maxPly`
 * plies into a normalized-FEN → move → count table (`server/data/explorer/explorer.db`).
 * Games are discarded after counting; the table is the only output.
 *
 * ⚠ The real dump is tens of GB and the build is multi-hour (Risk 3) — this is an
 * explicit manual run, never wired into startup. After it finishes the script flushes
 * `game_metrics_ext`/`game_metrics` so a subsequent `bun run metrics <user>` recomputes
 * out-of-book metrics (D29) instead of the ECO fallback (D33).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Chess } from "chess.js";
import { fenKey } from "../lib/engine";
import { tokenizePgnLine } from "../lib/openings";
import { normalizeSan, EXPLORER_SCHEMA, EXPLORER_TABLE } from "../lib/explorer";

const DEFAULT_OUT = join(import.meta.dir, "..", "data", "explorer", "explorer.db");
const FLUSH_EVERY_GAMES = 20_000;
const PROGRESS_EVERY_GAMES = 100_000;

export interface ExplorerArgs {
  input: string | null;
  url: string | null;
  out: string;
  minElo: number;
  maxElo: number;
  maxPly: number;
  minSamples: number;
  maxGames: number | null;
}

/** fen_key → (normalized SAN → count). */
export type FreqMap = Map<string, Map<string, number>>;

/** Minimal header subset used for filtering. */
export interface ParsedHeaders {
  whiteElo: number | null;
  blackElo: number | null;
  variant: string | null;
}

function parseIntArg(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isNaN(n) ? fallback : n;
}

export function parseArgs(argv: string[]): ExplorerArgs | null {
  let input: string | null = null;
  let url: string | null = null;
  let out = DEFAULT_OUT;
  let minElo = 1100;
  let maxElo = 2200;
  let maxPly = 24;
  let minSamples = 5;
  let maxGames: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") {
      url = argv[i + 1] ?? null;
      i++;
    } else if (a === "--out") {
      out = argv[i + 1] ?? out;
      i++;
    } else if (a === "--min-elo") {
      minElo = parseIntArg(argv[i + 1], minElo);
      i++;
    } else if (a === "--max-elo") {
      maxElo = parseIntArg(argv[i + 1], maxElo);
      i++;
    } else if (a === "--max-ply") {
      maxPly = parseIntArg(argv[i + 1], maxPly);
      i++;
    } else if (a === "--min-samples") {
      minSamples = parseIntArg(argv[i + 1], minSamples);
      i++;
    } else if (a === "--max-games") {
      const n = parseIntArg(argv[i + 1], -1);
      maxGames = n > 0 ? n : null;
      i++;
    } else {
      input = a;
    }
  }

  if (input === null && url === null) {return null;}
  return { input, url, out, minElo, maxElo, maxPly, minSamples, maxGames };
}

/** Both players inside [lo, hi] (inclusive). */
export function inEloBand(whiteElo: number, blackElo: number, lo: number, hi: number): boolean {
  return whiteElo >= lo && whiteElo <= hi && blackElo >= lo && blackElo <= hi;
}

/** Keep a game only if it's standard chess and both ratings sit in the band. */
export function shouldIncludeGame(h: ParsedHeaders, lo: number, hi: number): boolean {
  if (h.whiteElo === null || h.blackElo === null) {return false;}
  if (h.variant !== null && h.variant !== "Standard") {return false;}
  return inEloBand(h.whiteElo, h.blackElo, lo, hi);
}

/** Drop `{...}` comments, `$N` NAGs, and `;` line comments from movetext. */
export function stripPgnComments(movetext: string): string {
  return movetext
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/;[^\n]*/g, " ");
}

/**
 * Replay up to `maxPly` SAN moves, counting each (pre-move fen_key → move) into the
 * map. Transpositions collapse because `fenKey` drops the move counters. Stops at the
 * first illegal/unparseable SAN (truncates that game, keeps what was counted).
 */
export function accumulateGame(map: FreqMap, sans: string[], maxPly: number): void {
  const chess = new Chess();
  const n = Math.min(sans.length, maxPly);
  for (let i = 0; i < n; i++) {
    const key = fenKey(chess.fen());
    let ok = true;
    try {
      chess.move(sans[i]); // throws on illegal/unparseable SAN
    } catch {
      ok = false;
    }
    if (!ok) {break;}
    const mv = normalizeSan(sans[i]);
    let inner = map.get(key);
    if (inner === undefined) {
      inner = new Map<string, number>();
      map.set(key, inner);
    }
    inner.set(mv, (inner.get(mv) ?? 0) + 1);
  }
}

const HEADER_RE = /^\[(\w+)\s+"([^"]*)"\]/;

function toElo(raw: string | undefined): number | null {
  if (raw === undefined) {return null;}
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/** Async line iterator over a (decompressed) byte stream — no node:readline dep. */
async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {break;}
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      yield buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
    }
  }
  if (buf.length > 0) {yield buf;}
}

async function openDumpStream(args: ExplorerArgs): Promise<ReadableStream<Uint8Array>> {
  let raw: ReadableStream<Uint8Array>;
  if (args.url !== null) {
    const res = await fetch(args.url);
    if (!res.ok || res.body === null) {
      throw new Error(`fetch failed: ${String(res.status)}`);
    }
    raw = res.body;
  } else {
    const path = args.input;
    if (path === null) {throw new Error("no input path");}
    raw = Bun.file(path).stream();
  }
  return raw.pipeThrough(new DecompressionStream("zstd"));
}

async function run(args: ExplorerArgs): Promise<void> {
  mkdirSync(dirname(args.out), { recursive: true });
  const out = new Database(args.out, { create: true });
  out.run("PRAGMA journal_mode = WAL");
  out.run(EXPLORER_SCHEMA);

  const upsert = out.prepare(
    `INSERT INTO ${EXPLORER_TABLE} (fen_key, move, count) VALUES (?, ?, ?)
       ON CONFLICT(fen_key, move) DO UPDATE SET count = count + excluded.count`,
  );
  const flush = out.transaction((m: FreqMap) => {
    for (const [key, inner] of m) {
      for (const [mv, c] of inner) {
        upsert.run(key, mv, c);
      }
    }
  });

  const map: FreqMap = new Map();
  let headers: Partial<Record<string, string>> = {};
  let movetext = "";
  let processed = 0;
  let kept = 0;
  let sinceFlush = 0;

  const finalizeGame = (): void => {
    if (movetext.trim() === "" && Object.keys(headers).length === 0) {return;}
    processed++;
    const h: ParsedHeaders = {
      whiteElo: toElo(headers.WhiteElo),
      blackElo: toElo(headers.BlackElo),
      variant: headers.Variant ?? null,
    };
    if (shouldIncludeGame(h, args.minElo, args.maxElo)) {
      const sans = tokenizePgnLine(stripPgnComments(movetext));
      accumulateGame(map, sans, args.maxPly);
      kept++;
      sinceFlush++;
    }
    headers = {};
    movetext = "";
  };

  const stream = await openDumpStream(args);
  for await (const line of readLines(stream)) {
    if (line.startsWith("[Event ")) {
      finalizeGame();
      if (args.maxGames !== null && processed >= args.maxGames) {break;}
    }
    if (line.startsWith("[")) {
      const m = HEADER_RE.exec(line);
      if (m !== null) {headers[m[1]] = m[2];}
    } else if (line.trim() !== "") {
      movetext += ` ${line}`;
    }

    if (sinceFlush >= FLUSH_EVERY_GAMES) {
      flush(map);
      map.clear();
      sinceFlush = 0;
    }
    if (processed > 0 && processed % PROGRESS_EVERY_GAMES === 0) {
      console.log(`[${String(processed)} processed / ${String(kept)} kept]`);
    }
  }
  finalizeGame();
  flush(map);
  map.clear();

  out
    .prepare(
      `DELETE FROM ${EXPLORER_TABLE} WHERE fen_key IN (
         SELECT fen_key FROM ${EXPLORER_TABLE} GROUP BY fen_key HAVING SUM(count) < ?
       )`,
    )
    .run(args.minSamples);
  out.close();

  console.log(`Built explorer table: ${String(kept)} games kept of ${String(processed)}.`);

  // Clean cutover (D26-style): drop cached per-game metrics so the next
  // `bun run metrics <user>` recomputes out-of-book values with the explorer.
  const { db } = await import("../lib/db");
  db.run("DELETE FROM game_metrics_ext");
  db.run("DELETE FROM game_metrics");
  console.log("Flushed game_metrics_ext + game_metrics.");
  console.log("Re-run: bun run metrics <username> to recompute opening metrics.");
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(
      "Usage: bun run explorer <dump.pgn.zst> [--url <href>] [--out <db>] " +
        "[--min-elo 1100] [--max-elo 2200] [--max-ply 24] [--min-samples 5] [--max-games N]",
    );
    process.exit(1);
  }
  await run(args);
}

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface OpeningEntry {
  eco: string;
  name: string;
  tokens: string[]; // SAN moves, stripped of move numbers
}

const TSV_FILES = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"];
const DATA_DIR = join(import.meta.dir, "..", "data", "openings");

let LOOKUP: OpeningEntry[] = [];
let loaded = false;

/**
 * Parse "1. e4 e5 2. Nf3 Nc6" → ["e4", "e5", "Nf3", "Nc6"].
 * Strips move numbers, dots, and result tokens like 1-0 / 0-1 / 1/2-1/2 / *.
 */
export function tokenizePgnLine(pgn: string): string[] {
  const tokens: string[] = [];
  for (const raw of pgn.split(/\s+/)) {
    const tok = raw.trim();
    if (tok === "") {continue;}
    if (/^\d+\.+$/.test(tok)) {continue;} // "1." or "1..."
    if (/^\d+$/.test(tok)) {continue;} // bare numbers
    if (tok === "*" || tok === "1-0" || tok === "0-1" || tok === "1/2-1/2") {continue;}
    tokens.push(tok);
  }
  return tokens;
}

export function loadOpenings(): void {
  if (loaded) {return;}
  const entries: OpeningEntry[] = [];
  for (const file of TSV_FILES) {
    const path = join(DATA_DIR, file);
    if (!existsSync(path)) {continue;}
    const content = readFileSync(path, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.trim() === "" || line.startsWith("eco\t")) {
        continue;
      }
      const cols = line.split("\t");
      if (cols.length < 3) {
        continue;
      }
      const [eco, name, pgn] = cols;
      const tokens = tokenizePgnLine(pgn);
      if (tokens.length === 0) {
        continue;
      }
      entries.push({ eco, name, tokens });
    }
  }
  // Sort longest-prefix first so first match wins in classifyOpening
  entries.sort((a, b) => b.tokens.length - a.tokens.length);
  LOOKUP = entries;
  loaded = true;
}

/**
 * Classify an opening from a list of SAN moves.
 * Returns the longest matching prefix entry, or null if no entry matches.
 */
export function classifyOpening(sanMoves: string[]): { eco: string; name: string } | null {
  if (!loaded) {loadOpenings();}
  for (const entry of LOOKUP) {
    if (entry.tokens.length > sanMoves.length) {continue;}
    let match = true;
    for (let i = 0; i < entry.tokens.length; i++) {
      if (entry.tokens[i] !== sanMoves[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      return { eco: entry.eco, name: entry.name };
    }
  }
  return null;
}

/** For tests — clear the lookup so re-load can be tested. */
export function _resetForTests(): void {
  LOOKUP = [];
  loaded = false;
}

import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import {
  positionFrequency,
  normalizeSan,
  setExplorerDbPath,
  EXPLORER_SCHEMA,
  EXPLORER_TABLE,
} from "../server/lib/explorer";

const TMP = "test_explorer_unit.db";

function seed(rows: Array<[string, string, number]>): void {
  if (existsSync(TMP)) {rmSync(TMP);}
  const db = new Database(TMP, { create: true });
  db.run(EXPLORER_SCHEMA);
  const insert = db.prepare(
    `INSERT INTO ${EXPLORER_TABLE} (fen_key, move, count) VALUES (?, ?, ?)`,
  );
  for (const [k, m, c] of rows) {insert.run(k, m, c);}
  db.close();
  setExplorerDbPath(TMP);
}

afterEach(() => {
  setExplorerDbPath(null);
  if (existsSync(TMP)) {rmSync(TMP);}
});

describe("normalizeSan", () => {
  it("strips trailing check/mate/annotation glyphs", () => {
    expect(normalizeSan("Qxf7#")).toBe("Qxf7");
    expect(normalizeSan("e4+")).toBe("e4");
    expect(normalizeSan("Nf3!?")).toBe("Nf3");
    expect(normalizeSan("e4")).toBe("e4");
  });
});

describe("positionFrequency", () => {
  it("returns the relative frequency of a move from a sampled position", () => {
    seed([
      ["K", "e4", 60],
      ["K", "d4", 30],
      ["K", "c4", 10],
    ]);
    expect(positionFrequency("K", "e4")).toBeCloseTo(0.6, 5);
    expect(positionFrequency("K", "c4")).toBeCloseTo(0.1, 5);
  });

  it("returns 0 for an unseen move at a sampled position (novelty, not fallback)", () => {
    seed([["K", "e4", 100]]);
    expect(positionFrequency("K", "Na3")).toBe(0);
  });

  it("returns null for an unsampled position (→ ECO fallback)", () => {
    seed([["K", "e4", 100]]);
    expect(positionFrequency("UNKNOWN", "e4")).toBeNull();
  });

  it("normalizes the looked-up SAN", () => {
    seed([["K", "Qxf7", 5], ["K", "Nf3", 95]]);
    expect(positionFrequency("K", "Qxf7#")).toBeCloseTo(0.05, 5);
  });

  it("returns null for every lookup when the DB file is absent", () => {
    setExplorerDbPath("test_explorer_missing.db");
    expect(positionFrequency("K", "e4")).toBeNull();
  });
});

import { describe, it, expect } from "bun:test";
import {
  parseArgs,
  inEloBand,
  shouldIncludeGame,
  stripPgnComments,
  accumulateGame,
  type FreqMap,
} from "../server/scripts/build-explorer";
import { Chess } from "chess.js";

const START_KEY = new Chess().fen().split(" ").slice(0, 4).join(" ");

describe("parseArgs", () => {
  it("takes a positional dump path with band defaults", () => {
    expect(parseArgs(["dump.pgn.zst"])).toEqual({
      input: "dump.pgn.zst",
      url: null,
      out: expect.stringContaining("explorer.db"),
      minElo: 1100,
      maxElo: 2200,
      maxPly: 24,
      minSamples: 5,
      maxGames: null,
    });
  });

  it("parses flag overrides", () => {
    const a = parseArgs([
      "d.zst", "--min-elo", "1500", "--max-elo", "1800",
      "--max-ply", "10", "--min-samples", "20", "--max-games", "50",
    ]);
    expect(a?.minElo).toBe(1500);
    expect(a?.maxElo).toBe(1800);
    expect(a?.maxPly).toBe(10);
    expect(a?.minSamples).toBe(20);
    expect(a?.maxGames).toBe(50);
  });

  it("accepts --url with no positional", () => {
    const a = parseArgs(["--url", "https://example.com/d.pgn.zst"]);
    expect(a?.url).toBe("https://example.com/d.pgn.zst");
    expect(a?.input).toBeNull();
  });

  it("returns null with neither path nor url", () => {
    expect(parseArgs(["--min-elo", "1500"])).toBeNull();
  });
});

describe("inEloBand", () => {
  it("requires both players inside the inclusive band", () => {
    expect(inEloBand(1500, 1600, 1100, 2200)).toBe(true);
    expect(inEloBand(1100, 2200, 1100, 2200)).toBe(true); // bounds inclusive
    expect(inEloBand(1050, 1600, 1100, 2200)).toBe(false);
    expect(inEloBand(1600, 2300, 1100, 2200)).toBe(false);
  });
});

describe("shouldIncludeGame", () => {
  it("drops games missing an Elo", () => {
    expect(shouldIncludeGame({ whiteElo: null, blackElo: 1500, variant: null }, 1100, 2200)).toBe(false);
  });
  it("drops non-standard variants", () => {
    expect(shouldIncludeGame({ whiteElo: 1500, blackElo: 1500, variant: "Chess960" }, 1100, 2200)).toBe(false);
  });
  it("keeps standard in-band games (variant null or Standard)", () => {
    expect(shouldIncludeGame({ whiteElo: 1500, blackElo: 1500, variant: null }, 1100, 2200)).toBe(true);
    expect(shouldIncludeGame({ whiteElo: 1500, blackElo: 1500, variant: "Standard" }, 1100, 2200)).toBe(true);
  });
});

describe("stripPgnComments", () => {
  it("removes eval/clk comments and NAGs", () => {
    const raw = "1. e4 { [%eval 0.17] [%clk 0:03:00] } e5 $1 2. Nf3";
    const cleaned = stripPgnComments(raw);
    expect(cleaned).not.toContain("%eval");
    expect(cleaned).not.toContain("$1");
    expect(cleaned).toContain("e4");
    expect(cleaned).toContain("Nf3");
  });
});

describe("accumulateGame", () => {
  it("counts pre-move fen_key → move, capped at maxPly", () => {
    const map: FreqMap = new Map();
    accumulateGame(map, ["e4", "e5", "Nf3"], 24);
    // Start position keyed by the 4-field fen_key, move e4 seen once.
    expect(map.get(START_KEY)?.get("e4")).toBe(1);
    // 3 plies → 3 distinct before-positions.
    expect(map.size).toBe(3);
  });

  it("respects maxPly", () => {
    const map: FreqMap = new Map();
    accumulateGame(map, ["e4", "e5", "Nf3", "Nc6"], 2);
    expect(map.size).toBe(2);
  });

  it("collapses transpositions into one key", () => {
    const map: FreqMap = new Map();
    // 1.e4 e5 2.Nf3 and 1.Nf3 e5 2.e4 reach the same position after 2 plies via
    // different orders; the start-position key is shared and e4 vs Nf3 both counted.
    accumulateGame(map, ["e4", "e5"], 24);
    accumulateGame(map, ["e4", "e5"], 24);
    expect(map.get(START_KEY)?.get("e4")).toBe(2);
  });

  it("stops at an illegal SAN without throwing", () => {
    const map: FreqMap = new Map();
    accumulateGame(map, ["e4", "Zz9", "Nf3"], 24);
    expect(map.get(START_KEY)?.get("e4")).toBe(1);
    expect(map.size).toBe(1); // stopped after the illegal move
  });

  it("strips SAN annotations via normalizeSan", () => {
    const map: FreqMap = new Map();
    accumulateGame(map, ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"], 24);
    // The checkmating move is stored without the '#'.
    const keys = [...map.values()].flatMap((inner) => [...inner.keys()]);
    expect(keys).toContain("Qxf7");
    expect(keys).not.toContain("Qxf7#");
  });
});

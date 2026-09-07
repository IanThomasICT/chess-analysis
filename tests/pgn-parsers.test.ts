import { describe, it, expect } from "bun:test";
import {
  parseTimeControl,
  pgnPerPlyClocks,
  parseTermination,
  isForfeit,
  parseVariant,
  isStandard,
  clkToSeconds,
} from "../server/lib/pgn";

const CLOCK_PGN = `[Event "Live Chess"]
[TimeControl "180+2"]

1. e4 {[%clk 0:03:00]} e5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:02:55]} Nc6 {[%clk 0:02:50]} 1-0`;

const NO_CLOCK_PGN = `[Event "Live Chess"]
[TimeControl "600"]

1. e4 e5 2. Nf3 Nc6 1-0`;

const VARIANT_PGN = `[Event "Live Chess"]
[Variant "Chess960"]
[TimeControl "180"]

1. e4 e5 1-0`;

describe("parseTimeControl", () => {
  it("parses base+increment", () => {
    expect(parseTimeControl(`[TimeControl "600+5"]`)).toEqual({ baseSeconds: 600, incrementSeconds: 5 });
  });
  it("parses base only as zero increment", () => {
    expect(parseTimeControl(`[TimeControl "180"]`)).toEqual({ baseSeconds: 180, incrementSeconds: 0 });
  });
  it("returns null for daily/correspondence", () => {
    expect(parseTimeControl(`[TimeControl "1/259200"]`)).toBeNull();
  });
  it("returns null for unlimited and absent", () => {
    expect(parseTimeControl(`[TimeControl "-"]`)).toBeNull();
    expect(parseTimeControl(`[Event "x"]`)).toBeNull();
  });
});

describe("clkToSeconds", () => {
  it("parses H:MM:SS.s", () => {
    expect(clkToSeconds("0:03:00")).toBe(180);
    expect(clkToSeconds("0:02:58.5")).toBe(178.5);
  });
  it("returns null on garbage", () => {
    expect(clkToSeconds("abc")).toBeNull();
  });
});

describe("pgnPerPlyClocks", () => {
  it("returns per-ply remaining seconds in move order", () => {
    expect(pgnPerPlyClocks(CLOCK_PGN)).toEqual([180, 178, 175, 170]);
  });
  it("returns empty array when no clocks present", () => {
    expect(pgnPerPlyClocks(NO_CLOCK_PGN)).toEqual([]);
  });
});

describe("parseTermination", () => {
  it("classifies chess.com termination strings", () => {
    expect(parseTermination("Alice won by checkmate")).toBe("checkmate");
    expect(parseTermination("Alice won on time")).toBe("timeout");
    expect(parseTermination("Alice won by resignation")).toBe("resignation");
    expect(parseTermination("Game abandoned")).toBe("abandoned");
    expect(parseTermination("Game drawn by agreement")).toBe("agreement");
    expect(parseTermination("Game drawn by repetition")).toBe("other");
  });
  it("returns null when absent", () => {
    expect(parseTermination(null)).toBeNull();
    expect(parseTermination("")).toBeNull();
  });
});

describe("isForfeit", () => {
  it("is true for timeout and abandonment only", () => {
    expect(isForfeit("Alice won on time")).toBe(true);
    expect(isForfeit("Game abandoned")).toBe(true);
    expect(isForfeit("Alice won by checkmate")).toBe(false);
    expect(isForfeit("Alice won by resignation")).toBe(false);
    expect(isForfeit(null)).toBe(false);
  });
});

describe("parseVariant", () => {
  it("returns the Variant header or null", () => {
    expect(parseVariant(VARIANT_PGN)).toBe("Chess960");
    expect(parseVariant(NO_CLOCK_PGN)).toBeNull();
  });
});

describe("isStandard", () => {
  it("is false for non-standard variant header", () => {
    expect(isStandard(VARIANT_PGN)).toBe(false);
  });
  it("is false for non-chess rules", () => {
    expect(isStandard(NO_CLOCK_PGN, "chess960")).toBe(false);
    expect(isStandard(NO_CLOCK_PGN, "bughouse")).toBe(false);
  });
  it("is true for standard chess (no variant, chess/undefined rules)", () => {
    expect(isStandard(NO_CLOCK_PGN)).toBe(true);
    expect(isStandard(NO_CLOCK_PGN, "chess")).toBe(true);
    expect(isStandard(`[Variant "Standard"]\n\n1. e4 e5`)).toBe(true);
  });
});

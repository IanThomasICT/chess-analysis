import { describe, expect, test } from "bun:test";
import { buildGameRow } from "../server/routes/games";
import type { ChessComGame } from "../server/lib/chesscom";

// ---------------------------------------------------------------------------
// PGN fixtures
// ---------------------------------------------------------------------------

const FULL_PGN = `[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[WhiteElo "1500"]
[BlackElo "1450"]
[ECO "C50"]
[Opening "Italian Game"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`;

const NO_ECO_PGN = `[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[WhiteElo "1500"]
[BlackElo "1450"]
[Result "1-0"]

1. e4 e5 1-0`;

const NO_ELO_PGN = `[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[ECO "D00"]
[Opening "Queen's Pawn"]
[Result "1/2-1/2"]

1. d4 d5 1/2-1/2`;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeGame(overrides: Partial<ChessComGame> = {}): ChessComGame {
  return {
    url: "https://www.chess.com/game/live/12345",
    pgn: FULL_PGN,
    time_control: "600",
    time_class: "rapid",
    end_time: 1700000000,
    rated: true,
    rules: "chess",
    white: { username: "Alice", rating: 1500, result: "win" },
    black: { username: "Bob", rating: 1450, result: "resigned" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildGameRow", () => {
  test("username matches white (case-insensitive) → userElo equals whiteElo", () => {
    const row = buildGameRow("alice", makeGame());
    expect(row.user_elo).toBe(1500);
    expect(row.white_elo).toBe(1500);
    expect(row.black_elo).toBe(1450);
  });

  test("username matches black (case-insensitive) → userElo equals blackElo", () => {
    const row = buildGameRow("BOB", makeGame());
    expect(row.user_elo).toBe(1450);
    expect(row.white_elo).toBe(1500);
    expect(row.black_elo).toBe(1450);
  });

  test("PGN without ECO header → eco is null, opening is null", () => {
    const row = buildGameRow("alice", makeGame({ pgn: NO_ECO_PGN }));
    expect(row.eco).toBeNull();
    expect(row.opening).toBeNull();
  });

  test("PGN without WhiteElo/BlackElo headers → whiteElo and blackElo are null", () => {
    const row = buildGameRow("alice", makeGame({ pgn: NO_ELO_PGN }));
    expect(row.white_elo).toBeNull();
    expect(row.black_elo).toBeNull();
  });

  test("PGN with all headers → all five new fields populated", () => {
    const row = buildGameRow("alice", makeGame({ pgn: FULL_PGN }));
    expect(row.white_elo).toBe(1500);
    expect(row.black_elo).toBe(1450);
    expect(row.user_elo).toBe(1500);
    expect(row.eco).toBe("C50");
    expect(row.opening).toBe("Italian Game");
  });

  test("game id is derived from url (last path segment)", () => {
    const row = buildGameRow("alice", makeGame());
    expect(row.id).toBe("12345");
  });

  test("username is lowercased in stored row", () => {
    const row = buildGameRow("ALICE", makeGame());
    expect(row.username).toBe("alice");
  });

  test("white wins → result is '1-0'", () => {
    const row = buildGameRow("alice", makeGame());
    expect(row.result).toBe("1-0");
  });

  test("black wins → result is '0-1'", () => {
    const g = makeGame({
      white: { username: "Alice", rating: 1500, result: "resigned" },
      black: { username: "Bob", rating: 1450, result: "win" },
    });
    const row = buildGameRow("alice", g);
    expect(row.result).toBe("0-1");
  });

  test("neither wins → result is '1/2-1/2'", () => {
    const g = makeGame({
      white: { username: "Alice", rating: 1500, result: "agreed" },
      black: { username: "Bob", rating: 1450, result: "agreed" },
    });
    const row = buildGameRow("alice", g);
    expect(row.result).toBe("1/2-1/2");
  });
});

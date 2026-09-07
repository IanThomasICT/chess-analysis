import { describe, it, expect } from "bun:test";
import {
  tierMultipv,
  shouldReanalyze,
  parseArgs,
} from "../server/scripts/build-metrics";

const NOW = 1_800_000_000;
const MONTH = 30 * 24 * 60 * 60;

describe("tierMultipv", () => {
  it("recent games (by index) get MultiPV 3", () => {
    expect(tierMultipv(0, 0, NOW)).toBe(3);
    expect(tierMultipv(299, 0, NOW)).toBe(3);
  });
  it("old tail games get MultiPV 1", () => {
    expect(tierMultipv(500, NOW - 24 * MONTH, NOW)).toBe(1);
  });
  it("recent-by-time games still get MultiPV 3 past the index cap", () => {
    expect(tierMultipv(500, NOW - MONTH, NOW)).toBe(3);
  });
});

describe("shouldReanalyze", () => {
  it("forces when flag set", () => {
    expect(shouldReanalyze(30, 12, true)).toBe(true);
  });
  it("re-runs when never analyzed", () => {
    expect(shouldReanalyze(null, 12, false)).toBe(true);
  });
  it("re-runs when below min depth", () => {
    expect(shouldReanalyze(8, 12, false)).toBe(true);
  });
  it("skips when at/above min depth", () => {
    expect(shouldReanalyze(20, 12, false)).toBe(false);
  });
});

describe("parseArgs", () => {
  it("parses username + flags", () => {
    expect(parseArgs(["alice"])).toEqual({ username: "alice", reanalyze: false, minDepth: 12 });
    expect(parseArgs(["alice", "--reanalyze"])).toEqual({ username: "alice", reanalyze: true, minDepth: 12 });
    expect(parseArgs(["alice", "--min-depth", "18"])).toEqual({ username: "alice", reanalyze: false, minDepth: 18 });
  });
  it("returns null without a username", () => {
    expect(parseArgs(["--reanalyze"])).toBeNull();
  });
});

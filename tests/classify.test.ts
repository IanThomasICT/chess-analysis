import { describe, it, expect } from "bun:test";
import { classifySwing, classToColor, type MoveClass } from "../shared/classify";

describe("classifySwing", () => {
  it("returns 'best' for wpDelta 0", () => {
    expect(classifySwing(0)).toBe("best");
  });
  it("returns 'good' for wpDelta 0.05", () => {
    expect(classifySwing(0.05)).toBe("good");
  });
  it("returns 'inaccuracy' for wpDelta 0.15", () => {
    expect(classifySwing(0.15)).toBe("inaccuracy");
  });
  it("returns 'mistake' for wpDelta 0.25", () => {
    expect(classifySwing(0.25)).toBe("mistake");
  });
  it("returns 'blunder' for wpDelta 0.35", () => {
    expect(classifySwing(0.35)).toBe("blunder");
  });
  it("clamps negative wpDelta to 0 (best)", () => {
    expect(classifySwing(-0.5)).toBe("best");
  });
});

describe("classToColor", () => {
  it("blunder maps to red+bold", () => {
    expect(classToColor("blunder")).toContain("red");
  });
  it("good/best map to empty string (no styling)", () => {
    expect(classToColor("good")).toBe("");
    expect(classToColor("best")).toBe("");
  });
});

// Type check: MoveClass is importable and usable
const _check: MoveClass = "inaccuracy";
void _check;

// Chart colors mirror the CSS theme tokens in app.css. uPlot draws on a raw
// canvas and cannot read Tailwind utilities, so the palette is duplicated here
// as plain hex. Keep in sync with the `@theme` block in app.css.

export const CHART = {
  /** Accent blue — eval line, Elo series, current-move marker. */
  accent: "#6f9fe8",
  /** Green — accuracy series, positive inflections, "good" markers. */
  good: "#7cb342",
  /** Red — blunders, negative inflections. */
  bad: "#d65a52",
  /** Amber — peak/secondary series. */
  amber: "#d6b656",
  /** Neutral gridlines / zero line (use with low alpha). */
  grid: "#3a3833",
  /** Muted axis text. */
  axis: "#a8a39a",
  /** Tooltip surface + text. */
  tooltipBg: "#2b2924",
  tooltipFg: "#ece9e3",
  tooltipBorder: "#3a3833",
} as const;

/** Green used for the time-of-day heatmap fill, as an `rgb()` triple. */
export const HEATMAP_RGB = "124, 179, 66";

import { memo, useRef, useEffect, useMemo } from "react";
import uPlot from "uplot";

interface EvalDataPoint {
  moveIndex: number;
  score: number;
}

interface InflectionPoint {
  moveIndex: number;
  score: number;
  fill: string;
}

interface EvalGraphProps {
  data: EvalDataPoint[];
  currentMove: number;
  onSelectMove: (moveIndex: number) => void;
}

const CLAMP_MIN = -5;
const CLAMP_MAX = 5;

function clamp(v: number): number {
  return Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, v));
}

export const EvalGraph = memo(function EvalGraph({
  data,
  currentMove,
  onSelectMove,
}: EvalGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const currentMoveRef = useRef(currentMove);
  const onSelectMoveRef = useRef(onSelectMove);
  const inflectionsRef = useRef<InflectionPoint[]>([]);
  const alignedDataRef = useRef<uPlot.AlignedData>([[], []]);

  // Keep refs current — assignment during render is safe for refs.
  currentMoveRef.current = currentMove;
  onSelectMoveRef.current = onSelectMove;

  // Pre-compute inflection points — O(n), only recomputes when data changes.
  const inflections = useMemo((): InflectionPoint[] => {
    const result: InflectionPoint[] = [];
    for (let i = 1; i < data.length; i++) {
      if (Math.abs(data[i].score - data[i - 1].score) > 0.5) {
        result.push({
          moveIndex: data[i].moveIndex,
          score: clamp(data[i].score),
          fill: data[i].score > data[i - 1].score ? "#22c55e" : "#ef4444",
        });
      }
    }
    return result;
  }, [data]);
  inflectionsRef.current = inflections;

  // Build uPlot aligned data: [xValues, yValues]
  const alignedData = useMemo((): uPlot.AlignedData => {
    const sorted = [...data].sort((a, b) => a.moveIndex - b.moveIndex);
    return [
      sorted.map((d) => d.moveIndex),
      sorted.map((d) => clamp(d.score)),
    ];
  }, [data]);
  alignedDataRef.current = alignedData;

  // Create uPlot instance — one-time imperative init (same pattern as Chessground).
  // Chart creation is deferred to the first ResizeObserver callback to guarantee
  // the container has non-zero dimensions (avoids 0×0 canvas on first paint).
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    let chart: uPlot | null = null;
    let handleChartClick: (() => void) | null = null;

    // Tooltip element (inline styles — not dependent on Tailwind scanning)
    const tooltip = document.createElement("div");
    tooltip.style.cssText = [
      "position:absolute",
      "display:none",
      "padding:3px 8px",
      "font-size:12px",
      "line-height:1.4",
      "border-radius:6px",
      "pointer-events:none",
      "z-index:10",
      "white-space:nowrap",
      "background:#1f2937",
      "color:#e5e7eb",
      "border:1px solid #374151",
    ].join(";");
    container.appendChild(tooltip);

    function buildOpts(width: number, height: number): uPlot.Options {
      return {
        width,
        height,
        padding: [8, 8, 0, 0],
        cursor: {
          y: false,
          drag: { setScale: false },
          points: { show: false },
        },
        legend: { show: false },
        scales: {
          x: { time: false },
          y: { range: [CLAMP_MIN, CLAMP_MAX] },
        },
        axes: [
          {
            stroke: "#888",
            font: "10px system-ui, sans-serif",
            gap: 4,
            values: (_self: uPlot, splits: number[]) =>
              splits.map((v) => (v % 10 === 0 ? String(v) : "")),
            grid: { stroke: "rgba(128,128,128,0.15)", width: 1 },
            ticks: { show: false },
          },
          {
            stroke: "#888",
            font: "10px system-ui, sans-serif",
            size: 34,
            gap: 4,
            values: (_self: uPlot, splits: number[]) =>
              splits.map((v) => (v > 0 ? "+" + String(v) : String(v))),
            grid: { stroke: "rgba(128,128,128,0.15)", width: 1 },
            ticks: { show: false },
          },
        ],
        series: [
          {}, // x series (required placeholder)
          {
            stroke: "#3b82f6",
            width: 2,
            points: { show: false },
          },
        ],
        hooks: {
          draw: [
            (self: uPlot) => {
              const ctx = self.ctx;
              const pxRatio = devicePixelRatio;
              const bbox = self.bbox;

              ctx.save();

              // Zero reference line (dashed)
              const zeroY = self.valToPos(0, "y", true);
              ctx.setLineDash([4 * pxRatio, 4 * pxRatio]);
              ctx.strokeStyle = "rgba(128,128,128,0.5)";
              ctx.lineWidth = 1 * pxRatio;
              ctx.beginPath();
              ctx.moveTo(bbox.left, zeroY);
              ctx.lineTo(bbox.left + bbox.width, zeroY);
              ctx.stroke();
              ctx.setLineDash([]);

              // Inflection dots
              for (const inf of inflectionsRef.current) {
                const x = self.valToPos(inf.moveIndex, "x", true);
                const y = self.valToPos(inf.score, "y", true);
                ctx.beginPath();
                ctx.arc(x, y, 3.5 * pxRatio, 0, Math.PI * 2);
                ctx.fillStyle = inf.fill;
                ctx.fill();
              }

              // Current move indicator (amber dot with white border)
              const curMove = currentMoveRef.current;
              const xData = self.data[0];
              let matchIdx = -1;
              for (let i = 0; i < xData.length; i++) {
                if (xData[i] === curMove) {
                  matchIdx = i;
                  break;
                }
              }
              if (matchIdx >= 0) {
                const val = self.data[1][matchIdx];
                if (typeof val === "number") {
                  const cx = self.valToPos(curMove, "x", true);
                  const cy = self.valToPos(val, "y", true);
                  // Outer ring
                  ctx.beginPath();
                  ctx.arc(cx, cy, 6 * pxRatio, 0, Math.PI * 2);
                  ctx.fillStyle = "#ffffff";
                  ctx.fill();
                  ctx.strokeStyle = "rgba(0,0,0,0.15)";
                  ctx.lineWidth = 1 * pxRatio;
                  ctx.stroke();
                  // Inner fill
                  ctx.beginPath();
                  ctx.arc(cx, cy, 4.5 * pxRatio, 0, Math.PI * 2);
                  ctx.fillStyle = "#f59e0b";
                  ctx.fill();
                }
              }

              ctx.restore();
            },
          ],
          setCursor: [
            (self: uPlot) => {
              const idx = self.cursor.idx;
              if (idx === null || idx === undefined) {
                tooltip.style.display = "none";
                return;
              }
              const xVal = self.data[0][idx];
              const yVal = self.data[1][idx];
              if (typeof xVal !== "number" || typeof yVal !== "number") {
                tooltip.style.display = "none";
                return;
              }

              const cssLeft = self.valToPos(xVal, "x");
              const bboxLeftCss = self.bbox.left / devicePixelRatio;
              const evalStr =
                yVal > 0 ? "+" + yVal.toFixed(2) : yVal.toFixed(2);

              tooltip.textContent =
                "Move " + String(xVal) + "  \u00b7  " + evalStr;
              tooltip.style.display = "block";
              tooltip.style.left = String(bboxLeftCss + cssLeft) + "px";
              tooltip.style.top = "0px";
              tooltip.style.transform = "translateX(-50%)";
            },
          ],
        },
      };
    }

    // Deferred init: create the chart on the first ResizeObserver callback that
    // reports non-zero dimensions.  This avoids the 0×0 canvas problem when the
    // container hasn't been laid out yet (common with conditional rendering).
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) continue;

        if (chart === null) {
          // First valid size — create the chart with the latest data from the ref.
          chart = new uPlot(
            buildOpts(Math.floor(width), Math.floor(height)),
            alignedDataRef.current,
            container,
          );
          chartRef.current = chart;

          handleChartClick = () => {
            if (chart === null) return;
            const idx = chart.cursor.idx;
            if (idx === null || idx === undefined) return;
            const moveIndex = chart.data[0][idx];
            if (typeof moveIndex === "number") {
              onSelectMoveRef.current(moveIndex);
            }
          };
          chart.over.addEventListener("click", handleChartClick);
          chart.over.style.cursor = "pointer";
        } else {
          chart.setSize({
            width: Math.floor(width),
            height: Math.floor(height),
          });
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (chart !== null) {
        if (handleChartClick !== null) {
          chart.over.removeEventListener("click", handleChartClick);
        }
        chart.destroy();
      }
      chartRef.current = null;
      if (container.contains(tooltip)) {
        container.removeChild(tooltip);
      }
    };
  }, []);

  // Sync data when analysis results stream in
  useEffect(() => {
    if (chartRef.current !== null) {
      chartRef.current.setData(alignedData);
    }
  }, [alignedData]);

  // Redraw on currentMove change — the draw hook reads currentMoveRef for the indicator dot.
  useEffect(() => {
    if (chartRef.current !== null) {
      chartRef.current.redraw();
    }
  }, [currentMove]);

  return <div ref={containerRef} className="relative w-full h-full" />;
});

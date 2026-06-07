import { memo, useEffect, useRef } from "react";
import uPlot from "uplot";
import type { EloTrendPoint } from "../api";
import { CHART } from "../lib/theme-colors";

interface Props {
  data: EloTrendPoint[];
}

/** Compute running maximum (peak) over a number array. */
function runningPeak(values: number[]): number[] {
  const out: number[] = [];
  let peak = -Infinity;
  for (const v of values) {
    if (v > peak) {peak = v;}
    out.push(peak);
  }
  return out;
}

function buildAligned(pts: EloTrendPoint[]): uPlot.AlignedData {
  const eloValues = pts.map((d) => d.elo);
  return [
    pts.map((d) => d.t),
    eloValues,
    runningPeak(eloValues),
  ];
}

/** Compute net gain and peak from data. Returns null when there are fewer than 2 points. */
function computeSummary(pts: EloTrendPoint[]): { netGain: number; peak: number } | null {
  if (pts.length < 2) {return null;}
  const firstElo = pts.at(0)?.elo;
  const lastElo = pts.at(-1)?.elo;
  if (firstElo === undefined || lastElo === undefined) {return null;}
  let peak = firstElo;
  for (const p of pts) {
    if (p.elo > peak) {peak = p.elo;}
  }
  return { netGain: lastElo - firstElo, peak };
}

export const EloTrendChart = memo(function EloTrendChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const dataRef = useRef<EloTrendPoint[]>(data);
  dataRef.current = data;

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) {return;}

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      if (w === 0 || h === 0) {return;}

      const pts = dataRef.current;
      const aligned = buildAligned(pts);

      if (chartRef.current === null) {
        chartRef.current = new uPlot(
          {
            width: w,
            height: h,
            scales: { x: { time: true } },
            axes: [
              {
                stroke: CHART.axis,
                font: "10px system-ui, sans-serif",
                grid: { stroke: "rgba(128,128,128,0.15)", width: 1 },
                ticks: { show: false },
              },
              {
                label: "Rating",
                stroke: CHART.axis,
                font: "10px system-ui, sans-serif",
                size: 48,
                grid: { stroke: "rgba(128,128,128,0.15)", width: 1 },
                ticks: { show: false },
              },
            ],
            series: [
              {},
              { label: "Elo", stroke: CHART.accent, width: 2, points: { show: false } },
              {
                label: "Peak",
                stroke: "rgba(214,182,86,0.55)",
                width: 1.5,
                dash: [4, 4],
                points: { show: false },
              },
            ],
            legend: { show: false },
          },
          aligned,
          node,
        );
      } else {
        chartRef.current.setSize({ width: w, height: h });
        chartRef.current.setData(aligned);
      }
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  // Sync data when it changes (e.g. time class switch)
  useEffect(() => {
    if (chartRef.current === null) {return;}
    chartRef.current.setData(buildAligned(data));
  }, [data]);

  const summary = computeSummary(data);

  function netGainColorClass(netGain: number): string {
    if (netGain > 0) {return "font-semibold text-win";}
    if (netGain < 0) {return "font-semibold text-loss";}
    return "font-semibold text-muted";
  }

  return (
    <div>
      {summary !== null && (
        <div className="mb-1 flex gap-4 text-xs text-muted">
          <span>
            Net gain:{" "}
            <span className={netGainColorClass(summary.netGain)}>
              {summary.netGain > 0 ? "+" : ""}
              {String(summary.netGain)}
            </span>
          </span>
          <span>
            Peak:{" "}
            <span className="font-semibold text-inaccuracy">
              {String(summary.peak)}
            </span>
          </span>
        </div>
      )}
      <div ref={containerRef} className="h-64 w-full" />
    </div>
  );
});

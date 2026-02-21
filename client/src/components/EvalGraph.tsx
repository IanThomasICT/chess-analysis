import { memo, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
} from "recharts";

interface EvalDataPoint {
  moveIndex: number;
  score: number;
}

interface ClampedDataPoint extends EvalDataPoint {
  clampedScore: number;
}

interface EvalGraphProps {
  data: EvalDataPoint[];
  currentMove: number;
  onSelectMove: (moveIndex: number) => void;
}

interface ChartClickPayloadEntry {
  payload: ClampedDataPoint;
}

interface ChartClickEvent {
  activePayload?: ChartClickPayloadEntry[];
}

export const EvalGraph = memo(function EvalGraph({
  data,
  currentMove,
  onSelectMove,
}: EvalGraphProps) {
  // These only depend on data, not currentMove — memoize to skip recomputation.
  const { clampedData, inflectionDots } = useMemo(() => {
    const clamped: ClampedDataPoint[] = data.map((d) => ({
      ...d,
      clampedScore: Math.max(-5, Math.min(5, d.score)),
    }));

    const dots = data
      .filter((d, i) => i > 0 && Math.abs(d.score - data[i - 1].score) > 0.5)
      .map((inf) => {
        const idx = data.findIndex((d) => d.moveIndex === inf.moveIndex);
        const prevScore = idx > 0 ? data[idx - 1].score : 0;
        return {
          moveIndex: inf.moveIndex,
          y: Math.max(-5, Math.min(5, inf.score)),
          fill: inf.score > prevScore ? "#22c55e" : "#ef4444",
        };
      });

    return { clampedData: clamped, inflectionDots: dots };
  }, [data]);

  const currentData = clampedData.find((d) => d.moveIndex === currentMove);

  const handleClick = (e: ChartClickEvent) => {
    const payload = e.activePayload;
    if (payload !== undefined && payload.length > 0) {
      onSelectMove(payload[0].payload.moveIndex);
    }
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={clampedData}
        onClick={handleClick as (data: unknown) => void}
        margin={{ top: 5, right: 10, bottom: 5, left: 10 }}
      >
        <XAxis
          dataKey="moveIndex"
          tick={{ fontSize: 10 }}
          tickFormatter={(v: number) => (v % 10 === 0 ? String(v) : "")}
          stroke="#666"
        />
        <YAxis
          domain={[-5, 5]}
          tick={{ fontSize: 10 }}
          tickFormatter={(v: number) => (v > 0 ? "+" + String(v) : String(v))}
          stroke="#666"
          width={30}
        />
        <Tooltip
          formatter={(value: number | undefined) => {
            const v = value ?? 0;
            return [v > 0 ? "+" + v.toFixed(2) : v.toFixed(2), "Eval"];
          }}
          labelFormatter={(label: React.ReactNode) => {
            const text = typeof label === "string" || typeof label === "number" ? String(label) : "";
            return "Move " + text;
          }}
          contentStyle={{
            backgroundColor: "#1f2937",
            border: "1px solid #374151",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#e5e7eb",
          }}
        />
        <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />

        <Line
          type="monotone"
          dataKey="clampedScore"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#3b82f6" }}
        />

        {/* Inflection points */}
        {inflectionDots.map((dot) => (
          <ReferenceDot
            key={dot.moveIndex}
            x={dot.moveIndex}
            y={dot.y}
            r={4}
            fill={dot.fill}
            stroke="none"
          />
        ))}

        {/* Current move indicator */}
        {currentData !== undefined && (
          <ReferenceDot
            x={currentMove}
            y={currentData.clampedScore}
            r={6}
            fill="#f59e0b"
            stroke="#fff"
            strokeWidth={2}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
});

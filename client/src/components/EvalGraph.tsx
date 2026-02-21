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

export function EvalGraph({ data, currentMove, onSelectMove }: EvalGraphProps) {
  // Find inflection points: |score[i] - score[i-1]| > 0.5
  const inflections = data.filter((d, i) => {
    if (i === 0) return false;
    return Math.abs(d.score - data[i - 1].score) > 0.5;
  });

  // Clamp data for display
  const clampedData: ClampedDataPoint[] = data.map((d) => ({
    ...d,
    clampedScore: Math.max(-5, Math.min(5, d.score)),
  }));

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

        {/* Inflection points as larger dots */}
        {inflections.map((inf) => {
          const idx = data.findIndex((d) => d.moveIndex === inf.moveIndex);
          const prevScore = idx > 0 ? data[idx - 1].score : 0;
          return (
            <ReferenceDot
              key={inf.moveIndex}
              x={inf.moveIndex}
              y={Math.max(-5, Math.min(5, inf.score))}
              r={4}
              fill={inf.score > prevScore ? "#22c55e" : "#ef4444"}
              stroke="none"
            />
          );
        })}

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
}

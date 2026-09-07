import { useState, useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  fetchBySide,
  fetchWinRateSlice,
  fetchEloTrend,
  fetchAccuracyTrend,
  fetchByTimeOfDay,
  fetchMotifStats,
  fetchDrillProgress,
  fetchConsistency,
  fetchVsOpponent,
  fetchAclTrend,
  fetchTpr,
  fetchLeakClosure,
  fetchRepertoire,
  type WinRateSliceType,
} from "../api";
import { EloTrendChart } from "../components/EloTrendChart";
import { AccuracyTrendChart } from "../components/AccuracyTrendChart";
import { Card } from "../components/ui/Card";
import { StatTile } from "../components/ui/StatTile";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Tabs } from "../components/ui/Tabs";
import { HEATMAP_RGB } from "../lib/theme-colors";
import { useUsername } from "../context/Username";

type Section = "overview" | "trends" | "openings" | "patterns";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "openings", label: "Openings" },
  { id: "patterns", label: "Patterns" },
];

/** Patterns reflect only recent play — old games predate your current level. */
const PATTERN_WINDOW_DAYS = 60;
const DAY_S = 86_400;

const TIME_CLASSES = ["bullet", "blitz", "rapid", "daily"] as const;
type TimeClass = (typeof TIME_CLASSES)[number];
const TIME_CLASS_OPTIONS = TIME_CLASSES.map((t) => ({ value: t, label: t }));

function Loading() {
  return <p className="text-sm text-muted">Loading…</p>;
}
function Failed() {
  return <p className="text-sm text-loss">Error loading stats.</p>;
}

export function Stats() {
  const { username } = useUsername();
  const [section, setSection] = useState<Section>("overview");

  if (username === "") {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-muted">Enter a username to view stats.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-fg">Stats — {username}</h1>
      </div>

      <Tabs
        tabs={SECTIONS}
        active={section}
        onChange={(id) => { setSection(id as Section); }}
        className="mb-5"
      />

      {section === "overview" && <OverviewSection username={username} />}
      {section === "trends" && <TrendsSection username={username} />}
      {section === "openings" && <OpeningsSection username={username} />}
      {section === "patterns" && <PatternsSection username={username} />}
    </div>
  );
}

// =====================================================================
// Overview
// =====================================================================

function OverviewSection({ username }: { username: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <BySideCard username={username} />
      <PerformanceCard username={username} />
      <ConsistencyCard username={username} />
      <DrillCard username={username} />
      <Card title="Win rate by time class" className="lg:col-span-2">
        <SliceList username={username} slice="time_class" />
      </Card>
    </div>
  );
}

function BySideCard({ username }: { username: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "by-side", username],
    queryFn: async () => fetchBySide(username),
  });

  let body: ReactNode;
  if (isPending) {
    body = <Loading />;
  } else if (isError) {
    body = <Failed />;
  } else {
    body = (
      <div className="grid grid-cols-2 gap-3">
        {(["white", "black"] as const).map((side) => {
          const s = data[side];
          return (
            <div key={side} className="rounded-md border border-line p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                As {side}
              </div>
              <div className="font-mono text-2xl font-bold text-fg">
                {s.wins}-{s.draws}-{s.losses}
              </div>
              <div className="mt-1 text-sm text-muted">
                {Math.round(s.win_rate * 100)}% win rate
              </div>
              <div className="text-sm text-muted">
                Accuracy: {s.avg_accuracy !== null ? `${String(Math.round(s.avg_accuracy))}%` : "—"}
              </div>
              <div className="text-sm text-muted">
                Blunders/game: {s.blunders_per_game !== null ? s.blunders_per_game.toFixed(1) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return <Card title="By side">{body}</Card>;
}

function PerformanceCard({ username }: { username: string }) {
  const [tc, setTc] = useState<TimeClass>("blitz");
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "tpr", username, tc],
    queryFn: async () => fetchTpr(username, tc),
  });

  let body: ReactNode;
  if (isPending) {
    body = <Loading />;
  } else if (isError) {
    body = <Failed />;
  } else {
    body = (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="TPR" value={data.tpr !== null ? String(Math.round(data.tpr)) : "—"} tone="accent" />
        <StatTile label="Games" value={String(data.games)} />
        <StatTile label="Score" value={data.score.toFixed(1)} />
        <StatTile label="Avg Opp Elo" value={data.avg_opponent_elo !== null ? String(Math.round(data.avg_opponent_elo)) : "—"} />
      </div>
    );
  }

  return (
    <Card
      title="Performance rating"
      action={<SegmentedControl options={TIME_CLASS_OPTIONS} value={tc} onChange={setTc} />}
    >
      {body}
    </Card>
  );
}

function ConsistencyCard({ username }: { username: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "consistency", username],
    queryFn: async () => fetchConsistency(username),
  });

  let body: ReactNode;
  if (isPending) {
    body = <Loading />;
  } else if (isError) {
    body = <Failed />;
  } else {
    body = (
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Avg Accuracy" value={data.accuracy_mean !== null ? `${data.accuracy_mean.toFixed(1)}%` : "—"} />
        <StatTile label="Std Dev" value={data.accuracy_stddev !== null ? `±${data.accuracy_stddev.toFixed(1)}%` : "—"} />
        <StatTile label="Games" value={String(data.games)} />
      </div>
    );
  }

  return <Card title="Consistency">{body}</Card>;
}

function DrillCard({ username }: { username: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "drill-progress", username],
    queryFn: async () => fetchDrillProgress(username),
  });

  let body: ReactNode;
  if (isPending) {
    body = <Loading />;
  } else if (isError) {
    body = <Failed />;
  } else {
    body = (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Attempts" value={String(data.total_attempts)} />
        <StatTile label="Accuracy" value={`${String(Math.round(data.accuracy_pct))}%`} />
        <StatTile label="Due today" value={String(data.due_today)} />
        <StatTile label="Streak" value={`${String(data.current_streak)} d`} />
      </div>
    );
  }

  return (
    <Card
      title="Drill progress"
      action={
        <Link
          to={`/drill?username=${encodeURIComponent(username)}`}
          className="text-xs font-medium text-accent hover:text-accent-hover"
        >
          Open drill &rarr;
        </Link>
      }
    >
      {body}
    </Card>
  );
}

// =====================================================================
// Trends — shared time-class control over Elo / Accuracy / ACL
// =====================================================================

function TrendsSection({ username }: { username: string }) {
  const [tc, setTc] = useState<TimeClass>("blitz");
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <SegmentedControl options={TIME_CLASS_OPTIONS} value={tc} onChange={setTc} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Elo trend">
          <EloTrendBody username={username} tc={tc} />
        </Card>
        <Card title="Accuracy trend">
          <AccuracyTrendBody username={username} tc={tc} />
        </Card>
        <Card title="ACL trend (last 20)" className="lg:col-span-2">
          <AclTrendBody username={username} tc={tc} />
        </Card>
      </div>
    </div>
  );
}

function EloTrendBody({ username, tc }: { username: string; tc: TimeClass }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "elo-trend", username, tc],
    queryFn: async () => fetchEloTrend(username, tc),
  });
  if (isPending) {return <Loading />;}
  if (isError) {return <Failed />;}
  if (data.length === 0) {return <p className="text-sm text-muted">No data for {tc}.</p>;}
  return <EloTrendChart data={data} />;
}

function AccuracyTrendBody({ username, tc }: { username: string; tc: TimeClass }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "accuracy-trend", username, tc],
    queryFn: async () => fetchAccuracyTrend(username, tc),
  });
  if (isPending) {return <Loading />;}
  if (isError) {return <Failed />;}
  if (data.length === 0) {return <p className="text-sm text-muted">No data for {tc}.</p>;}
  return <AccuracyTrendChart data={data} />;
}

function AclTrendBody({ username, tc }: { username: string; tc: TimeClass }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "acl-trend", username, tc],
    queryFn: async () => fetchAclTrend(username, tc),
  });
  if (isPending) {return <Loading />;}
  if (isError) {return <Failed />;}
  if (data.length === 0) {return <p className="text-sm text-muted">No ACL trend data for {tc}.</p>;}
  const recent = data.slice(-20);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted">
            <th className="p-1 text-left font-normal">Date</th>
            <th className="p-1 text-right font-normal">ACL</th>
            <th className="p-1 text-right font-normal">Rolling</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((pt) => (
            <tr key={pt.t} className="border-t border-line">
              <td className="p-1 text-muted">
                {new Date(pt.t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </td>
              <td className="p-1 text-right font-mono text-fg">{pt.acl.toFixed(1)}</td>
              <td className="p-1 text-right font-mono text-accent">{pt.rolling.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =====================================================================
// Openings
// =====================================================================

function OpeningsSection({ username }: { username: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <RepertoireCard username={username} />
      <Card title="By opening">
        <SliceList username={username} slice="opening" />
      </Card>
    </div>
  );
}

function RepertoireCard({ username }: { username: string }) {
  const [color, setColor] = useState<"white" | "black">("white");
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "repertoire", username, color],
    queryFn: async () => fetchRepertoire(username, color),
  });

  let body: ReactNode;
  if (isPending) {
    body = <Loading />;
  } else if (isError) {
    body = <Failed />;
  } else if (data.length === 0) {
    body = <p className="text-sm text-muted">No repertoire data as {color}.</p>;
  } else {
    body = (
      <div className="space-y-1">
        {data.map((row) => {
          const label = row.opening !== null ? `${row.eco} ${row.opening}` : row.eco;
          return (
            <div key={row.eco} className="flex items-start gap-3 rounded-md border border-line p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg" title={label}>{label}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                  {row.avg_accuracy !== null && <span>{Math.round(row.avg_accuracy)}% acc</span>}
                  {row.avg_out_of_book_ply !== null && <span>book ply {row.avg_out_of_book_ply.toFixed(1)}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm font-semibold text-fg">{Math.round(row.win_rate * 100)}% win</div>
                <div className="text-xs text-muted">{row.games} games</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card
      title="Repertoire"
      action={
        <SegmentedControl
          options={[{ value: "white", label: "white" }, { value: "black", label: "black" }]}
          value={color}
          onChange={setColor}
        />
      }
    >
      {body}
    </Card>
  );
}

// =====================================================================
// Patterns — weaknesses
// =====================================================================

function PatternsSection({ username }: { username: string }) {
  // Stable lower bound for the lifetime of this section — avoids refetch churn.
  const from = useMemo(
    () => Math.floor(Date.now() / 1000) - PATTERN_WINDOW_DAYS * DAY_S,
    [],
  );
  return (
    <div className="space-y-4">
      <p className="text-xs text-faint">
        Patterns below reflect only the last {PATTERN_WINDOW_DAYS} days, so they
        track your current level rather than older play.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MotifsCard username={username} from={from} />
        <LeakClosureCard username={username} from={from} />
        <Card title="By opponent rating">
          <VsOpponentList username={username} from={from} />
        </Card>
        <Card title="Win rate by rating bucket">
          <SliceList username={username} slice="rating_bucket" from={from} />
        </Card>
        <Card title="Time of day" className="lg:col-span-2">
          <TimeOfDayGrid username={username} from={from} />
        </Card>
      </div>
    </div>
  );
}

function MotifsCard({ username, from }: { username: string; from: number }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "motifs", username, from],
    queryFn: async () => fetchMotifStats(username, from),
  });

  let body: ReactNode;
  if (isPending) {
    body = <Loading />;
  } else if (isError) {
    body = <Failed />;
  } else if (data.length === 0) {
    body = <p className="text-sm text-muted">No motifs tagged yet.</p>;
  } else {
    body = (
      <div className="space-y-1.5">
        {data.map((m) => (
          <div key={m.tag} className="flex items-center gap-3 rounded-md border border-line p-2">
            <span className="flex-1 text-sm capitalize text-fg">{m.tag.replace(/_/g, " ")}</span>
            <span className="font-mono text-sm font-semibold text-fg">{m.count}</span>
            <Link
              to={`/analysis/${m.example_game_id}?move=${String(m.example_move_index)}`}
              className="text-xs text-accent hover:text-accent-hover"
            >
              Example &rarr;
            </Link>
          </div>
        ))}
      </div>
    );
  }

  return <Card title="Blundered motifs">{body}</Card>;
}

function leakDeltaClass(delta: number): string {
  if (delta < 0) {return "font-mono text-sm font-semibold text-win";}
  if (delta > 0) {return "font-mono text-sm font-semibold text-loss";}
  return "font-mono text-sm font-semibold text-muted";
}

function LeakClosureCard({ username, from }: { username: string; from: number }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "leak-closure", username, from],
    queryFn: async () => fetchLeakClosure(username, from),
  });

  let body: ReactNode;
  if (isPending) {
    body = <Loading />;
  } else if (isError) {
    body = <Failed />;
  } else if (data.length === 0) {
    body = <p className="text-sm text-muted">No leak data yet.</p>;
  } else {
    body = (
      <div className="space-y-1">
        {data.map((row) => (
          <div key={row.tag} className="flex items-center gap-3 rounded-md border border-line p-2">
            <span className="flex-1 text-sm capitalize text-fg">{row.tag.replace(/_/g, " ")}</span>
            <span className="font-mono text-xs text-muted">{row.first_half.toFixed(1)} → {row.second_half.toFixed(1)}</span>
            <span className={leakDeltaClass(row.delta)}>{row.delta > 0 ? "+" : ""}{row.delta.toFixed(1)}</span>
          </div>
        ))}
      </div>
    );
  }

  return <Card title="Leak closure (first half → second half)">{body}</Card>;
}

function VsOpponentList({ username, from }: { username: string; from: number }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "vs-opponent", username, from],
    queryFn: async () => fetchVsOpponent(username, from),
  });
  if (isPending) {return <Loading />;}
  if (isError) {return <Failed />;}
  if (data.length === 0) {return <p className="text-sm text-muted">No data.</p>;}
  return (
    <div className="space-y-2">
      {data.map((row) => {
        const accSuffix = row.avg_accuracy !== null ? ` · ${String(Math.round(row.avg_accuracy))}% acc` : "";
        const aclSuffix = row.avg_acl_middlegame !== null ? ` · ACL mid ${row.avg_acl_middlegame.toFixed(1)}` : "";
        return (
          <div key={row.bucket} className="flex items-center gap-3">
            <div className="w-36 shrink-0 truncate text-sm text-fg" title={row.bucket}>{row.bucket}</div>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-raised">
              <div className="h-full bg-accent" style={{ width: `${(row.win_rate * 100).toFixed(1)}%` }} />
              <span className="absolute inset-0 flex items-center px-2 text-xs text-fg">
                {Math.round(row.win_rate * 100)}% win{accSuffix}{aclSuffix}
              </span>
            </div>
            <div className="w-16 shrink-0 text-right text-sm text-muted">{row.games} games</div>
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// Shared bits
// =====================================================================

function SliceList({
  username,
  slice,
  from,
}: {
  username: string;
  slice: WinRateSliceType;
  from?: number;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "win-rate", username, slice, from ?? null],
    queryFn: async () => fetchWinRateSlice(username, slice, from),
  });
  if (isPending) {return <Loading />;}
  if (isError) {return <Failed />;}
  if (data.length === 0) {return <p className="text-sm text-muted">No data.</p>;}
  return (
    <div className="space-y-2">
      {data.map((row) => {
        const label = slice === "opening" && row.opening !== undefined ? `${row.key} ${row.opening}` : row.key;
        const accSuffix = row.avg_accuracy !== null ? ` · ${String(Math.round(row.avg_accuracy))}% acc` : "";
        return (
          <div key={row.key} className="flex items-center gap-3">
            <div className="w-48 truncate text-sm text-fg" title={label}>{label}</div>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-raised">
              <div className="h-full bg-accent" style={{ width: `${(row.win_rate * 100).toFixed(1)}%` }} />
              <span className="absolute inset-0 flex items-center px-2 text-xs text-fg">
                {row.wins}-{row.draws}-{row.losses} · {Math.round(row.win_rate * 100)}% win{accSuffix}
              </span>
            </div>
            <div className="w-16 text-right text-sm text-muted">{row.games} games</div>
          </div>
        );
      })}
    </div>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DAYS = Array.from({ length: 7 }, (_, d) => d);

function TimeOfDayGrid({ username, from }: { username: string; from: number }): ReactNode {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "time-of-day", username, from],
    queryFn: async () => fetchByTimeOfDay(username, from),
  });
  if (isPending) {return <Loading />;}
  if (isError) {return <Failed />;}

  const map = new Map<string, { games: number; wins: number; win_rate: number }>();
  let maxGames = 0;
  for (const b of data) {
    map.set(`${String(b.day)}|${String(b.hour)}`, b);
    if (b.games > maxGames) {maxGames = b.games;}
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="px-1" />
            {HOURS.map((h) => (
              <th key={h} className="w-7 px-1 text-center font-normal text-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => (
            <tr key={day}>
              <td className="pr-2 text-muted">{DAY_LABELS[day]}</td>
              {HOURS.map((h) => {
                const bucket = map.get(`${String(day)}|${String(h)}`);
                const intensity = bucket !== undefined && maxGames > 0 ? bucket.games / maxGames : 0;
                const winRatePct = bucket !== undefined ? Math.round(bucket.win_rate * 100) : 0;
                const title = bucket !== undefined
                  ? `${DAY_LABELS[day] ?? ""} ${String(h)}:00 — ${String(bucket.games)} games, ${String(winRatePct)}% win`
                  : `${DAY_LABELS[day] ?? ""} ${String(h)}:00 — no games`;
                const bgColor = bucket !== undefined ? `rgba(${HEATMAP_RGB}, ${String(intensity)})` : "transparent";
                return (
                  <td
                    key={h}
                    className="h-7 w-7 border border-line text-center text-fg"
                    style={{ backgroundColor: bgColor }}
                    title={title}
                  >
                    {bucket !== undefined ? bucket.games : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

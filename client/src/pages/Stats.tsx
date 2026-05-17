import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  fetchBySide,
  fetchWinRateSlice,
  fetchEloTrend,
  fetchAccuracyTrend,
  fetchByTimeOfDay,
  fetchMotifStats,
  fetchDrillProgress,
  type WinRateSliceType,
} from "../api";
import { EloTrendChart } from "../components/EloTrendChart";
import { AccuracyTrendChart } from "../components/AccuracyTrendChart";

type Tab = "by-side" | "time-class" | "opening" | "rating" | "elo-trend" | "accuracy-trend" | "time-of-day" | "motifs" | "drill";

const TAB_LABELS: Record<Tab, string> = {
  "by-side": "By Side",
  "time-class": "By Time Class",
  "opening": "By Opening",
  "rating": "By Rating",
  "elo-trend": "Elo Trend",
  "accuracy-trend": "Accuracy Trend",
  "time-of-day": "Time of Day",
  "motifs": "Motifs",
  "drill": "Drill",
};

const ALL_TABS = Object.keys(TAB_LABELS) as Tab[];

export function Stats() {
  const [searchParams] = useSearchParams();
  const username = searchParams.get("username") ?? "";
  const [tab, setTab] = useState<Tab>("by-side");

  if (username === "") {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Username required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to={`/?username=${encodeURIComponent(username)}`}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              &larr; Back
            </Link>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Stats &mdash; {username}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex flex-wrap gap-2 mb-4">
          {ALL_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                tab === t
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          {tab === "by-side" && <BySideTab username={username} />}
          {tab === "time-class" && <SliceTab username={username} slice="time_class" />}
          {tab === "opening" && <SliceTab username={username} slice="opening" />}
          {tab === "rating" && <SliceTab username={username} slice="rating_bucket" />}
          {tab === "elo-trend" && <EloTrendTab username={username} />}
          {tab === "accuracy-trend" && <AccuracyTrendTab username={username} />}
          {tab === "time-of-day" && <TimeOfDayTab username={username} />}
          {tab === "motifs" && <MotifsTab username={username} />}
          {tab === "drill" && <DrillTab username={username} />}
        </div>
      </main>
    </div>
  );
}

// ---- BySide ----

interface BySideTabProps {
  username: string;
}

function BySideTab({ username }: BySideTabProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "by-side", username],
    queryFn: async () => fetchBySide(username),
  });

  if (isPending) {return <p className="text-gray-500">Loading&hellip;</p>;}
  if (isError) {return <p className="text-red-500">Error loading stats.</p>;}

  return (
    <div className="grid grid-cols-2 gap-4">
      {(["white", "black"] as const).map((side) => {
        const s = data[side];
        const accuracyLabel = s.avg_accuracy !== null
          ? `${Math.round(s.avg_accuracy)}%`
          : "—";
        const blundersLabel = s.blunders_per_game !== null
          ? s.blunders_per_game.toFixed(1)
          : "—";
        return (
          <div
            key={side}
            className="p-3 rounded border border-gray-200 dark:border-gray-700"
          >
            <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
              As {side}
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {s.wins}-{s.draws}-{s.losses}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {Math.round(s.win_rate * 100)}% win rate
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Accuracy: {accuracyLabel}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Blunders/game: {blundersLabel}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Slice (time_class / opening / rating_bucket) ----

interface SliceTabProps {
  username: string;
  slice: WinRateSliceType;
}

function SliceTab({ username, slice }: SliceTabProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "win-rate", username, slice],
    queryFn: async () => fetchWinRateSlice(username, slice),
  });

  if (isPending) {return <p className="text-gray-500">Loading&hellip;</p>;}
  if (isError) {return <p className="text-red-500">Error loading stats.</p>;}
  if (data.length === 0) {return <p className="text-gray-500">No data.</p>;}

  return (
    <div className="space-y-2">
      {data.map((row) => {
        const label =
          slice === "opening" && row.opening !== undefined
            ? `${row.key} ${row.opening}`
            : row.key;
        const accSuffix =
          row.avg_accuracy !== null
            ? ` · ${Math.round(row.avg_accuracy)}% acc`
            : "";
        return (
          <div key={row.key} className="flex items-center gap-3">
            <div
              className="w-48 text-sm text-gray-700 dark:text-gray-300 truncate"
              title={label}
            >
              {label}
            </div>
            <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded relative overflow-hidden">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${(row.win_rate * 100).toFixed(1)}%` }}
              />
              <span className="absolute inset-0 flex items-center px-2 text-xs text-gray-900 dark:text-gray-100">
                {row.wins}-{row.draws}-{row.losses} &middot;{" "}
                {Math.round(row.win_rate * 100)}% win{accSuffix}
              </span>
            </div>
            <div className="w-16 text-right text-sm text-gray-500">
              {row.games} games
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Elo trend ----

const ELO_TIME_CLASSES = ["bullet", "blitz", "rapid", "daily"] as const;
type EloTimeClass = (typeof ELO_TIME_CLASSES)[number];

interface EloTrendTabProps {
  username: string;
}

function EloTrendTab({ username }: EloTrendTabProps) {
  const [tc, setTc] = useState<EloTimeClass>("blitz");
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "elo-trend", username, tc],
    queryFn: async () => fetchEloTrend(username, tc),
  });

  const hasData = data !== undefined && data.length > 0;
  const isEmpty = data?.length === 0;

  let body: ReactNode;
  if (isPending) {
    body = <p className="text-gray-500">Loading&hellip;</p>;
  } else if (isError) {
    body = <p className="text-red-500">Error.</p>;
  } else if (isEmpty) {
    body = <p className="text-gray-500">No data for {tc}.</p>;
  } else if (hasData) {
    body = <EloTrendChart data={data} />;
  } else {
    body = null;
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {ELO_TIME_CLASSES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTc(t); }}
            className={`px-3 py-1 rounded text-sm ${
              tc === t
                ? "bg-blue-600 text-white"
                : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}

// ---- Accuracy trend ----

const ACCURACY_TIME_CLASSES = ["bullet", "blitz", "rapid", "daily"] as const;
type AccuracyTimeClass = (typeof ACCURACY_TIME_CLASSES)[number];

interface AccuracyTrendTabProps {
  username: string;
}

function AccuracyTrendTab({ username }: AccuracyTrendTabProps) {
  const [tc, setTc] = useState<AccuracyTimeClass>("blitz");
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "accuracy-trend", username, tc],
    queryFn: async () => fetchAccuracyTrend(username, tc),
  });

  const hasData = data !== undefined && data.length > 0;
  const isEmpty = data?.length === 0;

  let body: ReactNode;
  if (isPending) {
    body = <p className="text-gray-500">Loading&hellip;</p>;
  } else if (isError) {
    body = <p className="text-red-500">Error.</p>;
  } else if (isEmpty) {
    body = <p className="text-gray-500">No data for {tc}.</p>;
  } else if (hasData) {
    body = <AccuracyTrendChart data={data} />;
  } else {
    body = null;
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {ACCURACY_TIME_CLASSES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTc(t); }}
            className={`px-3 py-1 rounded text-sm ${
              tc === t
                ? "bg-green-600 text-white"
                : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}

// ---- Time of day ----

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DAYS = Array.from({ length: 7 }, (_, d) => d);

interface TimeOfDayTabProps {
  username: string;
}

function TimeOfDayTab({ username }: TimeOfDayTabProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "time-of-day", username],
    queryFn: async () => fetchByTimeOfDay(username),
  });

  if (isPending) {return <p className="text-gray-500">Loading&hellip;</p>;}
  if (isError) {return <p className="text-red-500">Error.</p>;}

  const map = new Map<string, { games: number; wins: number; win_rate: number }>();
  let maxGames = 0;
  for (const b of data) {
    map.set(`${b.day}|${b.hour}`, b);
    if (b.games > maxGames) {maxGames = b.games;}
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="px-1" />
            {HOURS.map((h) => (
              <th
                key={h}
                className="px-1 text-gray-500 dark:text-gray-400 font-normal w-7 text-center"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => (
            <tr key={day}>
              <td className="pr-2 text-gray-500 dark:text-gray-400">
                {DAY_LABELS[day]}
              </td>
              {HOURS.map((h) => {
                const bucket = map.get(`${day}|${h}`);
                const intensity =
                  bucket !== undefined && maxGames > 0
                    ? Math.round((bucket.games / maxGames) * 100)
                    : 0;
                const winRatePct =
                  bucket !== undefined ? Math.round(bucket.win_rate * 100) : 0;
                const title =
                  bucket !== undefined
                    ? `${DAY_LABELS[day] ?? ""} ${h}:00 — ${bucket.games} games, ${winRatePct}% win`
                    : `${DAY_LABELS[day] ?? ""} ${h}:00 — no games`;
                const bgColor =
                  bucket !== undefined
                    ? `rgba(34, 197, 94, ${intensity / 100})`
                    : "transparent";
                return (
                  <td
                    key={h}
                    className="w-7 h-7 border border-gray-100 dark:border-gray-800 text-center"
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

// ---- Motifs ----

interface MotifsTabProps {
  username: string;
}

function MotifsTab({ username }: MotifsTabProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "motifs", username],
    queryFn: async () => fetchMotifStats(username),
  });

  if (isPending) {return <p className="text-gray-500">Loading&hellip;</p>;}
  if (isError) {return <p className="text-red-500">Error.</p>;}
  if (data.length === 0) {return <p className="text-gray-500">No motifs tagged yet.</p>;}

  return (
    <div className="space-y-2">
      {data.map((m) => (
        <div key={m.tag} className="flex items-center gap-3 p-2 rounded border border-gray-200 dark:border-gray-700">
          <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 capitalize">
            {m.tag.replace(/_/g, " ")}
          </span>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {m.count}
          </span>
          <Link
            to={`/analysis/${m.example_game_id}?move=${String(m.example_move_index)}`}
            className="text-xs text-blue-600 hover:underline"
          >
            Example &rarr;
          </Link>
        </div>
      ))}
    </div>
  );
}

// ---- Drill progress ----

interface DrillTabProps {
  username: string;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded border border-gray-200 dark:border-gray-700">
      <div className="text-xs text-gray-500 uppercase">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}

function DrillTab({ username }: DrillTabProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["stats", "drill-progress", username],
    queryFn: async () => fetchDrillProgress(username),
  });

  if (isPending) {return <p className="text-gray-500">Loading&hellip;</p>;}
  if (isError) {return <p className="text-red-500">Error.</p>;}

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Attempts" value={String(data.total_attempts)} />
      <Stat label="Accuracy" value={`${String(Math.round(data.accuracy_pct))}%`} />
      <Stat label="Due today" value={String(data.due_today)} />
      <Stat label="Streak" value={`${String(data.current_streak)} d`} />
    </div>
  );
}

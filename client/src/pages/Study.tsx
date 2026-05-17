import { useMemo, useState } from "react";
import { Link } from "react-router";
import { GLOSSARY, type GlossaryEntry, type Metric } from "../study/glossary";

const METRIC_CLASS: Record<Metric, string> = {
  "Win rate":
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "Accuracy":
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "Elo":
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  "Review velocity":
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

function entryMatchesFilter(entry: GlossaryEntry, q: string): boolean {
  if (q === "") {
    return true;
  }
  const needle = q.toLowerCase();
  if (entry.term.toLowerCase().includes(needle)) {
    return true;
  }
  if (entry.plain.toLowerCase().includes(needle)) {
    return true;
  }
  for (const alias of entry.aliases ?? []) {
    if (alias.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

export function Study() {
  const [filter, setFilter] = useState("");

  const visible = useMemo(
    () => GLOSSARY.filter((e) => entryMatchesFilter(e, filter)),
    [filter],
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              &larr; Back
            </Link>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Study
            </h1>
          </div>
          <input
            type="text"
            placeholder="Filter terms..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
            className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          <nav className="md:sticky md:top-6 md:self-start text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              Terms
            </div>
            <ul className="space-y-1">
              {visible.map((entry) => (
                <li key={entry.id}>
                  <a
                    href={`#${entry.id}`}
                    className="text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    {entry.term}
                  </a>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="text-gray-400 italic">No matches</li>
              )}
            </ul>
          </nav>

          <div className="space-y-4">
            {visible.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400 italic">
                No terms match &ldquo;{filter}&rdquo;.
              </p>
            )}
            {visible.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function EntryCard({ entry }: { entry: GlossaryEntry }) {
  const paragraphs = entry.detail.split("\n\n");
  return (
    <section
      id={entry.id}
      className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 scroll-mt-6"
    >
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {entry.term}
        </h2>
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${METRIC_CLASS[entry.metric]}`}
        >
          {entry.metric}
        </span>
      </div>
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3">
        {entry.plain}
      </p>
      <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        {paragraphs.map((p) => (
          <p key={p.slice(0, 32)} className="whitespace-pre-line">
            {p}
          </p>
        ))}
      </div>
      <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-semibold">Where you&rsquo;ll see it:</span>{" "}
        {entry.where}
        {entry.link !== undefined && entry.link !== "" && (
          <>
            {" "}
            <Link
              to={entry.link}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Open page &rarr;
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

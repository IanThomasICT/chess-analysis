import { useMemo, useState } from "react";
import { Link } from "react-router";
import { GLOSSARY, type GlossaryEntry, type Metric } from "../study/glossary";

const METRIC_CLASS: Record<Metric, string> = {
  "Win rate": "bg-info/15 text-info",
  "Accuracy": "bg-win/15 text-win",
  "Elo": "bg-accent/15 text-accent",
  "Review velocity": "bg-inaccuracy/15 text-inaccuracy",
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
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-fg">Study</h1>
        <input
          type="text"
          placeholder="Filter terms..."
          value={filter}
          onChange={(e) => { setFilter(e.target.value); }}
          className="w-64 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
        <nav className="text-sm md:sticky md:top-6 md:self-start">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Terms</div>
          <ul className="space-y-1">
            {visible.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`} className="text-muted hover:text-accent">
                  {entry.term}
                </a>
              </li>
            ))}
            {visible.length === 0 && <li className="italic text-faint">No matches</li>}
          </ul>
        </nav>

        <div className="space-y-4">
          {visible.length === 0 && (
            <p className="italic text-muted">No terms match &ldquo;{filter}&rdquo;.</p>
          )}
          {visible.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: GlossaryEntry }) {
  const paragraphs = entry.detail.split("\n\n");
  return (
    <section
      id={entry.id}
      className="scroll-mt-6 rounded-lg border border-line bg-surface p-4"
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-fg">{entry.term}</h2>
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${METRIC_CLASS[entry.metric]}`}>
          {entry.metric}
        </span>
      </div>
      <p className="mb-3 text-sm font-medium text-fg">{entry.plain}</p>
      <div className="space-y-2 text-sm text-muted">
        {paragraphs.map((p) => (
          <p key={p.slice(0, 32)} className="whitespace-pre-line">{p}</p>
        ))}
      </div>
      <div className="mt-3 text-xs text-muted">
        <span className="font-semibold">Where you&rsquo;ll see it:</span> {entry.where}
        {entry.link !== undefined && entry.link !== "" && (
          <>
            {" "}
            <Link to={entry.link} className="text-accent hover:text-accent-hover">
              Open page &rarr;
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

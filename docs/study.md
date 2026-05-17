# Study

## Files

| File | Purpose |
|---|---|
| `client/src/study/glossary.ts` | Static typed array of `GlossaryEntry` records |
| `client/src/pages/Study.tsx` | `/study` page — sticky nav + filter input + entry cards |
| `client/src/App.tsx` | `/study` route registered |
| `client/src/pages/Home.tsx` | "Study →" nav link (always visible) |

## Purpose

Lowers cognitive overhead per session: Ian opens the app, sees `87% accuracy · 1.2 blunders/game · ACL 32` and knows what every number means. Serves **Review velocity** (one of the three core metrics in `docs/core.md`).

## Content shape

```ts
interface GlossaryEntry {
  id: string;                                       // anchor (e.g. "acl")
  term: string;                                     // display name
  aliases?: string[];                               // matched by filter input
  plain: string;                                    // one-sentence summary
  detail: string;                                   // longer body (\n\n paragraphs)
  where: string;                                    // where the term appears in-app
  link?: string;                                    // optional deep link
  metric: "Win rate" | "Accuracy" | "Elo" | "Review velocity";
}
```

Entries (~11 in v1): Accuracy, Blunder / Mistake / Inaccuracy, ACL, Motif, Drill, FSRS, MultiPV / Deep analysis, PV, FEN, ECO, Lc0.

## UI

Single page, two-column layout on desktop:

- **Left nav**: anchor list of all visible terms. Filtering hides non-matching entries from both the nav and the content list.
- **Filter input**: top-right; substring match on `term`, `aliases`, and `plain`.
- **Cards**: each entry as a `<section id={entry.id}>` with metric badge, plain-English summary, longer body, "Where you'll see it" + optional deep link.

No fetches, no DB queries, no tests — purely static content rendered from a typed array.

## Future extensions

The `/study` route is structured to host opening lessons later (planned route: `/study/openings/:slug` for Ponziani / Alapin / Caro-Kann / Nimzo-Indian). Annotated PGN files would live in `server/data/study/` mirroring the existing `server/data/openings/` pattern.

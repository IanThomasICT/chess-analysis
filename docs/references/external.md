# External References

Libraries, APIs, and data sources this project depends on. Each row links the upstream source and the
local spec that documents how it is used.

## Runtime / framework

| Source | Link | Used for | Local spec |
|---|---|---|---|
| Bun | https://bun.com | Runtime, test runner (`bun:test`), `Bun.spawn` for Stockfish, `bun:sqlite` | `core.md`, `project/analysis-mode.md` |
| `bun:sqlite` | https://bun.com/docs/api/sqlite | Embedded SQLite (`analysis.db`), inline migration runner | `core.md#database-schema` |
| Hono | https://hono.dev/ | HTTP API (`server/`), `secure-headers`, SSE | `project/routing.md`, `project/security.md` |
| Vite + React 19 + TanStack Query + react-router v7 | — | SPA (`client/`), data fetching, CSR routing | `project/routing.md`, `project/ui-ux.md` |
| Tailwind CSS v4 | — | Single dark-theme token system | `project/ui-ux.md` |

## Chess

| Source | Link | Used for | Local spec |
|---|---|---|---|
| Chess.com Published-Data API | https://api.chess.com/ (e.g. `/pub/player/{user}/games/{yyyy}/{mm}`) | Game import (last 6 months, monthly archives); SSRF guard restricts to this origin | `project/gallery.md`, `project/security.md` |
| Stockfish | https://github.com/official-stockfish/Stockfish/releases | UCI engine subprocess; scores normalized to White's perspective | `project/analysis-mode.md` |
| Chessground (`@lichess-org/chessground` v10) | https://github.com/lichess-org/chessground | Board rendering, arrows/shapes, interactive drill board | `project/board.md`, `project/drill.md` |
| chess.js | — | PGN → FEN/SAN parsing on the server | `project/board.md` |
| Lichess accuracy / Win% formulas | https://database.lichess.org/ (lila source) | Accuracy, ACL, blunder/mistake/inaccuracy thresholds | `project/metrics.md`, `project/game_metrics.md` |
| lichess-org/chess-openings | https://github.com/lichess-org/chess-openings | ECO/opening name TSVs (`server/data/openings/*.tsv`) | `project/stats.md` |

## Visualisation / learning

| Source | Link | Used for | Local spec |
|---|---|---|---|
| uPlot | https://github.com/leeoniya/uPlot | Eval graph + trend charts (imperative canvas) | `project/ui-components.md` |
| ts-fsrs | https://github.com/open-spaced-repetition/ts-fsrs | Spaced-repetition scheduling for drill positions | `project/drill.md` |
| lucide-react | — | Iconography (no emoji) | `project/ui-ux.md` |

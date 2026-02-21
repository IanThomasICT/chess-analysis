# Documentation Index

| Spec | Related Files | Description |
|---|---|---|
| [core.md](core.md) | `app/lib/db.server.ts`, `app/routes.ts`, `vite.config.ts`, `tsconfig.json`, `package.json` | Architecture overview, tech stack, data flow diagram, SQLite schema (games + analysis tables), and file structure map |
| [board.md](board.md) | `app/components/ChessBoard.tsx`, `app/lib/pgn.ts`, `app/root.tsx`, `vite.config.ts` | Chessground v10 integration, CSS setup, Vite config, PGN-to-FEN parsing with chess.js, move indexing conventions |
| [analysis-mode.md](analysis-mode.md) | `app/lib/stockfish.server.ts`, `app/routes/api.analyze.$gameId.ts`, `app/routes/analysis.$gameId.tsx` | Stockfish UCI subprocess lifecycle, score parsing and normalization, analysis caching, SSE streaming protocol, analysis view client state and keyboard navigation |
| [gallery.md](gallery.md) | `app/lib/chesscom.server.ts`, `app/routes/home.tsx`, `app/components/GameCard.tsx` | Chess.com PubAPI client, game fetching and DB upsert, home route loader, client-side filtering (text/time class/result), GameCard component |
| [ui-components.md](ui-components.md) | `app/components/EvalBar.tsx`, `app/components/EvalGraph.tsx`, `app/components/MoveList.tsx`, `app/components/GameCard.tsx` | EvalBar score clamping and display, EvalGraph with Recharts (inflection points, click navigation), MoveList classification (blunder/mistake/inaccuracy), auto-scroll |
| [routing.md](routing.md) | `app/routes.ts`, `app/routes/home.tsx`, `app/routes/analysis.$gameId.tsx`, `app/routes/api.analyze.$gameId.ts`, `react-router.config.ts` | Route configuration, loader patterns (sync vs async), type generation with `react-router typegen`, server/client boundaries (`.server.ts` convention) |
| [linting.md](linting.md) | `eslint.config.ts`, `tsconfig.json`, `package.json` | ESLint strict type-checked config, zero-any policy, type import style (`separate-type-imports` requirement for Vite compatibility), Bun/Recharts type workarounds, check commands |

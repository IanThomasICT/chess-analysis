# Documentation Index

| Spec | Related Files | Description |
|---|---|---|
| [core.md](core.md) | `server/lib/db.ts`, `client/vite.config.ts`, `tsconfig.json`, `package.json` | Architecture overview, tech stack, data flow diagram, SQLite schema (games + analysis tables), and file structure map |
| [board.md](board.md) | `client/src/components/ChessBoard.tsx`, `server/lib/pgn.ts`, `client/vite.config.ts` | Chessground v10 integration, CSS setup, Vite config, PGN-to-FEN parsing with chess.js, move indexing conventions |
| [analysis-mode.md](analysis-mode.md) | `server/lib/stockfish.ts`, `server/routes/analyze.ts`, `client/src/pages/Analysis.tsx` | Stockfish UCI subprocess lifecycle, score normalization (White's perspective), movetime-based search, analysis caching, SSE streaming protocol, auto-start analysis, precomputed eval data |
| [gallery.md](gallery.md) | `server/lib/chesscom.ts`, `client/src/pages/Home.tsx`, `client/src/components/GameCard.tsx` | Chess.com PubAPI client, game fetching and DB upsert, home route, client-side filtering (text/time class/result), GameCard component |
| [ui-components.md](ui-components.md) | `client/src/components/EvalBar.tsx`, `client/src/components/EvalGraph.tsx`, `client/src/components/MoveList.tsx`, `client/src/components/GameCard.tsx` | EvalBar score clamping and display, EvalGraph with uPlot (imperative canvas, memoized inflection points, click navigation), MoveList with precomputed classification strings and React.memo, auto-scroll |
| [routing.md](routing.md) | `client/src/App.tsx`, `client/src/pages/Home.tsx`, `client/src/pages/Analysis.tsx`, `server/routes/analyze.ts` | Route configuration, TanStack Query data loading, server/client split-stack boundaries |
| [linting.md](linting.md) | `eslint.config.ts`, `tsconfig.json`, `package.json` | ESLint strict type-checked config, zero-any policy, type import style (`separate-type-imports` requirement for Vite compatibility), React hooks + `@eslint-react` rules (leak detection, DOM safety, naming), Bun type workarounds, check commands |
| [security.md](security.md) | `server/index.ts`, `server/lib/rate-limit.ts`, `server/lib/stockfish.ts`, `server/lib/chesscom.ts` | Security middleware stack (headers, CORS, rate limiting), input validation, SSRF protection, Stockfish concurrency/timeout, error handling |

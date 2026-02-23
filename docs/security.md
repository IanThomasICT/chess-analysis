# Security

## Server Middleware Stack

File: `server/index.ts`

Middleware is applied in this order:

1. **Security headers** (`hono/secure-headers`) — adds `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, etc. to all responses.
2. **CORS** (`hono/cors`) — only enabled in development (Vite on `:5173` → Hono on `:3001`). In production the SPA is served same-origin, so CORS headers are unnecessary.
3. **Rate limiting** (`server/lib/rate-limit.ts`) — in-memory per-IP limits:
   - All `/api/*` routes: 60 requests/minute
   - `/api/analyze/*`: 5 requests/minute (CPU-intensive Stockfish spawning)

A **global error handler** (`app.onError`) catches unhandled exceptions and returns a generic `{ error: "Internal server error" }` without leaking stack traces or file paths.

## Rate Limiter

File: `server/lib/rate-limit.ts`

Simple in-memory rate limiter using a `Map<ip, { count, resetAt }>`. Each call to `rateLimit()` creates an independent store, so different routes can have different limits. Expired entries are cleaned up lazily on the next request after the window elapses.

Client IP is resolved from `X-Forwarded-For` (first entry) → `X-Real-IP` → `"unknown"`.

## Input Validation

All user-supplied route parameters are validated before use:

| Parameter | Pattern | Used in |
|---|---|---|
| `username` (query) | `/^[a-zA-Z0-9_-]{1,50}$/` | `server/routes/games.ts` |
| `gameId` (path) | `/^[a-zA-Z0-9_-]{1,50}$/` | `server/routes/games.ts`, `server/routes/analyze.ts` |

Invalid parameters return `400 Bad Request` with a generic error message.

## SSRF Protection

File: `server/lib/chesscom.ts`

`fetchMonthGames()` validates that every archive URL starts with `https://api.chess.com/` before fetching. This prevents the server from being tricked into fetching arbitrary URLs if the Chess.com API response were ever manipulated.

## Stockfish Security

File: `server/lib/stockfish.ts`

### Concurrency Limiting

A module-level counter (`activeAnalyses`) limits concurrent Stockfish processes to `MAX_CONCURRENT_ANALYSES` (default 2). Each process uses 4 CPU threads and 128 MB hash, so unbounded spawning would be a trivial DoS vector. The analyze route checks `acquireAnalysisSlot()` before creating the SSE stream and returns `429 Too Many Requests` if at capacity. Slots are released in the stream's `finally` block.

### Per-Position Timeout

`analyzeSinglePosition()` wraps the `readUntilBestMove()` call in a `withTimeout()` that rejects after `POSITION_TIMEOUT_MS` (10 seconds). If Stockfish hangs, the error propagates up through the async generator and the `finally` block kills the process. Normal analysis at `SEARCH_MOVETIME` (1.5s) completes well within this window.

### UCI Command Sanitization

`sendCmd()` strips `\r` and `\n` characters from commands before writing to Stockfish's stdin. This prevents injecting additional UCI commands via crafted FEN strings (defense-in-depth — FENs come from `chess.js`, not raw user input).

## Error Handling

- **Global handler** (`server/index.ts`): catches unhandled exceptions, logs internally, returns generic 500.
- **SSE errors** (`server/routes/analyze.ts`): analysis failures are logged server-side with the real error message, but the SSE event only contains `{ "error": "Analysis failed" }`.
- **PGN parsing** (`server/routes/games.ts`, `server/routes/analyze.ts`): wrapped in try/catch. Invalid PGN returns `500` with a generic message rather than crashing.
- **Chess.com fetch failures** (`server/routes/games.ts`): caught and logged, falls through to DB cache.

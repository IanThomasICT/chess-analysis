import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "hono/bun";
import games from "./routes/games";
import analyze from "./routes/analyze";
import stats from "./routes/stats";
import positions from "./routes/positions";
import drill from "./routes/drill";
import metrics from "./routes/metrics";
import { rateLimit } from "./lib/rate-limit";
import { backfillGameHeaders, backfillAnalysisFenKeys, backfillMotifs, backfillIsStandard } from "./lib/backfill";
import { loadOpenings } from "./lib/openings";

loadOpenings();
const backfillCount = backfillGameHeaders();
if (backfillCount > 0) {
  console.log(`Backfilled headers for ${String(backfillCount)} games`);
}
const stdCount = backfillIsStandard();
if (stdCount > 0) {
  console.log(`Backfilled is_standard for ${String(stdCount)} games`);
}
const fenKeyCount = backfillAnalysisFenKeys();
if (fenKeyCount > 0) {
  console.log(`Backfilled fen_key for ${String(fenKeyCount)} analysis rows`);
}
const motifCount = backfillMotifs();
if (motifCount > 0) {
  console.log(`Backfilled motifs for ${String(motifCount)} games`);
}

const app = new Hono();

// Security headers for all responses
app.use("*", secureHeaders());

// CORS — only needed in dev (Vite on :5173 → Hono on :3001).
// In production the SPA is served same-origin so CORS headers are unnecessary.
if (process.env.NODE_ENV !== "production") {
  app.use("/api/*", cors({ origin: "http://localhost:5173" }));
}

// Rate limiting — general API limit + stricter limit for CPU-intensive analysis.
// In development the limiter sees all local requests under the same "unknown"
// IP bucket because no x-forwarded-for header is set; the lower limits below
// would throttle Playwright e2e runs that fan out 100+ requests per minute.
const isProd = process.env.NODE_ENV === "production";
app.use("/api/*", rateLimit({ windowMs: 60_000, max: isProd ? 60 : 1000 }));
app.use("/api/analyze/*", rateLimit({ windowMs: 60_000, max: isProd ? 5 : 60 }));

app.route("/api", games);
app.route("/api", analyze);
app.route("/api", stats);
app.route("/api", positions);
app.route("/api", drill);
app.route("/api", metrics);

// Global error handler — never leak internal details to clients
app.onError((err, c) => {
  console.error("Unhandled error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

// Production: serve built SPA
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./build/client" }));
  app.get("*", async (c) => {
    // SPA fallback: serve index.html for all non-API, non-static routes
    return c.html(await Bun.file("./build/client/index.html").text());
  });
}

const port = Number(process.env.PORT ?? 3001);
console.log(`Server listening on http://localhost:${String(port)}`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 120, // SSE analysis streams need long-lived connections
};

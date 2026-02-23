import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "hono/bun";
import games from "./routes/games";
import analyze from "./routes/analyze";
import { rateLimit } from "./lib/rate-limit";

const app = new Hono();

// Security headers for all responses
app.use("*", secureHeaders());

// CORS — only needed in dev (Vite on :5173 → Hono on :3001).
// In production the SPA is served same-origin so CORS headers are unnecessary.
if (process.env.NODE_ENV !== "production") {
  app.use("/api/*", cors({ origin: "http://localhost:5173" }));
}

// Rate limiting — general API limit + stricter limit for CPU-intensive analysis
app.use("/api/*", rateLimit({ windowMs: 60_000, max: 60 }));
app.use("/api/analyze/*", rateLimit({ windowMs: 60_000, max: 5 }));

app.route("/api", games);
app.route("/api", analyze);

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

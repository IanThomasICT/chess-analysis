import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import games from "./routes/games";
import analyze from "./routes/analyze";

const app = new Hono();

// CORS for dev (Vite on :5173, API on :3001)
app.use("/api/*", cors());

app.route("/api", games);
app.route("/api", analyze);

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

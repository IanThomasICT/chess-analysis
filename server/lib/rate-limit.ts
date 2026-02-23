import type { MiddlewareHandler } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests per window per IP */
  max: number;
}

/**
 * Simple in-memory rate limiter middleware.
 * Each call creates an independent store, allowing different limits per route.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const store = new Map<string, RateLimitEntry>();
  let lastCleanup = Date.now();

  return async (c, next) => {
    const now = Date.now();

    // Lazily clean up expired entries
    if (now - lastCleanup > opts.windowMs) {
      lastCleanup = now;
      for (const [key, entry] of store) {
        if (now > entry.resetAt) {
          store.delete(key);
        }
      }
    }

    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    const entry = store.get(ip);

    if (entry === undefined || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + opts.windowMs });
      await next();
      return;
    }

    entry.count++;
    if (entry.count > opts.max) {
      return c.json(
        { error: "Too many requests, please try again later" },
        429,
      );
    }

    await next();
  };
}

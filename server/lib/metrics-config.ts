/**
 * Central configuration for the game-metrics derivation pipeline.
 *
 * Every threshold from the design doc's decisions (D8–D29, D1) lives here as a
 * pure module constant so the L1 timeline builder, L2 game-metrics builder, and
 * L3 read-time aggregates all agree. Bumping METRICS_VERSION invalidates every
 * cached `game_metrics_ext` row (see `isMetricsStale`).
 *
 * Pure constants only — no imports, no side effects.
 */

/**
 * Cache-invalidation version for the metrics derivation. Any change to a formula
 * or threshold that affects stored `game_metrics`/`game_metrics_ext` values must
 * bump this so stale rows recompute on next access.
 */
export const METRICS_VERSION = 2;

/** ACL skips the opening plies (book moves shouldn't count as centipawn loss). */
export const ACL_SKIP_PLIES = 8;

// ── Decided-position cutoff (D22 / D27 / D28) ────────────────────────────────
/** Win% at/above which a non-mate position counts as "decided" for the leader. */
export const DECIDED_WIN_PCT = 95;
/** A mate score must be held this many consecutive plies to mark the game decided. */
export const DECIDED_MATE_HOLD_K = 3;
/** Per-ply win% decay applied to a mate score so mate-in-1 ≠ mate-in-7 (synthetic win%). */
export const MATE_DISTANCE_EPSILON = 0.01;

// ── Time trouble (D8) ────────────────────────────────────────────────────────
/** A ply is in time trouble when remaining clock < max(MIN_S, PCT · baseSeconds). */
export const TIME_TROUBLE_MIN_S = 30;
export const TIME_TROUBLE_PCT = 0.2;

// ── Criticality (D9) ─────────────────────────────────────────────────────────
/** Position is "critical" when the rank1−rank2 win% gap is at least this (percentage points). */
export const CRITICALITY_GAP_PCT = 15;

// ── Winning / losing thresholds (D10) ────────────────────────────────────────
/** User win% at/above which the position is "winning" (for conversion flags). */
export const WINNING_WP = 80;
/** User win% at/below which the position is "losing" (for save/defense flags). */
export const LOSING_WP = 20;

// ── Session boundaries (D11) ─────────────────────────────────────────────────
/** A gap of at least this many minutes between games starts a new session. */
export const SESSION_BREAK_MIN = 60;

// ── Result quality (D12) ─────────────────────────────────────────────────────
/** Win with accuracy below this counts as a swindle. */
export const SWINDLE_ACC = 65;
/** Loss with accuracy at/above this counts as an unlucky loss. */
export const UNLUCKY_ACC = 80;
// ── Out-of-book detection (D29) ──────────────────────────────────────────────
/** Explorer move frequency below this is considered "out of book". */
export const OUT_OF_BOOK_FREQ_FLOOR = 0.05;
/** Never look past this ply for the out-of-book transition. */
export const OUT_OF_BOOK_MAX_PLY = 24;

// ── Trend windows (D24 / D1) ─────────────────────────────────────────────────
/** Rolling window (games) for trend aggregates (ACL trend, accuracy trend). */
export const TREND_WINDOW_GAMES = 50;
/** "Recent" tier for tiered backfill depth: last N months. */
export const RECENT_TIER_MONTHS = 12;
/** "Recent" tier for tiered backfill depth: last N games. */
export const RECENT_TIER_GAMES = 300;

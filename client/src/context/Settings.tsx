import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router";

const USERNAME_KEY = "chess-analyzer-username";
const PREFS_KEY = "chess-analyzer-settings";

export type TimeClassFilter = "all" | "bullet" | "blitz" | "rapid" | "daily";

const TIME_CLASS_VALUES: readonly TimeClassFilter[] = ["all", "bullet", "blitz", "rapid", "daily"];

export interface Prefs {
  /** Time-class the gallery opens on. */
  defaultTimeClass: TimeClassFilter;
}

const DEFAULT_PREFS: Prefs = { defaultTimeClass: "all" };

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw === null) {return DEFAULT_PREFS;}
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const tc = parsed.defaultTimeClass;
    return {
      defaultTimeClass:
        typeof tc === "string" && TIME_CLASS_VALUES.includes(tc) ? tc : DEFAULT_PREFS.defaultTimeClass,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface SettingsContextValue {
  /** Active username, or "" when none is set. URL-bound (`?username=`), mirrored to localStorage. */
  username: string;
  setUsername: (next: string) => void;
  /** Client-only preferences, persisted to localStorage. */
  settings: Prefs;
  /** Merge a partial update and persist. */
  updateSettings: (patch: Partial<Prefs>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * All client state that outlives a page: the active username (source of truth is the
 * `?username=` query param so links stay shareable; localStorage restores it on a bare
 * URL) plus lightweight preferences. Rendered inside the router by AppShell.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const username = searchParams.get("username") ?? "";
  const [settings, setSettings] = useState<Prefs>(readPrefs);

  useEffect(() => {
    if (username !== "") {
      localStorage.setItem(USERNAME_KEY, username);
      return;
    }
    const cached = localStorage.getItem(USERNAME_KEY);
    if (cached !== null && cached !== "") {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("username", cached);
          return next;
        },
        { replace: true },
      );
    }
  }, [username, setSearchParams]);

  const setUsername = useCallback(
    (next: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next === "") {
          params.delete("username");
        } else {
          params.set("username", next);
        }
        return params;
      });
    },
    [setSearchParams],
  );

  const updateSettings = useCallback((patch: Partial<Prefs>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // localStorage unavailable — keep in-memory only.
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ username, setUsername, settings, updateSettings }),
    [username, setUsername, settings, updateSettings],
  );

  return <SettingsContext value={value}>{children}</SettingsContext>;
}

export function useSettings(): SettingsContextValue {
  const value = use(SettingsContext);
  if (value === null) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return value;
}

import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "chess-analyzer-settings";

export type TimeClassFilter = "all" | "bullet" | "blitz" | "rapid" | "daily";

const TIME_CLASS_VALUES: readonly TimeClassFilter[] = [
  "all",
  "bullet",
  "blitz",
  "rapid",
  "daily",
];

export interface Settings {
  /** Time-class the gallery opens on. */
  defaultTimeClass: TimeClassFilter;
}

const DEFAULT_SETTINGS: Settings = {
  defaultTimeClass: "all",
};

function readStored(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const tc = parsed.defaultTimeClass;
    return {
      defaultTimeClass:
        typeof tc === "string" && TIME_CLASS_VALUES.includes(tc)
          ? tc
          : DEFAULT_SETTINGS.defaultTimeClass,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsContextValue {
  settings: Settings;
  /** Merge a partial update and persist to localStorage. */
  updateSettings: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Lightweight client-only preferences (persisted to localStorage). Username
 * stays in Username context because it is URL-bound; everything else lives here.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readStored);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage unavailable — keep in-memory only.
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ settings, updateSettings }),
    [settings, updateSettings],
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

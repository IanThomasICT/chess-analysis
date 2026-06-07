import { createContext, use, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";

const STORAGE_KEY = "chess-analyzer-username";

interface UsernameContextValue {
  /** Active username, or "" when none is set. */
  username: string;
  /** Update the active username (writes to the URL query param). */
  setUsername: (next: string) => void;
}

const UsernameContext = createContext<UsernameContextValue | null>(null);

/**
 * Centralises the `?username=` query param + localStorage persistence that was
 * previously duplicated in Home. Lives inside the router (rendered by AppShell)
 * so every page can read the active username without prop-drilling.
 */
export function UsernameProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const username = searchParams.get("username") ?? "";

  useEffect(() => {
    if (username === "") {
      const cached = localStorage.getItem(STORAGE_KEY);
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
    } else {
      localStorage.setItem(STORAGE_KEY, username);
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

  const value = useMemo(() => ({ username, setUsername }), [username, setUsername]);

  return <UsernameContext value={value}>{children}</UsernameContext>;
}

export function useUsername(): UsernameContextValue {
  const value = use(UsernameContext);
  if (value === null) {
    throw new Error("useUsername must be used within a UsernameProvider");
  }
  return value;
}

import { NavLink, Outlet, Link } from "react-router";
import { LayoutGrid, BarChart3, Target, BookOpen, type LucideIcon } from "lucide-react";
import { UsernameProvider, useUsername } from "../context/Username";

/** Navbar height — Analysis sizes its no-scroll layout to `100vh - 3.5rem`. */
export const NAVBAR_H = "3.5rem";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** When true the link carries the active `?username=` param. */
  withUser: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Games", icon: LayoutGrid, withUser: true },
  { to: "/stats", label: "Stats", icon: BarChart3, withUser: true },
  { to: "/drill", label: "Drill", icon: Target, withUser: true },
  { to: "/study", label: "Study", icon: BookOpen, withUser: false },
];

function Navbar() {
  const { username, setUsername } = useUsername();
  const search =
    username !== "" ? `?username=${encodeURIComponent(username)}` : "";

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const raw = formData.get("username");
    setUsername(typeof raw === "string" ? raw.trim() : "");
  };

  return (
    <header className="h-14 shrink-0 border-b border-line bg-surface">
      <div className="mx-auto flex h-full max-w-7xl items-center gap-6 px-4">
        <Link to={`/${search}`} className="flex items-center gap-2 shrink-0">
          <span className="text-xl leading-none text-fg">&#9818;</span>
          <span className="font-semibold text-fg">Chess Analyzer</span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const to = item.withUser ? `${item.to}${search}` : item.to;
            return (
              <NavLink
                key={item.to}
                to={to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-raised text-fg"
                      : "text-muted hover:text-fg hover:bg-raised/60"
                  }`
                }
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <form onSubmit={handleSubmit} className="ml-auto flex items-center gap-2">
          <input
            key={username}
            type="text"
            name="username"
            placeholder="Chess.com username"
            defaultValue={username}
            className="w-44 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            Load
          </button>
        </form>
      </div>
    </header>
  );
}

/** Persistent app frame: top navbar + routed page outlet. */
export function AppShell() {
  return (
    <UsernameProvider>
      <div className="flex min-h-screen flex-col bg-canvas">
        <Navbar />
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </UsernameProvider>
  );
}

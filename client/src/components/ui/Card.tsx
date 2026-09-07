import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  /** Optional node rendered on the right side of the header (e.g. a toggle). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Apply default body padding (default true). Set false for flush content. */
  padded?: boolean;
}

/** Surface container with an optional uppercase section header. */
export function Card({ title, action, children, className = "", padded = true }: CardProps) {
  return (
    <div className={`rounded-lg border border-line bg-surface ${className}`}>
      {title !== undefined && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            {title}
          </span>
          {action}
        </div>
      )}
      <div className={padded ? "p-3" : ""}>{children}</div>
    </div>
  );
}

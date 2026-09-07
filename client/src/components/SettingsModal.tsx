import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useSettings, type TimeClassFilter } from "../context/Settings";
import { SegmentedControl } from "./ui/SegmentedControl";

interface Props {
  open: boolean;
  onClose: () => void;
}

const TIME_CLASS_OPTIONS: Array<{ value: TimeClassFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "bullet", label: "Bullet" },
  { value: "blitz", label: "Blitz" },
  { value: "rapid", label: "Rapid" },
  { value: "daily", label: "Daily" },
];

/** Settings dialog — sets the Chess.com username and gallery preferences. */
export function SettingsModal({ open, onClose }: Props) {
  const { username, setUsername, settings, updateSettings } = useSettings();
  const [draft, setDraft] = useState(username);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reseed the draft whenever the dialog opens so it mirrors the live username.
  useEffect(() => {
    if (open) {
      setDraft(username);
      inputRef.current?.focus();
    }
  }, [open, username]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUsername(draft.trim());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/70 px-4 pt-24 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="w-full max-w-md rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1 text-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-4">
          <div className="space-y-1.5">
            <label
              htmlFor="settings-username"
              className="block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Chess.com username
            </label>
            <input
              ref={inputRef}
              id="settings-username"
              name="username"
              type="text"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); }}
              placeholder="e.g. hikaru"
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-faint">
              Recent games are fetched and cached locally for analysis.
            </p>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Default time class
            </span>
            <SegmentedControl
              label="Default time class"
              options={TIME_CLASS_OPTIONS}
              value={settings.defaultTimeClass}
              onChange={(value) => { updateSettings({ defaultTimeClass: value }); }}
              className="flex-wrap"
            />
            <p className="text-xs text-faint">
              The gallery opens filtered to this time class.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

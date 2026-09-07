interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible group label (also used as a test handle via role="group"). */
  label?: string;
  className?: string;
}

/** Inline pill-group toggle for mutually exclusive choices. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex rounded-md border border-line bg-surface p-0.5 ${className}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => { onChange(o.value); }}
          className={`rounded px-3 py-1 text-sm font-medium capitalize transition-colors ${
            value === o.value
              ? "bg-accent text-on-accent"
              : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({
  title,
  subtitle,
  right,
  children,
  className,
}: {
  title?: string | undefined;
  subtitle?: string | undefined;
  right?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section className={cn("panel p-5 sm:p-6", className)}>
      {(title || right) && (
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-surface/70 p-4">
      <p className="kpi-label">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "primary" | "warning" }) {
  const tones = {
    muted: "border-border bg-muted text-muted-foreground",
    primary: "border-primary/40 bg-primary/15 text-primary",
    warning: "border-warning/40 bg-warning/15 text-warning",
  } as const;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs", tones[tone])}>
      {children}
    </span>
  );
}

export function DataTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="bg-surface">
          <tr>
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border/70">
              {columns.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-2">
                  {row[c] === null || row[c] === undefined ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    String(row[c])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

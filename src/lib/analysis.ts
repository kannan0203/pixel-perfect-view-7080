export type Row = Record<string, string | number | null>;

export type Dataset = {
  fileName: string;
  columns: string[];
  rows: Row[];
};

export type ColumnProfile = {
  numeric: string[];
  categorical: string[];
  date: string[];
  valueColumn: string | null;
  productColumn: string | null;
  regionColumn: string | null;
  dateColumn: string | null;
};

export type Quality = {
  rows: number;
  columns: number;
  missing: number;
  duplicates: number;
  numericCount: number;
  categoricalCount: number;
};

const VALUE_HINTS = [
  "total_sales",
  "total_revenue",
  "net_sales",
  "sales",
  "revenue",
  "amount",
  "turnover",
  "profit",
  "price",
  "value",
];
const PRODUCT_HINTS = ["product_name", "product", "item", "sku", "category", "service"];
const REGION_HINTS = ["region", "location", "city", "state", "country", "territory", "zone"];
const DATE_HINTS = ["order_date", "date", "month", "period", "day", "week", "year", "timestamp"];

const norm = (s: string) => s.toLowerCase().replace(/[\s\-.]+/g, "_");

function matchColumn(columns: string[], hints: string[], allowed?: string[]) {
  const pool = allowed ? columns.filter((c) => allowed.includes(c)) : columns;
  for (const hint of hints) {
    const exact = pool.find((c) => norm(c) === hint);
    if (exact) return exact;
  }
  for (const hint of hints) {
    const partial = pool.find((c) => norm(c).includes(hint));
    if (partial) return partial;
  }
  return null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[₹$€£,\s%]/g, "");
  if (cleaned === "" || Number.isNaN(Number(cleaned))) return null;
  return Number(cleaned);
}

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function looksLikeDate(values: unknown[]) {
  const sample = values.filter((v) => !isBlank(v)).slice(0, 25);
  if (sample.length === 0) return false;
  let ok = 0;
  for (const v of sample) {
    const s = String(v);
    if (/^\d{4}-\d{1,2}(-\d{1,2})?/.test(s) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) ok++;
    else if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s)) ok++;
    else if (!Number.isNaN(Date.parse(s)) && /[a-z]/i.test(s)) ok++;
  }
  return ok / sample.length > 0.7;
}

export function profileColumns(ds: Dataset): ColumnProfile {
  const numeric: string[] = [];
  const date: string[] = [];
  const categorical: string[] = [];

  for (const col of ds.columns) {
    const values = ds.rows.map((r) => r[col]);
    const present = values.filter((v) => !isBlank(v));
    const numericCount = present.filter((v) => toNumber(v) !== null).length;
    if (looksLikeDate(values)) date.push(col);
    else if (present.length > 0 && numericCount / present.length > 0.8) numeric.push(col);
    else categorical.push(col);
  }

  return {
    numeric,
    categorical,
    date,
    valueColumn: matchColumn(ds.columns, VALUE_HINTS, numeric) ?? numeric[0] ?? null,
    productColumn: matchColumn(ds.columns, PRODUCT_HINTS, categorical) ?? categorical[0] ?? null,
    regionColumn: matchColumn(ds.columns, REGION_HINTS, categorical),
    dateColumn: matchColumn(ds.columns, DATE_HINTS, date) ?? date[0] ?? null,
  };
}

export function qualityReport(ds: Dataset): Quality {
  const profile = profileColumns(ds);
  let missing = 0;
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of ds.rows) {
    for (const col of ds.columns) if (isBlank(row[col])) missing++;
    const key = ds.columns.map((c) => String(row[c] ?? "")).join("\u0001");
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return {
    rows: ds.rows.length,
    columns: ds.columns.length,
    missing,
    duplicates,
    numericCount: profile.numeric.length,
    categoricalCount: profile.categorical.length,
  };
}

export type Kpis = {
  column: string;
  total: number;
  average: number;
  max: number;
  min: number;
  count: number;
};

export function calculateKpis(ds: Dataset, column: string): Kpis | null {
  const values = ds.rows.map((r) => toNumber(r[column])).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const total = values.reduce((a, b) => a + b, 0);
  return {
    column,
    total,
    average: total / values.length,
    max: Math.max(...values),
    min: Math.min(...values),
    count: values.length,
  };
}

export type GroupResult = { label: string; value: number; rows: number };

export function groupSum(ds: Dataset, byCol: string, valueCol: string): GroupResult[] {
  const map = new Map<string, { value: number; rows: number }>();
  for (const row of ds.rows) {
    const key = isBlank(row[byCol]) ? "(blank)" : String(row[byCol]);
    const num = toNumber(row[valueCol]);
    if (num === null) continue;
    const entry = map.get(key) ?? { value: 0, rows: 0 };
    entry.value += num;
    entry.rows += 1;
    map.set(key, entry);
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, value: v.value, rows: v.rows }))
    .sort((a, b) => b.value - a.value);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function periodKey(raw: unknown): { key: string; sort: number } | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim();
  const monthName = MONTHS.findIndex((m) => s.toLowerCase().startsWith(m.toLowerCase()));
  if (monthName >= 0 && !/\d{4}/.test(s)) return { key: MONTHS[monthName], sort: monthName };
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return {
      key: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      sort: d.getUTCFullYear() * 12 + d.getUTCMonth(),
    };
  }
  return { key: s, sort: 0 };
}

export function monthlySeries(ds: Dataset, dateCol: string, valueCol: string): GroupResult[] {
  const map = new Map<string, { value: number; rows: number; sort: number }>();
  for (const row of ds.rows) {
    const period = periodKey(row[dateCol]);
    const num = toNumber(row[valueCol]);
    if (!period || num === null) continue;
    const entry = map.get(period.key) ?? { value: 0, rows: 0, sort: period.sort };
    entry.value += num;
    entry.rows += 1;
    map.set(period.key, entry);
  }
  return [...map.entries()]
    .sort((a, b) => a[1].sort - b[1].sort)
    .map(([label, v]) => ({ label, value: v.value, rows: v.rows }));
}

export type Anomaly = { index: number; value: number; reason: string; row: Row };

export type AnomalyReport = {
  column: string;
  q1: number;
  q3: number;
  iqr: number;
  lower: number;
  upper: number;
  anomalies: Anomaly[];
};

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function detectAnomalies(ds: Dataset, column: string): AnomalyReport | null {
  const pairs = ds.rows
    .map((row, index) => ({ index, value: toNumber(row[column]), row }))
    .filter((p): p is { index: number; value: number; row: Row } => p.value !== null);
  if (pairs.length < 5) return null;
  const sorted = pairs.map((p) => p.value).sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const anomalies = pairs
    .filter((p) => p.value < lower || p.value > upper)
    .map((p) => ({
      index: p.index,
      value: p.value,
      row: p.row,
      reason:
        p.value > upper
          ? `Above the upper IQR bound (${fmtNumber(upper)})`
          : `Below the lower IQR bound (${fmtNumber(lower)})`,
    }));
  return { column, q1, q3, iqr, lower, upper, anomalies };
}

export function fmtNumber(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtCompact(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });
}

export type Insight = {
  title: string;
  supporting: string;
  source: string;
  implication: string;
};

export function generateInsights(ds: Dataset, profile: ColumnProfile): Insight[] {
  const insights: Insight[] = [];
  const value = profile.valueColumn;
  if (!value) {
    return [
      {
        title: "No numeric business measure detected",
        supporting: `${ds.columns.length} columns scanned, none consistently numeric`,
        source: "Column type detection across all rows",
        implication: "Add a numeric column such as sales or amount to unlock quantitative analysis.",
      },
    ];
  }

  const kpis = calculateKpis(ds, value);
  if (kpis) {
    insights.push({
      title: `Total ${value} across the dataset is ${fmtNumber(kpis.total)}`,
      supporting: `${kpis.count} values summed, average ${fmtNumber(kpis.average)}`,
      source: `SUM(${value}) over ${kpis.count} non-empty rows`,
      implication: "This is the baseline figure every other comparison below is measured against.",
    });
  }

  if (profile.dateColumn) {
    const series = monthlySeries(ds, profile.dateColumn, value);
    if (series.length >= 2) {
      const last = series[series.length - 1];
      const prev = series[series.length - 2];
      const change = prev.value === 0 ? 0 : ((last.value - prev.value) / prev.value) * 100;
      insights.push({
        title: `${value} ${change >= 0 ? "increased" : "decreased"} by ${fmtNumber(Math.abs(change))}% in ${last.label} versus ${prev.label}`,
        supporting: `${prev.label}: ${fmtNumber(prev.value)} → ${last.label}: ${fmtNumber(last.value)}`,
        source: `SUM(${value}) grouped by ${profile.dateColumn}`,
        implication:
          change >= 0
            ? "The observed pattern suggests recent momentum worth reinforcing."
            : "The data suggests the latest period lost ground and deserves a closer look.",
      });
    }
  }

  if (profile.productColumn) {
    const grouped = groupSum(ds, profile.productColumn, value);
    if (grouped.length > 0) {
      const top = grouped[0];
      const share = kpis && kpis.total !== 0 ? (top.value / kpis.total) * 100 : 0;
      insights.push({
        title: `${top.label} leads on ${value} with ${fmtNumber(top.value)}`,
        supporting: `${fmtNumber(share)}% of total, from ${top.rows} rows`,
        source: `SUM(${value}) grouped by ${profile.productColumn}`,
        implication: "Concentration here means supply or availability issues would hit revenue hardest.",
      });
    }
  }

  if (profile.regionColumn) {
    const grouped = groupSum(ds, profile.regionColumn, value);
    if (grouped.length > 0) {
      const top = grouped[0];
      const bottom = grouped[grouped.length - 1];
      insights.push({
        title: `${top.label} is the strongest ${profile.regionColumn} (${fmtNumber(top.value)})`,
        supporting: `Weakest is ${bottom.label} at ${fmtNumber(bottom.value)}`,
        source: `SUM(${value}) grouped by ${profile.regionColumn}`,
        implication: "Based on the available data, the gap between these two is where growth effort pays off.",
      });
    }
  }

  const anomalyReport = detectAnomalies(ds, value);
  if (anomalyReport && anomalyReport.anomalies.length > 0) {
    insights.push({
      title: `${anomalyReport.anomalies.length} unusual ${value} value(s) detected`,
      supporting: `Outside IQR bounds ${fmtNumber(anomalyReport.lower)} – ${fmtNumber(anomalyReport.upper)}`,
      source: `IQR method: Q1=${fmtNumber(anomalyReport.q1)}, Q3=${fmtNumber(anomalyReport.q3)}`,
      implication: "These are statistically unusual, not proven errors — worth verifying before acting.",
    });
  }

  return insights.slice(0, 5);
}

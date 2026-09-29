import {
  calculateKpis,
  detectAnomalies,
  fmtNumber,
  groupSum,
  monthlySeries,
  profileColumns,
  type ColumnProfile,
  type Dataset,
  type Row,
} from "./analysis";

export type Metric = { label: string; value: string; calculation?: string };

export type ChartSpec = {
  type: "bar" | "line";
  title: string;
  data: { label: string; value: number }[];
};

export type QueryResult = {
  question: string;
  headline: string;
  aggregation: string;
  columnsUsed: string[];
  filters: string;
  metrics: Metric[];
  chart?: ChartSpec;
  sourceRows: Row[];
  insufficient?: boolean;
};

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

function rowsMatching(ds: Dataset, col: string, label: string, limit = 12): Row[] {
  return ds.rows.filter((r) => String(r[col] ?? "") === label).slice(0, limit);
}

function insufficient(question: string, reason: string): QueryResult {
  return {
    question,
    headline: "There is not enough evidence in the uploaded dataset to answer this reliably.",
    aggregation: "None",
    columnsUsed: [],
    filters: reason,
    metrics: [],
    sourceRows: [],
    insufficient: true,
  };
}

export function answerQuestion(question: string, ds: Dataset, profile?: ColumnProfile): QueryResult {
  const p = profile ?? profileColumns(ds);
  const q = question.toLowerCase();
  const value = p.valueColumn;

  if (!value) return insufficient(question, "No numeric measure column was detected in this dataset.");
  const kpis = calculateKpis(ds, value)!;

  // Anomalies
  if (has(q, "anomal", "unusual", "outlier", "strange", "spike", "suspicious")) {
    const report = detectAnomalies(ds, value);
    if (!report) return insufficient(question, "Too few numeric values for a reliable IQR analysis.");
    return {
      question,
      headline:
        report.anomalies.length === 0
          ? `No values of ${value} fall outside the IQR bounds.`
          : `${report.anomalies.length} potentially anomalous ${value} value(s) detected.`,
      aggregation: "IQR outlier detection (Q3 + 1.5×IQR / Q1 − 1.5×IQR)",
      columnsUsed: [value],
      filters: `${value} < ${fmtNumber(report.lower)} or > ${fmtNumber(report.upper)}`,
      metrics: [
        { label: "Q1 (25th percentile)", value: fmtNumber(report.q1) },
        { label: "Q3 (75th percentile)", value: fmtNumber(report.q3) },
        { label: "IQR", value: fmtNumber(report.iqr), calculation: `${fmtNumber(report.q3)} − ${fmtNumber(report.q1)}` },
        {
          label: "Upper bound",
          value: fmtNumber(report.upper),
          calculation: `${fmtNumber(report.q3)} + 1.5 × ${fmtNumber(report.iqr)}`,
        },
        {
          label: "Lower bound",
          value: fmtNumber(report.lower),
          calculation: `${fmtNumber(report.q1)} − 1.5 × ${fmtNumber(report.iqr)}`,
        },
        ...report.anomalies.slice(0, 5).map((a) => ({
          label: `Row ${a.index + 1}`,
          value: fmtNumber(a.value),
          calculation: a.reason,
        })),
      ],
      chart: {
        type: "line",
        title: `${value} by row with IQR bounds`,
        data: ds.rows.slice(0, 120).map((r, i) => ({ label: String(i + 1), value: Number(r[value] ?? 0) })),
      },
      sourceRows: report.anomalies.slice(0, 12).map((a) => a.row),
    };
  }

  // Time based questions
  if (has(q, "month", "trend", "over time", "decrease", "decline", "drop", "grow", "growth", "quarter", "period")) {
    if (!p.dateColumn) return insufficient(question, "No date or period column was detected.");
    const series = monthlySeries(ds, p.dateColumn, value);
    if (series.length < 2) return insufficient(question, "Fewer than two periods available for comparison.");
    const best = [...series].sort((a, b) => b.value - a.value)[0]!;
    const last = series[series.length - 1]!;
    const prev = series[series.length - 2]!;
    const change = prev.value === 0 ? 0 : ((last.value - prev.value) / prev.value) * 100;
    const biggestDrop = series
      .slice(1)
      .map((cur, i) => ({ cur, prev: series[i]!, delta: cur.value - series[i]!.value }))
      .sort((a, b) => a.delta - b.delta)[0]!;
    return {
      question,
      headline: `${best.label} had the highest ${value} (${fmtNumber(best.value)}); the latest period ${last.label} ${change >= 0 ? "rose" : "fell"} ${fmtNumber(Math.abs(change))}% versus ${prev.label}.`,
      aggregation: `SUM(${value}) grouped by period from ${p.dateColumn}`,
      columnsUsed: [p.dateColumn, value],
      filters: "None — all rows with a readable date included",
      metrics: [
        { label: `Best period`, value: `${best.label} — ${fmtNumber(best.value)}` },
        {
          label: `Latest change`,
          value: `${fmtNumber(change)}%`,
          calculation: `(${fmtNumber(last.value)} − ${fmtNumber(prev.value)}) / ${fmtNumber(prev.value)} × 100`,
        },
        {
          label: "Largest period-over-period fall",
          value: `${biggestDrop.prev.label} → ${biggestDrop.cur.label}: ${fmtNumber(biggestDrop.delta)}`,
          calculation: `${fmtNumber(biggestDrop.cur.value)} − ${fmtNumber(biggestDrop.prev.value)}`,
        },
        { label: "Periods covered", value: String(series.length) },
      ],
      chart: { type: "line", title: `${value} by period`, data: series.map((s) => ({ label: s.label, value: s.value })) },
      sourceRows: ds.rows.slice(0, 12),
    };
  }

  // Region
  if (p.regionColumn && has(q, "region", "location", "city", "state", "country", "territory", "market", "zone")) {
    const grouped = groupSum(ds, p.regionColumn, value);
    const top = grouped[0]!;
    const bottom = grouped[grouped.length - 1]!;
    return {
      question,
      headline: `${top.label} is the strongest ${p.regionColumn} with ${value} of ${fmtNumber(top.value)}.`,
      aggregation: `SUM(${value}) grouped by ${p.regionColumn}`,
      columnsUsed: [p.regionColumn, value],
      filters: "None — all rows grouped",
      metrics: [
        {
          label: `Top ${p.regionColumn}`,
          value: `${top.label} — ${fmtNumber(top.value)}`,
          calculation: `${fmtNumber((top.value / kpis.total) * 100)}% of total ${fmtNumber(kpis.total)}`,
        },
        { label: `Weakest ${p.regionColumn}`, value: `${bottom.label} — ${fmtNumber(bottom.value)}` },
        {
          label: "Gap top vs bottom",
          value: fmtNumber(top.value - bottom.value),
          calculation: `${fmtNumber(top.value)} − ${fmtNumber(bottom.value)}`,
        },
      ],
      chart: {
        type: "bar",
        title: `${value} by ${p.regionColumn}`,
        data: grouped.slice(0, 12).map((g) => ({ label: g.label, value: g.value })),
      },
      sourceRows: rowsMatching(ds, p.regionColumn, top.label),
    };
  }

  // Product / category ranking
  if (
    p.productColumn &&
    has(q, "product", "item", "sku", "category", "top", "best", "worst", "poor", "highest", "lowest", "attention")
  ) {
    const grouped = groupSum(ds, p.productColumn, value);
    const worst = grouped[grouped.length - 1]!;
    const top = grouped[0]!;
    const wantsWorst = has(q, "worst", "poor", "lowest", "attention", "losing", "declin");
    const focus = wantsWorst ? worst : top;
    return {
      question,
      headline: wantsWorst
        ? `${worst.label} is the weakest ${p.productColumn} with ${value} of ${fmtNumber(worst.value)}.`
        : `${top.label} leads on ${value} with ${fmtNumber(top.value)}.`,
      aggregation: `SUM(${value}) grouped by ${p.productColumn}, sorted descending`,
      columnsUsed: [p.productColumn, value],
      filters: "None — all rows grouped",
      metrics: [
        ...grouped.slice(0, 5).map((g, i) => ({
          label: `#${i + 1} ${g.label}`,
          value: fmtNumber(g.value),
          calculation: `${fmtNumber((g.value / kpis.total) * 100)}% of total, ${g.rows} rows`,
        })),
        { label: `Weakest`, value: `${worst.label} — ${fmtNumber(worst.value)}` },
      ],
      chart: {
        type: "bar",
        title: `${value} by ${p.productColumn}`,
        data: grouped.slice(0, 12).map((g) => ({ label: g.label, value: g.value })),
      },
      sourceRows: rowsMatching(ds, p.productColumn, focus.label),
    };
  }

  // Average
  if (has(q, "average", "mean", "typical")) {
    return {
      question,
      headline: `Average ${value} is ${fmtNumber(kpis.average)} across ${kpis.count} records.`,
      aggregation: `AVG(${value})`,
      columnsUsed: [value],
      filters: "Rows with a numeric value only",
      metrics: [
        {
          label: `Average ${value}`,
          value: fmtNumber(kpis.average),
          calculation: `${fmtNumber(kpis.total)} / ${kpis.count}`,
        },
        { label: `Maximum`, value: fmtNumber(kpis.max) },
        { label: `Minimum`, value: fmtNumber(kpis.min) },
      ],
      sourceRows: ds.rows.slice(0, 10),
    };
  }

  // Totals / default overview
  const grouped = p.productColumn ? groupSum(ds, p.productColumn, value) : [];
  return {
    question,
    headline: `Total ${value} is ${fmtNumber(kpis.total)} across ${kpis.count} records.`,
    aggregation: `SUM(${value}), AVG(${value}), MIN/MAX(${value})`,
    columnsUsed: [value, ...(p.productColumn ? [p.productColumn] : [])],
    filters: "Rows with a numeric value only",
    metrics: [
      { label: `Total ${value}`, value: fmtNumber(kpis.total), calculation: `SUM over ${kpis.count} rows` },
      {
        label: `Average ${value}`,
        value: fmtNumber(kpis.average),
        calculation: `${fmtNumber(kpis.total)} / ${kpis.count}`,
      },
      { label: "Maximum", value: fmtNumber(kpis.max) },
      { label: "Minimum", value: fmtNumber(kpis.min) },
      ...(grouped.length > 0 ? [{ label: "Largest contributor", value: `${grouped[0]!.label} — ${fmtNumber(grouped[0]!.value)}` }] : []),
    ],
    ...(grouped.length > 1
      ? {
          chart: {
            type: "bar" as const,
            title: `${value} by ${p.productColumn}`,
            data: grouped.slice(0, 12).map((g) => ({ label: g.label, value: g.value })),
          },
        }
      : {}),
    sourceRows: ds.rows.slice(0, 10),
  };
}

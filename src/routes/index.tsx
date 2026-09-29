import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DataTable, Panel, Pill, Stat } from "@/components/ui-bits";
import {
  calculateKpis,
  detectAnomalies,
  fmtCompact,
  fmtNumber,
  generateInsights,
  groupSum,
  monthlySeries,
  profileColumns,
  qualityReport,
  type Dataset,
} from "@/lib/analysis";
import { parseBusinessFile } from "@/lib/file-parse";
import { explainInsight } from "@/lib/insight.functions";
import { answerQuestion, type QueryResult } from "@/lib/query-engine";
import { buildSampleDataset } from "@/lib/sample-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BizInsight AI — Explainable business data decisions" },
      {
        name: "description",
        content:
          "Upload a CSV or Excel file, ask questions in plain English, and see the exact rows and calculations behind every answer.",
      },
      { property: "og:title", content: "BizInsight AI — Explainable business data decisions" },
      {
        property: "og:description",
        content: "Upload business data, ask questions in plain English, and trace every answer to its source rows.",
      },
    ],
  }),
  component: Home,
});

const EXAMPLES = [
  "What is the total revenue?",
  "Which product generated the highest sales?",
  "Which region is performing best?",
  "Why did sales decrease recently?",
  "What are the top 5 products?",
  "Which month had the highest revenue?",
  "Are there any unusual sales values?",
  "What should I focus on next month?",
];

const SECTION_LABELS = ["ANSWER", "REASONING", "BUSINESS IMPACT", "RECOMMENDATION"] as const;

function parseSections(text: string) {
  const out: { label: string; body: string }[] = [];
  const pattern = new RegExp(`^(${SECTION_LABELS.join("|")}):?\\s*$`, "i");
  let current: { label: string; body: string } | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const match = line.match(pattern) ?? line.match(new RegExp(`^(${SECTION_LABELS.join("|")}):\\s*(.+)$`, "i"));
    if (match) {
      if (current) out.push(current);
      current = { label: match[1].toUpperCase(), body: (match[2] ?? "").trim() };
    } else if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    }
  }
  if (current) out.push(current);
  return out.filter((s) => s.body.length > 0);
}

function ChartFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

const axisProps = {
  stroke: "var(--color-muted-foreground)",
  tick: { fill: "var(--color-muted-foreground)", fontSize: 11 },
};

const tooltipStyle = {
  contentStyle: {
    background: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    color: "var(--color-popover-foreground)",
    fontSize: "12px",
  },
  formatter: (v: number | string) => fmtNumber(Number(v)),
};

function BarViz({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ChartFrame>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval={0} angle={data.length > 6 ? -20 : 0} height={40} />
        <YAxis tickFormatter={(v) => fmtCompact(Number(v))} {...axisProps} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey="value" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

function LineViz({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ChartFrame>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} height={40} />
        <YAxis tickFormatter={(v) => fmtCompact(Number(v))} {...axisProps} />
        <Tooltip {...tooltipStyle} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--color-chart-2)"
          strokeWidth={2.5}
          dot={{ r: 2, fill: "var(--color-chart-2)" }}
        />
      </LineChart>
    </ChartFrame>
  );
}

function Home() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [valueColumn, setValueColumn] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [aiText, setAiText] = useState<string>("");
  const [aiError, setAiError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const explain = useServerFn(explainInsight);
  const askMutation = useMutation({
    mutationFn: async (asked: string) => {
      if (!dataset) throw new Error("Upload data first.");
      const computed = answerQuestion(asked, dataset, { ...profile!, valueColumn: valueColumn ?? profile!.valueColumn });
      setResult(computed);
      setAiText("");
      setAiError(null);
      const response = await explain({
        data: {
          question: asked,
          datasetSummary: `File: ${dataset.fileName}. Rows: ${dataset.rows.length}. Columns: ${dataset.columns.join(", ")}.`,
          computed: JSON.stringify(
            {
              headline: computed.headline,
              aggregation: computed.aggregation,
              filters: computed.filters,
              columnsUsed: computed.columnsUsed,
              metrics: computed.metrics,
              insufficient: computed.insufficient ?? false,
            },
            null,
            1,
          ).slice(0, 7500),
        },
      });
      if (!response.ok) setAiError(response.error ?? "AI explanation unavailable.");
      else setAiText(response.text);
    },
  });

  const profile = useMemo(() => (dataset ? profileColumns(dataset) : null), [dataset]);
  const quality = useMemo(() => (dataset ? qualityReport(dataset) : null), [dataset]);
  const activeValue = valueColumn ?? profile?.valueColumn ?? null;
  const kpis = useMemo(
    () => (dataset && activeValue ? calculateKpis(dataset, activeValue) : null),
    [dataset, activeValue],
  );
  const insights = useMemo(
    () => (dataset && profile ? generateInsights(dataset, { ...profile, valueColumn: activeValue }) : []),
    [dataset, profile, activeValue],
  );
  const trend = useMemo(
    () =>
      dataset && profile?.dateColumn && activeValue ? monthlySeries(dataset, profile.dateColumn, activeValue) : [],
    [dataset, profile, activeValue],
  );
  const byProduct = useMemo(
    () => (dataset && profile?.productColumn && activeValue ? groupSum(dataset, profile.productColumn, activeValue) : []),
    [dataset, profile, activeValue],
  );
  const byRegion = useMemo(
    () => (dataset && profile?.regionColumn && activeValue ? groupSum(dataset, profile.regionColumn, activeValue) : []),
    [dataset, profile, activeValue],
  );
  const anomalies = useMemo(
    () => (dataset && activeValue ? detectAnomalies(dataset, activeValue) : null),
    [dataset, activeValue],
  );

  const loadDataset = (ds: Dataset) => {
    setDataset(ds);
    setValueColumn(null);
    setResult(null);
    setAiText("");
    setAiError(null);
    setLoadError(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      loadDataset(await parseBusinessFile(file));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not read that file.");
      setDataset(null);
    }
  };

  const ask = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || !dataset) return;
    setQuestion(trimmed);
    askMutation.mutate(trimmed);
  };

  const sections = aiText ? parseSections(aiText) : [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <Pill tone="primary">Explainable decision engine</Pill>
        <h1 className="mt-4 font-display text-4xl font-bold sm:text-5xl">BizInsight AI</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Turn scattered business data into accurate answers you can trace. Every number is calculated from your own
          file — the AI only explains what the calculations already prove.
        </p>
      </header>

      <Panel
        title="1. Upload your data"
        subtitle="CSV, XLSX or XLS. The first row must contain column headers."
        className="mb-6"
        right={
          <button
            onClick={() => loadDataset(buildSampleDataset())}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            Load sample dataset
          </button>
        }
      >
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files?.[0]);
          }}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/60 px-6 py-10 text-center"
        >
          <p className="text-sm text-muted-foreground">Drag a spreadsheet here, or</p>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Choose a file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0] ?? undefined)}
          />
        </div>
        {loadError && <p className="mt-3 text-sm text-destructive">{loadError}</p>}
        {dataset && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="File" value={dataset.fileName} />
            <Stat label="Rows" value={fmtNumber(dataset.rows.length)} />
            <Stat label="Columns" value={String(dataset.columns.length)} />
            <Stat label="Detected measure" value={activeValue ?? "none"} />
          </div>
        )}
      </Panel>

      {dataset && quality && profile && (
        <>
          <Panel title="2. Dataset information" subtitle="First 10 rows exactly as they were read." className="mb-6">
            <div className="mb-4 flex flex-wrap gap-2">
              {dataset.columns.map((c) => (
                <Pill key={c}>{c}</Pill>
              ))}
            </div>
            <DataTable columns={dataset.columns} rows={dataset.rows.slice(0, 10)} />
          </Panel>

          <Panel title="3. Data quality" className="mb-6">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Total rows" value={fmtNumber(quality.rows)} />
              <Stat label="Total columns" value={String(quality.columns)} />
              <Stat label="Missing values" value={fmtNumber(quality.missing)} />
              <Stat label="Duplicate rows" value={fmtNumber(quality.duplicates)} />
              <Stat label="Numeric columns" value={String(quality.numericCount)} />
              <Stat label="Categorical columns" value={String(quality.categoricalCount)} />
            </div>
            <div className="mt-4 space-y-2">
              {quality.missing > 0 && (
                <p className="text-sm text-warning">
                  Warning: {fmtNumber(quality.missing)} empty cells were found. Aggregations skip them, so totals may
                  understate reality.
                </p>
              )}
              {quality.duplicates > 0 && (
                <p className="text-sm text-warning">
                  Warning: {fmtNumber(quality.duplicates)} fully duplicated rows were found and are counted twice in
                  every total.
                </p>
              )}
              {quality.missing === 0 && quality.duplicates === 0 && (
                <p className="text-sm text-success">No missing values or duplicate rows detected.</p>
              )}
            </div>
          </Panel>

          <Panel
            title="4. Business KPIs"
            subtitle={activeValue ? `Calculated on "${activeValue}".` : undefined}
            className="mb-6"
            right={
              profile.numeric.length > 1 ? (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Measure
                  <select
                    value={activeValue ?? ""}
                    onChange={(e) => setValueColumn(e.target.value)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
                  >
                    {profile.numeric.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              ) : undefined
            }
          >
            {kpis ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Stat label={`Total ${kpis.column}`} value={fmtNumber(kpis.total)} hint={`SUM over ${kpis.count} rows`} />
                <Stat
                  label="Average"
                  value={fmtNumber(kpis.average)}
                  hint={`${fmtCompact(kpis.total)} / ${kpis.count}`}
                />
                <Stat label="Maximum" value={fmtNumber(kpis.max)} />
                <Stat label="Minimum" value={fmtNumber(kpis.min)} />
                <Stat label="Records" value={fmtNumber(kpis.count)} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No numeric column was detected, so business KPIs cannot be calculated for this file.
              </p>
            )}
          </Panel>

          <Panel title="5. Automatic insights" subtitle="Generated from this file only." className="mb-6">
            <div className="grid gap-3 md:grid-cols-2">
              {insights.map((insight, i) => (
                <article key={i} className="rounded-lg border border-border bg-surface/70 p-4">
                  <p className="font-medium">{insight.title}</p>
                  <p className="mt-2 text-sm text-primary">{insight.supporting}</p>
                  <p className="calc-mono mt-2">Source: {insight.source}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{insight.implication}</p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel
            title="6. Ask your business data"
            subtitle="Ask anything in plain English. Calculations run on your file; the AI explains the result."
            className="mb-6"
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") ask(question);
                }}
                placeholder="e.g. Which region is performing best?"
                className="flex-1 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={() => ask(question)}
                disabled={askMutation.isPending || !question.trim()}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {askMutation.isPending ? "Analyzing…" : "Analyze"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => ask(ex)}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>

            {result && (
              <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
                  <p className="kpi-label">Answer</p>
                  <p className="mt-1.5 text-base font-medium">{result.headline}</p>
                </div>

                {askMutation.isPending && (
                  <p className="text-sm text-muted-foreground">Writing the explanation from the calculated values…</p>
                )}
                {aiError && (
                  <p className="text-sm text-destructive">
                    The explanation could not be generated ({aiError}). The calculated answer and evidence above and
                    below are still exact.
                  </p>
                )}
                {sections.map((s) => (
                  <div key={s.label} className="rounded-lg border border-border bg-surface/70 p-4">
                    <p className="kpi-label">{s.label}</p>
                    <p className="mt-1.5 whitespace-pre-line text-sm">{s.body}</p>
                  </div>
                ))}

                {result.metrics.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {result.metrics.map((m, i) => (
                      <div key={i} className="rounded-lg border border-border bg-card p-3.5">
                        <p className="kpi-label">{m.label}</p>
                        <p className="mt-1 font-display text-lg font-semibold">{m.value}</p>
                        {m.calculation && <p className="calc-mono mt-1">{m.calculation}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {result.chart && (
                  <div className="rounded-lg border border-border bg-surface/70 p-4">
                    <p className="mb-2 text-sm font-medium">{result.chart.title}</p>
                    {result.chart.type === "line" ? (
                      <LineViz data={result.chart.data} />
                    ) : (
                      <BarViz data={result.chart.data} />
                    )}
                  </div>
                )}

                <details className="rounded-lg border border-border bg-surface/70 p-4">
                  <summary className="cursor-pointer text-sm font-medium">🔍 Show evidence</summary>
                  <div className="mt-4 space-y-3 text-sm">
                    <p>
                      <span className="kpi-label">Question</span>
                      <br />
                      {result.question}
                    </p>
                    <p>
                      <span className="kpi-label">Columns used</span>
                      <br />
                      {result.columnsUsed.join(", ") || "—"}
                    </p>
                    <p>
                      <span className="kpi-label">Aggregation</span>
                      <br />
                      <span className="calc-mono">{result.aggregation}</span>
                    </p>
                    <p>
                      <span className="kpi-label">Filters applied</span>
                      <br />
                      {result.filters}
                    </p>
                    {result.metrics.some((m) => m.calculation) && (
                      <div>
                        <span className="kpi-label">Calculations</span>
                        <ul className="mt-1 space-y-1">
                          {result.metrics
                            .filter((m) => m.calculation)
                            .map((m, i) => (
                              <li key={i} className="calc-mono">
                                {m.label}: {m.calculation} = {m.value}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                    {result.sourceRows.length > 0 && (
                      <div>
                        <span className="kpi-label">Source rows</span>
                        <div className="mt-2">
                          <DataTable columns={dataset.columns} rows={result.sourceRows} />
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            )}
          </Panel>

          <Panel title="7. Dashboard" subtitle="Charts adapt to the columns found in your file." className="mb-6">
            <div className="grid gap-5 lg:grid-cols-2">
              {trend.length > 1 && (
                <div>
                  <p className="mb-2 text-sm font-medium">
                    {activeValue} trend by {profile.dateColumn}
                  </p>
                  <LineViz data={trend.map((t) => ({ label: t.label, value: t.value }))} />
                </div>
              )}
              {byProduct.length > 1 && (
                <div>
                  <p className="mb-2 text-sm font-medium">
                    {activeValue} by {profile.productColumn}
                  </p>
                  <BarViz data={byProduct.slice(0, 10).map((g) => ({ label: g.label, value: g.value }))} />
                </div>
              )}
              {byRegion.length > 1 && (
                <div>
                  <p className="mb-2 text-sm font-medium">
                    {activeValue} by {profile.regionColumn}
                  </p>
                  <BarViz data={byRegion.slice(0, 10).map((g) => ({ label: g.label, value: g.value }))} />
                </div>
              )}
              {byProduct.length > 1 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Top 5 by {activeValue}</p>
                  <BarViz data={byProduct.slice(0, 5).map((g) => ({ label: g.label, value: g.value }))} />
                </div>
              )}
              {trend.length <= 1 && byProduct.length <= 1 && byRegion.length <= 1 && (
                <p className="text-sm text-muted-foreground">
                  No groupable columns were detected, so charts cannot be generated for this file.
                </p>
              )}
            </div>
          </Panel>

          <Panel title="8. Anomaly check (IQR)" subtitle="Transparent statistics — flagged values are unusual, not proven errors.">
            {anomalies ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Stat label="Q1" value={fmtNumber(anomalies.q1)} />
                  <Stat label="Q3" value={fmtNumber(anomalies.q3)} />
                  <Stat label="IQR" value={fmtNumber(anomalies.iqr)} hint="Q3 − Q1" />
                  <Stat label="Lower bound" value={fmtNumber(anomalies.lower)} hint="Q1 − 1.5 × IQR" />
                  <Stat label="Upper bound" value={fmtNumber(anomalies.upper)} hint="Q3 + 1.5 × IQR" />
                </div>
                {anomalies.anomalies.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-warning">
                      Potential anomaly detected: {anomalies.anomalies.length} value(s) fall outside the bounds above.
                    </p>
                    <DataTable columns={dataset.columns} rows={anomalies.anomalies.slice(0, 10).map((a) => a.row)} />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-success">Every value sits inside the IQR bounds.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not enough numeric values in this file for a reliable IQR analysis.
              </p>
            )}
          </Panel>
        </>
      )}
    </main>
  );
}

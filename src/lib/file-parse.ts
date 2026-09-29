import Papa from "papaparse";

import type { Dataset, Row } from "./analysis";

function normalizeRows(raw: Record<string, unknown>[], columns: string[]): Row[] {
  return raw.map((r) => {
    const row: Row = {};
    for (const col of columns) {
      const v = r[col];
      row[col] = v === undefined || v === null || v === "" ? null : (v as string | number);
    }
    return row;
  });
}

export async function parseBusinessFile(file: File): Promise<Dataset> {
  const name = file.name;
  const lower = name.toLowerCase();

  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    const columns = (parsed.meta.fields ?? []).filter(Boolean);
    if (columns.length === 0) throw new Error("No columns found — is the first row a header?");
    return { fileName: name, columns, rows: normalizeRows(parsed.data, columns) };
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("The workbook has no sheets.");
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
      defval: null,
      raw: true,
    });
    if (json.length === 0) throw new Error("The first sheet is empty.");
    const columns = Object.keys(json[0]).map((c) => c.trim());
    const remapped = json.map((r) => {
      const out: Record<string, unknown> = {};
      Object.entries(r).forEach(([k, v]) => {
        out[k.trim()] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
      });
      return out;
    });
    return { fileName: name, columns, rows: normalizeRows(remapped, columns) };
  }

  throw new Error("Unsupported file type. Please upload a CSV, XLSX or XLS file.");
}

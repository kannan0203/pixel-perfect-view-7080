import type { Dataset } from "./analysis";

const PRODUCTS = ["Aurora Blend", "Nordic Roast", "Cascade Tea", "Ember Cocoa"];
const REGIONS = ["North", "South", "East", "West"];
const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

const BASE: Record<string, number> = {
  "Aurora Blend": 42000,
  "Nordic Roast": 31000,
  "Cascade Tea": 18500,
  "Ember Cocoa": 12000,
};

export function buildSampleDataset(): Dataset {
  const rows = [] as Dataset["rows"];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  MONTHS.forEach((month, mIdx) => {
    PRODUCTS.forEach((product) => {
      REGIONS.forEach((region) => {
        const seasonal = 1 + mIdx * 0.04 - (product === "Cascade Tea" && mIdx >= 2 ? 0.22 : 0);
        const regionFactor = region === "South" ? 1.25 : region === "West" ? 0.78 : 1;
        const noise = 0.85 + rand() * 0.3;
        const revenue = Math.round((BASE[product] / 4) * seasonal * regionFactor * noise);
        const units = Math.max(1, Math.round(revenue / (120 + rand() * 60)));
        rows.push({
          order_date: `${month}-15`,
          product: product,
          region,
          units_sold: units,
          revenue,
        });
      });
    });
  });

  // one deliberate outlier, so anomaly detection has something to explain
  rows.push({ order_date: "2026-04-15", product: "Aurora Blend", region: "North", units_sold: 890, revenue: 148000 });

  return {
    fileName: "sample_business_data.csv",
    columns: ["order_date", "product", "region", "units_sold", "revenue"],
    rows,
  };
}

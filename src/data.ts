import Papa from 'papaparse';

export interface Row {
  id: number;
  date: string;
  description: string;
  category: string;
  amount: number;
}

export interface Highlight {
  ids: number[];
  note: string | null;
}

interface Store {
  rows: Row[];
  fileName: string | null;
  highlight: Highlight | null;
}

/**
 * Module-level store rather than component state: WebMCP captures `execute`
 * handlers at registration time, so handlers must read through a live
 * reference that survives re-renders.
 */
const store: Store = { rows: [], fileName: null, highlight: null };

const listeners = new Set<() => void>();

export const subscribe = (fn: () => void): void => {
  listeners.add(fn);
};

const notify = (): void => {
  listeners.forEach((fn) => fn());
};

export const getRows = (): Row[] => store.rows;
export const getFileName = (): string | null => store.fileName;
export const getHighlight = (): Highlight | null => store.highlight;

export const setHighlight = (ids: number[], note: string | null): void => {
  store.highlight = ids.length > 0 ? { ids, note } : null;
  notify();
};

export const clearHighlight = (): void => {
  store.highlight = null;
  notify();
};

/**
 * Bank exports commonly prefix or group amounts ("Rs. 1,200.50", "$2,500"), so
 * the first numeric run is extracted rather than deleting every non-digit —
 * deleting alone turns "Rs. 1,200.50" into ".1200.50" and yields 0.
 */
const toNumber = (value: unknown): number => {
  const match = String(value ?? '').match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return 0;
  const n = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const round = (n: number): number => Math.round(n * 100) / 100;

export function loadCsv(text: string, fileName: string): { rows: number; skipped: number } {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  let skipped = 0;
  const rows: Row[] = [];

  for (const record of parsed.data) {
    const date = record.date?.trim();
    const description = record.description?.trim();
    const category = record.category?.trim();
    const amountText = record.amount?.trim();
    if (!date || !description || !category || !amountText) {
      skipped += 1;
      continue;
    }
    rows.push({
      id: rows.length,
      date,
      description,
      category,
      amount: toNumber(record.amount),
    });
  }

  store.rows = rows;
  store.fileName = fileName;
  store.highlight = null;
  notify();

  return { rows: rows.length, skipped };
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
}

export function sumByCategory(): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>();

  for (const row of store.rows) {
    const entry = totals.get(row.category) ?? { category: row.category, total: 0, count: 0 };
    entry.total += row.amount;
    entry.count += 1;
    totals.set(row.category, entry);
  }

  return [...totals.values()]
    .map((t) => ({ ...t, total: round(t.total) }))
    .sort((a, b) => b.total - a.total);
}

export function categories(): string[] {
  return [...new Set(store.rows.map((r) => r.category))].sort();
}

export function describeDataset(): {
  loaded: boolean;
  fileName: string | null;
  rowCount: number;
  columns: string[];
  categories: string[];
  dateRange: { earliest: string; latest: string } | null;
  totalAmount: number;
} {
  const rows = store.rows;
  if (rows.length === 0) {
    return {
      loaded: false,
      fileName: null,
      rowCount: 0,
      columns: [],
      categories: [],
      dateRange: null,
      totalAmount: 0,
    };
  }

  const dates = rows.map((r) => r.date).sort();

  return {
    loaded: true,
    fileName: store.fileName,
    rowCount: rows.length,
    columns: ['date', 'description', 'category', 'amount'],
    categories: categories(),
    dateRange: { earliest: dates[0], latest: dates[dates.length - 1] },
    totalAmount: round(rows.reduce((sum, r) => sum + r.amount, 0)),
  };
}

export interface FilterCriteria {
  from?: string;
  to?: string;
  category?: string;
  minAmount?: number;
  maxAmount?: number;
}

export function filterRows(criteria: FilterCriteria): Row[] {
  return store.rows.filter((row) => {
    if (criteria.from && row.date < criteria.from) return false;
    if (criteria.to && row.date > criteria.to) return false;
    if (criteria.category && row.category.toLowerCase() !== criteria.category.toLowerCase()) {
      return false;
    }
    if (criteria.minAmount !== undefined && row.amount < criteria.minAmount) return false;
    if (criteria.maxAmount !== undefined && row.amount > criteria.maxAmount) return false;
    return true;
  });
}

export interface MonthTotal {
  month: string;
  total: number;
  count: number;
}

export function monthlyTrend(): MonthTotal[] {
  const months = new Map<string, MonthTotal>();

  for (const row of store.rows) {
    const month = row.date.slice(0, 7);
    const entry = months.get(month) ?? { month, total: 0, count: 0 };
    entry.total += row.amount;
    entry.count += 1;
    months.set(month, entry);
  }

  return [...months.values()]
    .map((m) => ({ ...m, total: round(m.total) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface Anomaly {
  row: Row;
  categoryMean: number;
  zScore: number;
}

/**
 * Flags rows sitting far above the rest of their own category. Categories with
 * fewer than three rows are skipped, since a mean over one or two points says
 * nothing useful.
 *
 * The 2.5 default is tuned for a realistic year of data: on the bundled
 * 965-row sample it returns the four genuinely unusual rows and nothing else,
 * whereas a looser 1.2 returned 55 — mostly ordinary variation in the two
 * highest-volume categories.
 */
export function findAnomalies(threshold = 2.5): Anomaly[] {
  const byCategory = new Map<string, Row[]>();
  for (const row of store.rows) {
    byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
  }

  const anomalies: Anomaly[] = [];

  for (const rows of byCategory.values()) {
    if (rows.length < 3) continue;

    const mean = rows.reduce((sum, r) => sum + r.amount, 0) / rows.length;
    const variance = rows.reduce((sum, r) => sum + (r.amount - mean) ** 2, 0) / rows.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) continue;

    for (const row of rows) {
      const zScore = (row.amount - mean) / stdDev;
      if (zScore >= threshold) {
        anomalies.push({ row, categoryMean: round(mean), zScore: round(zScore) });
      }
    }
  }

  return anomalies.sort((a, b) => b.zScore - a.zScore);
}

export function topExpenses(limit: number): Row[] {
  return [...store.rows].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

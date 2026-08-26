import Papa from 'papaparse';

export interface Row {
  date: string;
  description: string;
  category: string;
  amount: number;
}

interface Store {
  rows: Row[];
  fileName: string | null;
  highlightCategory: string | null;
}

/**
 * Module-level store rather than component state: WebMCP captures `execute`
 * handlers at registration time, so handlers must read through a live
 * reference that survives re-renders.
 */
const store: Store = { rows: [], fileName: null, highlightCategory: null };

const listeners = new Set<() => void>();

export const subscribe = (fn: () => void): void => {
  listeners.add(fn);
};

const notify = (): void => {
  listeners.forEach((fn) => fn());
};

export const getRows = (): Row[] => store.rows;
export const getFileName = (): string | null => store.fileName;
export const getHighlightCategory = (): string | null => store.highlightCategory;

export const setHighlightCategory = (category: string | null): void => {
  store.highlightCategory = category;
  notify();
};

const toNumber = (value: unknown): number => {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

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
    if (!date || !description || !category) {
      skipped += 1;
      continue;
    }
    rows.push({ date, description, category, amount: toNumber(record.amount) });
  }

  store.rows = rows;
  store.fileName = fileName;
  store.highlightCategory = null;
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
    .map((t) => ({ ...t, total: Math.round(t.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
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
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  return {
    loaded: true,
    fileName: store.fileName,
    rowCount: rows.length,
    columns: ['date', 'description', 'category', 'amount'],
    categories: [...new Set(rows.map((r) => r.category))].sort(),
    dateRange: { earliest: dates[0], latest: dates[dates.length - 1] },
    totalAmount: Math.round(total * 100) / 100,
  };
}

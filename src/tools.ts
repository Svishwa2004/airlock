import {
  categories,
  clearHighlight,
  describeDataset,
  filterRows,
  findAnomalies,
  getPrivacyMode,
  getRows,
  monthlyTrend,
  setHighlight,
  sumByCategory,
  topExpenses,
  type Row,
} from './data.ts';
import { registerTool } from './webmcp.ts';

const readOnly = { readOnlyHint: true };

/**
 * A loose threshold over a year of data can match dozens of rows. The table
 * still highlights every one of them, but the tool result lists only the
 * strongest — the premise is that aggregates leave the tab, not records.
 */
const ANOMALY_LIST_LIMIT = 25;

const noData = {
  error: 'no_data_loaded',
  message: 'No spreadsheet is loaded. Ask the user to choose a CSV file first.',
} as const;

/**
 * Sent with every withheld result so the model explains the situation to the
 * human instead of assuming the tool failed.
 */
const privacyNote =
  'Privacy mode is on, so individual rows are withheld from tool results. The matching rows are highlighted in the page for the human to read. Ask the human to switch privacy mode off if you need the row details themselves.';

/** Rows are summarised, never dumped wholesale — the point is that data stays put. */
const summarise = (row: Row) => ({
  date: row.date,
  description: row.description,
  category: row.category,
  amount: row.amount,
});

const round = (n: number): number => Math.round(n * 100) / 100;

const sumOf = (rows: Row[]): number => round(rows.reduce((sum, r) => sum + r.amount, 0));

/**
 * Tool handlers. Exported individually so the privacy gate — the most
 * claim-critical logic here — can be unit-tested without a browser;
 * `registerTools` only wires them to WebMCP.
 *
 * Failures are reported as return values rather than thrown. Verified on
 * Chrome 151: a thrown Error reaches the agent as a generic "Tool was executed
 * but the invocation failed", so the recovery hint in the message is lost.
 * Returning it keeps the hint visible.
 */
export const describeDatasetTool = () => {
  const described = describeDataset();
  if (!getPrivacyMode()) return described;

  // A file name can disclose as much as a row: "payslip-july.csv".
  return {
    ...described,
    fileName: null,
    privacyMode: true,
    note: 'The file name is withheld while privacy mode is on. Row count, categories, date range and total are aggregates and are safe to report.',
  };
};

export const sumByCategoryTool = (args?: { highlight?: string }) => {
  const totals = sumByCategory();
  if (totals.length === 0) return noData;

  if (args?.highlight) {
    const match = totals.find((t) => t.category.toLowerCase() === args.highlight?.toLowerCase());
    if (!match) {
      return {
        error: 'unknown_category',
        message: `No category named "${args.highlight}".`,
        validCategories: totals.map((t) => t.category),
      };
    }
    const ids = getRows()
      .filter((r) => r.category === match.category)
      .map((r) => r.id);
    setHighlight(ids, `${match.category}: ${match.count} rows`);
    return {
      totals,
      effect: `The ${ids.length} rows in "${match.category}" are now highlighted in the table; all other rows are dimmed.`,
    };
  }

  clearHighlight();
  return { totals };
};

export const filterRowsTool = (args?: {
  from?: string;
  to?: string;
  category?: string;
  min_amount?: number;
  max_amount?: number;
  limit?: number;
}) => {
  if (getRows().length === 0) return noData;

  if (args?.category) {
    const known = categories();
    if (!known.some((c) => c.toLowerCase() === args.category?.toLowerCase())) {
      return {
        error: 'unknown_category',
        message: `No category named "${args.category}".`,
        validCategories: known,
      };
    }
  }

  const matches = filterRows({
    from: args?.from,
    to: args?.to,
    category: args?.category,
    minAmount: args?.min_amount,
    maxAmount: args?.max_amount,
  });

  if (matches.length === 0) {
    clearHighlight();
    return {
      matchCount: 0,
      total: 0,
      preview: [],
      effect: 'No rows matched; the table is left unhighlighted.',
    };
  }

  const total = sumOf(matches);
  setHighlight(
    matches.map((r) => r.id),
    `${matches.length} matching rows`
  );
  const effect = `${matches.length} matching rows are now highlighted in the table; all other rows are dimmed.`;

  if (getPrivacyMode()) {
    return {
      matchCount: matches.length,
      total,
      rowsWithheld: true,
      privacyMode: true,
      note: privacyNote,
      effect,
    };
  }

  const limit = Math.min(Math.max(args?.limit ?? 10, 1), 25);
  return {
    matchCount: matches.length,
    total,
    preview: matches.slice(0, limit).map(summarise),
    previewTruncated: matches.length > limit,
    effect,
  };
};

export const monthlyTrendTool = () => {
  const months = monthlyTrend();
  if (months.length === 0) return noData;

  const change =
    months.length >= 2 ? round(months[months.length - 1].total - months[0].total) : null;

  return { months, changeFirstToLast: change };
};

export const findAnomaliesTool = (args?: { threshold?: number }) => {
  if (getRows().length === 0) return noData;

  const anomalies = findAnomalies(args?.threshold);
  if (anomalies.length === 0) {
    clearHighlight();
    return {
      anomalyCount: 0,
      anomalies: [],
      effect: 'Nothing stood out at this threshold; the table is left unhighlighted.',
    };
  }

  setHighlight(
    anomalies.map((a) => a.row.id),
    `${anomalies.length} unusual rows`
  );
  const effect = `${anomalies.length} unusual rows are now highlighted in the table; all other rows are dimmed.`;

  if (getPrivacyMode()) {
    // Category names are already disclosed by describe_dataset, so naming the
    // affected ones keeps the answer useful without opening a new leak.
    return {
      anomalyCount: anomalies.length,
      categoriesAffected: [...new Set(anomalies.map((a) => a.row.category))],
      rowsWithheld: true,
      privacyMode: true,
      note: privacyNote,
      effect,
    };
  }

  const listed = anomalies.slice(0, ANOMALY_LIST_LIMIT);
  return {
    anomalyCount: anomalies.length,
    anomalies: listed.map((a) => ({
      ...summarise(a.row),
      categoryMean: a.categoryMean,
      zScore: a.zScore,
    })),
    anomaliesTruncated: anomalies.length > listed.length,
    effect,
  };
};

export const topExpensesTool = (args?: { limit?: number }) => {
  if (getRows().length === 0) return noData;

  const limit = Math.min(Math.max(args?.limit ?? 5, 1), 25);
  const rows = topExpenses(limit);

  setHighlight(
    rows.map((r) => r.id),
    `top ${rows.length} by amount`
  );
  const effect = `The ${rows.length} largest rows are now highlighted in the table; all other rows are dimmed.`;

  if (getPrivacyMode()) {
    return {
      rowCount: rows.length,
      total: sumOf(rows),
      rowsWithheld: true,
      privacyMode: true,
      note: privacyNote,
      effect,
    };
  }

  return { rows: rows.map(summarise), effect };
};

export const clearHighlightsTool = () => {
  clearHighlight();
  return { effect: 'Highlighting cleared; all rows are shown normally.' };
};

export async function registerTools(): Promise<void> {
  await registerTool({
    name: 'describe_dataset',
    description:
      'Describe the spreadsheet currently loaded in the page: row count, column names, category list, date range and total amount. Call this first to learn what data is available. Individual rows are never returned. While the human has privacy mode on, the file name is withheld too.',
    inputSchema: { type: 'object', properties: {} },
    annotations: readOnly,
    execute: describeDatasetTool,
  });

  await registerTool<{ highlight?: string }>({
    name: 'sum_by_category',
    description:
      'Total the loaded spending by category, largest first. Optionally pass a category name to visually highlight its rows in the table for the human reading the page. Returns aggregates only, so it answers the same whether or not privacy mode is on.',
    inputSchema: {
      type: 'object',
      properties: {
        highlight: {
          type: 'string',
          description:
            'Exact category name to highlight in the table. Must match a category returned by describe_dataset.',
        },
      },
    },
    annotations: readOnly,
    execute: sumByCategoryTool,
  });

  await registerTool<{
    from?: string;
    to?: string;
    category?: string;
    min_amount?: number;
    max_amount?: number;
    limit?: number;
  }>({
    name: 'filter_rows',
    description:
      'Find rows matching any combination of date range, category and amount bounds. Returns how many matched and their total, and highlights every match in the table. While the human has privacy mode on the matching rows are withheld; with it off a small preview of them is included.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Earliest date to include, as YYYY-MM-DD.' },
        to: { type: 'string', description: 'Latest date to include, as YYYY-MM-DD.' },
        category: { type: 'string', description: 'Restrict to one category name.' },
        min_amount: { type: 'number', description: 'Smallest amount to include.' },
        max_amount: { type: 'number', description: 'Largest amount to include.' },
        limit: {
          type: 'number',
          description:
            'How many matching rows to preview. Defaults to 10, capped at 25. Ignored while privacy mode is on.',
        },
      },
    },
    annotations: readOnly,
    execute: filterRowsTool,
  });

  await registerTool({
    name: 'monthly_trend',
    description:
      'Total the loaded spending per calendar month, oldest first, so month-on-month changes are visible. Answers questions a single glance at the table cannot. Returns aggregates only, so it answers the same whether or not privacy mode is on.',
    inputSchema: { type: 'object', properties: {} },
    annotations: readOnly,
    execute: monthlyTrendTool,
  });

  await registerTool<{ threshold?: number }>({
    name: 'find_anomalies',
    description:
      'Find rows that are unusually large compared with the rest of their own category, using a z-score within each category. Categories with fewer than three rows are skipped. Highlights every outlier in the table. While the human has privacy mode on, only the count and the affected category names come back; with it off, the strongest outliers are listed with their amounts and z-scores.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description:
            'How many standard deviations above the category mean counts as unusual. Defaults to 2.5; raise it to be stricter, or lower it to surface milder variation.',
        },
      },
    },
    annotations: readOnly,
    execute: findAnomaliesTool,
  });

  await registerTool<{ limit?: number }>({
    name: 'top_expenses',
    description:
      'Find the largest individual rows by amount and highlight them in the table. While the human has privacy mode on, only how many were found and their combined total come back; with it off, the rows themselves are listed.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'How many rows to consider. Defaults to 5, capped at 25.',
        },
      },
    },
    annotations: readOnly,
    execute: topExpensesTool,
  });

  await registerTool({
    name: 'clear_highlights',
    description:
      'Remove any highlighting from the table so every row is legible again. Call this when moving on to an unrelated question.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false },
    execute: clearHighlightsTool,
  });
}

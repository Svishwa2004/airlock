import {
  categories,
  clearHighlight,
  describeDataset,
  filterRows,
  findAnomalies,
  getRows,
  monthlyTrend,
  setHighlight,
  sumByCategory,
  topExpenses,
  type Row,
} from './data';
import { registerTool } from './webmcp';

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

/** Rows are summarised, never dumped wholesale — the point is that data stays put. */
const summarise = (row: Row) => ({
  date: row.date,
  description: row.description,
  category: row.category,
  amount: row.amount,
});

/**
 * Tools report failures as return values rather than by throwing.
 * Verified on Chrome 151: a thrown Error reaches the agent as a generic
 * "Tool was executed but the invocation failed", so the recovery hint in the
 * message is lost. Returning it keeps the hint visible.
 */
export async function registerTools(): Promise<void> {
  await registerTool({
    name: 'describe_dataset',
    description:
      'Describe the spreadsheet currently loaded in the page: row count, column names, category list, date range and total amount. Call this first to learn what data is available. Individual rows are never returned.',
    inputSchema: { type: 'object', properties: {} },
    annotations: readOnly,
    execute: () => describeDataset(),
  });

  await registerTool<{ highlight?: string }>({
    name: 'sum_by_category',
    description:
      'Total the loaded spending by category, largest first. Optionally pass a category name to visually highlight its rows in the table for the human reading the page.',
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
    execute: (args) => {
      const totals = sumByCategory();
      if (totals.length === 0) return noData;

      if (args?.highlight) {
        const match = totals.find(
          (t) => t.category.toLowerCase() === args.highlight?.toLowerCase()
        );
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
    },
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
      'Find rows matching any combination of date range, category and amount bounds. Returns the match count, their total, and a small preview of matching rows, then highlights every match in the table. Use this instead of asking for the whole spreadsheet.',
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
          description: 'How many matching rows to preview. Defaults to 10, capped at 25.',
        },
      },
    },
    annotations: readOnly,
    execute: (args) => {
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

      const limit = Math.min(Math.max(args?.limit ?? 10, 1), 25);
      const total = Math.round(matches.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;

      setHighlight(
        matches.map((r) => r.id),
        `${matches.length} matching rows`
      );

      return {
        matchCount: matches.length,
        total,
        preview: matches.slice(0, limit).map(summarise),
        previewTruncated: matches.length > limit,
        effect: `${matches.length} matching rows are now highlighted in the table; all other rows are dimmed.`,
      };
    },
  });

  await registerTool({
    name: 'monthly_trend',
    description:
      'Total the loaded spending per calendar month, oldest first, so month-on-month changes are visible. Answers questions a single glance at the table cannot.',
    inputSchema: { type: 'object', properties: {} },
    annotations: readOnly,
    execute: () => {
      const months = monthlyTrend();
      if (months.length === 0) return noData;

      const change =
        months.length >= 2
          ? Math.round((months[months.length - 1].total - months[0].total) * 100) / 100
          : null;

      return { months, changeFirstToLast: change };
    },
  });

  await registerTool<{ threshold?: number }>({
    name: 'find_anomalies',
    description:
      'Find rows that are unusually large compared with the rest of their own category, using a z-score within each category. Categories with fewer than three rows are skipped. Returns the count, the strongest outliers, and highlights every one of them in the table.',
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
    execute: (args) => {
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

      const listed = anomalies.slice(0, ANOMALY_LIST_LIMIT);

      return {
        anomalyCount: anomalies.length,
        anomalies: listed.map((a) => ({
          ...summarise(a.row),
          categoryMean: a.categoryMean,
          zScore: a.zScore,
        })),
        anomaliesTruncated: anomalies.length > listed.length,
        effect: `${anomalies.length} unusual rows are now highlighted in the table; all other rows are dimmed.`,
      };
    },
  });

  await registerTool<{ limit?: number }>({
    name: 'top_expenses',
    description: 'List the largest individual rows by amount, and highlight them in the table.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'How many rows to return. Defaults to 5, capped at 25.',
        },
      },
    },
    annotations: readOnly,
    execute: (args) => {
      if (getRows().length === 0) return noData;

      const limit = Math.min(Math.max(args?.limit ?? 5, 1), 25);
      const rows = topExpenses(limit);

      setHighlight(
        rows.map((r) => r.id),
        `top ${rows.length} by amount`
      );

      return {
        rows: rows.map(summarise),
        effect: `The ${rows.length} largest rows are now highlighted in the table; all other rows are dimmed.`,
      };
    },
  });

  await registerTool({
    name: 'clear_highlights',
    description:
      'Remove any highlighting from the table so every row is legible again. Call this when moving on to an unrelated question.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false },
    execute: () => {
      clearHighlight();
      return { effect: 'Highlighting cleared; all rows are shown normally.' };
    },
  });
}

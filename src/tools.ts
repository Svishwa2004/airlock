import { describeDataset, setHighlightCategory, sumByCategory } from './data';
import { registerTool } from './webmcp';

const readOnly = { readOnlyHint: true };

/**
 * Tools report failures as return values rather than by throwing.
 * Verified in Chrome 151: a thrown Error reaches the caller as a generic
 * "Tool was executed but the invocation failed", so the recovery hint in the
 * message is lost. Returning it keeps the hint visible to the agent.
 */
export async function registerTools(): Promise<void> {
  await registerTool({
    name: 'describe_dataset',
    description:
      'Describe the spreadsheet currently loaded in the page: row count, column names, category list, date range and total amount. Call this first to learn what data is available. The rows themselves are never returned.',
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

      if (totals.length === 0) {
        return {
          error: 'no_data_loaded',
          message: 'No spreadsheet is loaded. Ask the user to choose a CSV file first.',
        };
      }

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
        setHighlightCategory(match.category);
        return {
          totals,
          effect: `Rows in "${match.category}" are now highlighted in the table; all other rows are dimmed.`,
        };
      }

      setHighlightCategory(null);
      return { totals };
    },
  });
}

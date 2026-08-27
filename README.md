# Airlock

An AI agent can analyse your spreadsheet without ever receiving it.

Airlock loads a CSV, parses it and computes over it **entirely inside the browser tab**, then exposes that computation to an AI agent as [WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools. The agent asks questions and reads answers; the rows themselves never cross the network. Open your browser's network panel during a conversation and it stays empty.

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/).

## Why WebMCP specifically

A cloud model normally has to *receive* your data to analyse it, which is exactly what stops people pasting bank statements, lab results or payroll into a chatbot. WebMCP tools execute in page context, so the agent can invoke a calculation over local data and receive only the aggregate it asked for. That is not a faster version of something that already worked — without client-side tool execution it could not be done at all.

## Requirements

- **Node 24+**
- One of:
  - **Chrome 149 or newer** with `chrome://flags/#enable-webmcp-testing` set to *Enabled*, then relaunched
    (equivalently, launch Chrome with `--enable-features=WebMCP`)
  - the **ChatGPT desktop app's built-in browser**, where WebMCP is enabled by default

Verified working on Chrome 151.0.7922.174.

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed URL in a WebMCP-enabled browser. The badge in the top-right reports how many tools registered; hover it for their names. The sample expenses dataset loads on first paint — choose your own CSV with `date`, `description`, `category` and `amount` columns to replace it, and pick the currency in which amounts should be displayed.

```bash
npm test          # unit tests for the analysis functions
npm run build     # typecheck, then production build into dist/
npm run preview   # serve the production build
```

## Registered tools

| Tool | Reads or writes | What it does |
|---|---|---|
| `describe_dataset` | read-only | Row count, column names, category list, date range and total. Returns no rows. |
| `sum_by_category` | read-only | Totals spending per category, largest first. Optionally highlights one category's rows in the table for the human. |
| `filter_rows` | read-only | Matches rows by date range, category and amount bounds; highlights every match and returns a bounded preview. |
| `monthly_trend` | read-only | Totals per calendar month, oldest first, plus the first-to-last change. |
| `find_anomalies` | read-only | Per-category z-score outliers (categories with fewer than three rows are skipped); highlights what it finds. |
| `top_expenses` | read-only | Largest rows by amount, highlighted in the table. |
| `clear_highlights` | writes | Removes highlighting so all rows are legible again. |

Tools are registered in [`src/tools.ts`](src/tools.ts) through the thin wrapper in [`src/webmcp.ts`](src/webmcp.ts), which calls `document.modelContext.registerTool`.

## Notes on the WebMCP API, verified empirically

These were confirmed against Chrome 151 rather than taken from documentation, and two of them contradict common guidance:

1. `navigator.modelContext` and `document.modelContext` are **the same object**. The documented spelling is `document`.
2. `executeTool` takes the **tool object** returned by `getTools()`, not a tool name string.
3. Object return values arrive at the caller **serialised as a JSON string**, so callers must parse.
4. A thrown `Error` reaches the caller as a generic *"Tool was executed but the invocation failed"* — **the message is lost**. Tools here therefore return failures as values (`{ error, message, validCategories }`) so the recovery hint survives.
5. `execute` handlers are captured at registration and never re-registered, so they must read live state through a module-level store rather than closing over a snapshot. This project uses plain TypeScript with a module store, which sidesteps the problem entirely.

## Project layout

```
index.html                  page shell
verify.html                 dev-only harness: drives every tool end to end
public/sample-expenses.csv  seeded demo data
src/data.ts                 CSV parsing, module-level store, aggregations
src/data.test.ts            unit tests for the analysis functions
src/tools.ts                WebMCP tool definitions
src/webmcp.ts               typed wrapper around document.modelContext
src/main.ts                 rendering and wiring
src/style.css               styles
```

`verify.html` is a development harness, not part of the product; it is excluded from the production build.

## Licence

[MIT](LICENSE).

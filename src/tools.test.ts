import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPrivacyMode, loadCsv, setPrivacyMode } from './data.ts';
import {
  describeDatasetTool,
  filterRowsTool,
  findAnomaliesTool,
  monthlyTrendTool,
  sumByCategoryTool,
  topExpensesTool,
} from './tools.ts';

/**
 * Privacy mode is the boundary the project claims, so what each tool does and
 * does not hand back is asserted directly rather than inferred from the UI.
 */

const SAMPLE = `date,description,category,amount
2026-07-02,Hostel rent,Housing,28000
2026-07-05,Supermarket run,Groceries,8450
2026-07-05,Bus top-up,Transport,700
2026-07-08,Train ticket,Transport,650
2026-07-10,Taxi ride,Transport,750
2026-07-12,Restaurant dinner,Dining,2300
2026-07-30,Airport transfer,Transport,12400
`;

const load = () => loadCsv(SAMPLE, 'payslip-july.csv');

const containsRowContent = (value: unknown): boolean =>
  JSON.stringify(value).includes('Airport transfer');

test('privacy mode defaults to on', () => {
  assert.equal(getPrivacyMode(), true);
});

test('privacy mode withholds the file name from describe_dataset', () => {
  load();
  setPrivacyMode(true);
  const withheld = describeDatasetTool() as Record<string, unknown>;
  assert.equal(withheld.fileName, null, 'a file name can disclose as much as a row');
  assert.equal(withheld.privacyMode, true);
  assert.equal(withheld.rowCount, 7, 'aggregates are still reported');

  setPrivacyMode(false);
  assert.equal((describeDatasetTool() as Record<string, unknown>).fileName, 'payslip-july.csv');
});

test('privacy mode withholds row contents from filter_rows', () => {
  load();
  setPrivacyMode(true);
  const withheld = filterRowsTool({ category: 'Transport' }) as Record<string, unknown>;
  assert.equal(withheld.matchCount, 4);
  assert.equal(withheld.total, 14500);
  assert.equal(withheld.rowsWithheld, true);
  assert.equal(withheld.preview, undefined);
  assert.ok(typeof withheld.note === 'string' && withheld.note.length > 0);
  assert.ok(!containsRowContent(withheld), 'no row description may reach the model');

  setPrivacyMode(false);
  const open = filterRowsTool({ category: 'Transport' }) as Record<string, unknown>;
  assert.equal(open.rowsWithheld, undefined);
  assert.equal((open.preview as unknown[]).length, 4);
  assert.ok(containsRowContent(open), 'with privacy off the preview carries rows');
});

test('privacy mode reduces find_anomalies to a count and its categories', () => {
  load();
  setPrivacyMode(true);
  const withheld = findAnomaliesTool({ threshold: 1.5 }) as Record<string, unknown>;
  assert.equal(withheld.anomalyCount, 1);
  assert.deepEqual(withheld.categoriesAffected, ['Transport']);
  assert.equal(withheld.rowsWithheld, true);
  assert.ok(!containsRowContent(withheld));

  setPrivacyMode(false);
  const open = findAnomaliesTool({ threshold: 1.5 }) as Record<string, unknown>;
  assert.equal((open.anomalies as unknown[]).length, 1);
  assert.ok(containsRowContent(open));
});

test('privacy mode reduces top_expenses to a count and a total', () => {
  load();
  setPrivacyMode(true);
  const withheld = topExpensesTool({ limit: 2 }) as Record<string, unknown>;
  assert.equal(withheld.rowCount, 2);
  assert.equal(withheld.total, 40400);
  assert.equal(withheld.rows, undefined);
  assert.ok(!containsRowContent(withheld));

  setPrivacyMode(false);
  const open = topExpensesTool({ limit: 2 }) as Record<string, unknown>;
  assert.equal((open.rows as unknown[]).length, 2);
  assert.ok(containsRowContent(open));
});

test('aggregate-only tools answer identically in both modes', () => {
  load();
  setPrivacyMode(true);
  const totalsOn = sumByCategoryTool();
  const trendOn = monthlyTrendTool();

  setPrivacyMode(false);
  assert.deepEqual(sumByCategoryTool(), totalsOn);
  assert.deepEqual(monthlyTrendTool(), trendOn);
});

test('every tool still highlights the rows it found, in either mode', () => {
  load();
  for (const on of [true, false]) {
    setPrivacyMode(on);
    const result = filterRowsTool({ category: 'Transport' }) as Record<string, unknown>;
    assert.match(String(result.effect), /4 matching rows are now highlighted/);
  }
});

test('an unknown category is still reported with its recovery hint', () => {
  load();
  setPrivacyMode(true);
  const result = filterRowsTool({ category: 'Bananas' }) as Record<string, unknown>;
  assert.equal(result.error, 'unknown_category');
  assert.deepEqual(result.validCategories, ['Dining', 'Groceries', 'Housing', 'Transport']);
});

test('tools report no-data rather than throwing when nothing is loaded', () => {
  loadCsv('', 'empty.csv');
  setPrivacyMode(true);
  for (const call of [filterRowsTool, findAnomaliesTool, topExpensesTool]) {
    assert.equal((call({}) as Record<string, unknown>).error, 'no_data_loaded');
  }
});

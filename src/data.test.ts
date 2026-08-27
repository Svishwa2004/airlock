import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  loadCsv,
  describeDataset,
  sumByCategory,
  categories,
  filterRows,
  monthlyTrend,
  findAnomalies,
  topExpenses,
  setHighlight,
  getHighlight,
  clearHighlight,
  getPrivacyMode,
  setPrivacyMode,
} from './data.ts';

const SAMPLE = `date,description,category,amount
2026-07-02,Hostel rent,Housing,28000
2026-07-05,Supermarket run,Groceries,8450
2026-07-05,Bus top-up,Transport,1200
2026-07-10,Hostel rent,Housing,28000
2026-07-12,Restaurant dinner,Dining,2300
2026-07-15,Supermarket run,Groceries,8100
2026-07-20,Pharmacy,Health,2450
2026-08-01,Airport transfer,Transport,4600
2026-08-03,Supermarket run,Groceries,7500
2026-08-05,Hostel rent,Housing,28000
2026-08-07,Coffee shop,Dining,850
2026-08-10,Movie night,Entertainment,3500
`;

test('loadCsv parses valid rows, skips incomplete ones, assigns ids', () => {
  const text = SAMPLE + `2026-08-12,No category,,500
2026-08-13,Short row,Health
`;
  const result = loadCsv(text, 'test.csv');
  assert.equal(result.rows, 12);
  assert.equal(result.skipped, 2);
  const rows = describeDataset();
  assert.equal(rows.rowCount, 12);
  assert.ok(rows.loaded);
  assert.equal(rows.fileName, 'test.csv');
});

test('loadCsv coerces messy amount strings to numbers', () => {
  loadCsv(`date,description,category,amount
2026-07-01,x,Food,"Rs. 1,200.50"
2026-07-02,y,Food,abc
`, 'messy.csv');
  assert.deepEqual(filterRows({}), [
    { id: 0, date: '2026-07-01', description: 'x', category: 'Food', amount: 1200.5 },
    { id: 1, date: '2026-07-02', description: 'y', category: 'Food', amount: 0 },
  ]);
});

test('loadCsv skips rows with a missing amount', () => {
  loadCsv(`date,description,category,amount
2026-07-01,x,Food,100
2026-07-02,y,Food,
`, 'blank.csv');
  assert.equal(describeDataset().rowCount, 1);
});

test('loadCsv resets previous data and highlight on each load', () => {
  loadCsv(SAMPLE, 'a.csv');
  setHighlight([1, 2], 'test');
  loadCsv(SAMPLE, 'b.csv');
  assert.equal(getHighlight(), null);
  assert.equal(describeDataset().rowCount, 12);
});

test('loadCsv re-arms privacy mode on each load', () => {
  loadCsv(SAMPLE, 'a.csv');
  setPrivacyMode(false);
  assert.equal(getPrivacyMode(), false);
  loadCsv(SAMPLE, 'b.csv');
  assert.equal(getPrivacyMode(), true, 'a freshly loaded dataset must never inherit privacy off');
});

test('describeDataset reports shape without rows', () => {
  loadCsv(SAMPLE, 'sample.csv');
  const d = describeDataset();
  assert.equal(d.rowCount, 12);
  assert.deepEqual(d.columns, ['date', 'description', 'category', 'amount']);
  assert.equal(d.dateRange?.earliest, '2026-07-02');
  assert.equal(d.dateRange?.latest, '2026-08-10');
  assert.equal(d.totalAmount, 122950);
});

test('describeDataset with empty store returns not-loaded shape', () => {
  loadCsv('', 'empty.csv');
  const d = describeDataset();
  assert.equal(d.loaded, false);
  assert.equal(d.rowCount, 0);
  assert.equal(d.dateRange, null);
  assert.deepEqual(d.categories, []);
});

test('sumByCategory sorts by total descending and rounds', () => {
  loadCsv(SAMPLE, 'sample.csv');
  const totals = sumByCategory();
  assert.equal(totals.length, 6);
  assert.deepEqual(totals[0], { category: 'Housing', total: 84000, count: 3 });
  const groceries = totals.find((t) => t.category === 'Groceries');
  assert.equal(groceries?.total, 24050);
  assert.equal(groceries?.count, 3);
});

test('categories returns sorted unique list', () => {
  loadCsv(SAMPLE, 'sample.csv');
  assert.deepEqual(categories(), [
    'Dining',
    'Entertainment',
    'Groceries',
    'Health',
    'Housing',
    'Transport',
  ]);
});

test('filterRows applies date, category, and amount criteria', () => {
  loadCsv(SAMPLE, 'sample.csv');
  const aug = filterRows({ from: '2026-08-01' });
  assert.equal(aug.length, 5);
  assert.ok(aug.every((r) => r.date >= '2026-08-01'));

  const dining = filterRows({ category: 'dining' });
  assert.equal(dining.length, 2);
  assert.ok(dining.every((r) => r.category === 'Dining'));

  const pricey = filterRows({ minAmount: 8000 });
  assert.deepEqual(pricey.map((r) => r.description), [
    'Hostel rent',
    'Supermarket run',
    'Hostel rent',
    'Supermarket run',
    'Hostel rent',
  ]);

  const window = filterRows({ from: '2026-07-05', to: '2026-07-10', maxAmount: 2500 });
  assert.deepEqual(window.map((r) => r.description), ['Bus top-up']);
});

test('monthlyTrend groups by calendar month and sorts ascending', () => {
  loadCsv(SAMPLE, 'sample.csv');
  const trend = monthlyTrend();
  assert.deepEqual(trend.map((m) => m.month), ['2026-07', '2026-08']);
  const jul = trend[0];
  assert.equal(jul.total, 78500);
  assert.equal(jul.count, 7);
  const aug = trend[1];
  assert.equal(aug.total, 44450);
  assert.equal(aug.count, 5);
});

test('findAnomalies flags the outlier within a category', () => {
  loadCsv(`date,description,category,amount
2026-07-02,Bus fare,Transport,700
2026-07-04,Train ticket,Transport,650
2026-07-06,Bus fare,Transport,750
2026-07-08,Taxi ride,Transport,500
2026-07-30,Airport transfer,Transport,4600
`, 'transport.csv');
  const anomalies = findAnomalies(1.5);
  const top = anomalies[0];
  assert.equal(top.row.category, 'Transport');
  assert.equal(top.row.description, 'Airport transfer');
  assert.equal(top.row.amount, 4600);
  assert.equal(top.categoryMean, 1440);
  assert.equal(top.zScore, 2);

  assert.deepEqual(findAnomalies(), [], 'the 2.5 default is stricter than this fixture');
});

test('findAnomalies skips categories with fewer than three rows', () => {
  loadCsv(`date,description,category,amount
2026-07-01,a,Small,100
2026-07-02,b,Small,100000
`, 'small.csv');
  assert.deepEqual(findAnomalies(0.5), []);
});

test('findAnomalies respects a custom threshold', () => {
  loadCsv(SAMPLE, 'sample.csv');
  assert.ok(findAnomalies(2).length < findAnomalies(1).length);
  assert.deepEqual(findAnomalies(100), []);
});

test('topExpenses returns largest rows in order, bounded by limit', () => {
  loadCsv(SAMPLE, 'sample.csv');
  const top3 = topExpenses(3);
  assert.deepEqual(top3.map((r) => r.amount), [28000, 28000, 28000]);
  assert.deepEqual(topExpenses(0), []);
  assert.deepEqual(topExpenses(100).map((r) => r.amount).slice(0, 4), [28000, 28000, 28000, 8450]);
});

test('highlight lifecycle: set, read, clear', () => {
  loadCsv(SAMPLE, 'sample.csv');
  setHighlight([1, 2, 3], 'Agent highlighted: test');
  const h = getHighlight();
  assert.deepEqual(h?.ids, [1, 2, 3]);
  assert.equal(h?.note, 'Agent highlighted: test');
  clearHighlight();
  assert.equal(getHighlight(), null);
  setHighlight([], 'ignored');
  assert.equal(getHighlight(), null);
});

test('loadCsv handles CRLF line endings and trimmed headers', () => {
  loadCsv('date,description,category,amount\r\n2026-07-01,x,Food,100\r\n\r\n2026-07-02,y,Food,200\r\n', 'crlf.csv');
  assert.equal(describeDataset().rowCount, 2);
});

/**
 * The bundled sample is what the demo narrates and what a judge sees on first
 * paint, so its headline figures are pinned here. Regenerating it with
 * `node scripts/generate-sample.mjs` must not move them; if it does, the
 * narration and the Devpost description are out of date too.
 */
test('the bundled sample dataset yields the figures the demo relies on', () => {
  const csv = readFileSync(new URL('../public/sample-expenses.csv', import.meta.url), 'utf8');
  const load = loadCsv(csv, 'sample-expenses.csv');
  assert.deepEqual(load, { rows: 965, skipped: 0 });

  const d = describeDataset();
  assert.equal(d.totalAmount, 2509504.48);
  assert.equal(d.categories.length, 12);
  assert.deepEqual(d.dateRange, { earliest: '2025-09-01', latest: '2026-08-31' });

  assert.equal(monthlyTrend().length, 12);
  assert.deepEqual(sumByCategory()[0], { category: 'Groceries', total: 576485.41, count: 95 });

  const anomalies = findAnomalies();
  assert.equal(anomalies.length, 4, 'exactly the four planted outliers, at the default threshold');
  assert.equal(anomalies[0].row.description, 'Airport transfer');
  assert.equal(anomalies[0].zScore, 16.84);
  assert.deepEqual(
    anomalies.map((a) => a.row.category),
    ['Transport', 'Dining', 'Household', 'Healthcare'],
  );
});

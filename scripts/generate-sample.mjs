/**
 * Regenerates public/sample-expenses.csv.
 *
 * The sample data is entirely synthetic. It is generated from a fixed seed so
 * the committed CSV is reproducible from this script, and so nobody has to
 * wonder whether a privacy-themed demo shipped somebody's real bank export.
 *
 * Run: node scripts/generate-sample.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/sample-expenses.csv', import.meta.url));

const START = { year: 2025, month: 9 };
const MONTHS = 12;

/** mulberry32 — small, seeded, and good enough for sample data. */
const makeRandom = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const rand = makeRandom(20260827);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + rand() * (max - min);
const intBetween = (min, max) => Math.floor(between(min, max + 1));
const money = (min, max) => Math.round(between(min, max) * 100) / 100;

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const iso = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * Recurring commitments land on a stable day each month; discretionary
 * spending is scattered. Both matter: the recurring rows give the anomaly
 * detector a tight per-category baseline to measure against.
 */
const RECURRING = [
  { category: 'Housing', description: 'Monthly rent', day: 1, amount: () => 28000 },
  { category: 'Utilities', description: 'Electricity bill', day: 8, amount: () => money(5200, 8400) },
  { category: 'Utilities', description: 'Water bill', day: 21, amount: () => money(1750, 2450) },
  { category: 'Utilities', description: 'Home internet', day: 4, amount: () => 4500 },
  { category: 'Subscriptions', description: 'Video streaming service', day: 14, amount: () => 1590 },
  { category: 'Subscriptions', description: 'Music streaming service', day: 17, amount: () => 790 },
  { category: 'Subscriptions', description: 'Cloud file storage', day: 6, amount: () => 450 },
  { category: 'Subscriptions', description: 'Code assistant subscription', day: 29, amount: () => 3100 },
];

const SCATTERED = [
  {
    category: 'Transport',
    perMonth: [26, 34],
    descriptions: ['Ride to campus', 'Ride home', 'Bus pass top-up', 'Three-wheeler fare', 'Train ticket', 'Fuel top-up'],
    amount: () => money(320, 1450),
  },
  {
    category: 'Dining',
    perMonth: [14, 22],
    descriptions: ['Corner cafe', 'Lunch with classmates', 'Takeaway dinner', 'Fast food dinner', 'Bakery run', 'Tea and short eats'],
    amount: () => money(580, 3200),
  },
  {
    category: 'Groceries',
    perMonth: [6, 9],
    descriptions: ['Neighbourhood supermarket', 'Weekly market run', 'Vegetable stall', 'Bulk dry goods'],
    amount: () => money(3400, 9600),
  },
  {
    category: 'Household',
    perMonth: [2, 5],
    descriptions: ['Cleaning supplies', 'Kitchen refill', 'Light bulbs and batteries', 'Laundry service'],
    amount: () => money(680, 4600),
  },
  {
    category: 'Entertainment',
    perMonth: [2, 6],
    descriptions: ['Cinema ticket', 'Board game night', 'Concert ticket', 'Museum entry'],
    amount: () => money(480, 3600),
  },
  {
    category: 'Education',
    perMonth: [2, 5],
    descriptions: ['Textbook purchase', 'Stationery haul', 'Lab consumables', 'Online course fee', 'Printing and binding'],
    amount: () => money(880, 5600),
  },
  {
    category: 'Mobile',
    perMonth: [2, 3],
    descriptions: ['Mobile prepaid top-up', 'Data add-on'],
    amount: () => money(1000, 2000),
  },
  {
    category: 'Healthcare',
    perMonth: [0, 3],
    descriptions: ['Pharmacy visit', 'Clinic consultation', 'Routine blood test'],
    amount: () => money(760, 4600),
  },
  {
    category: 'Clothing',
    perMonth: [0, 3],
    descriptions: ['Everyday shirt', 'Running shoes', 'Rain jacket', 'Tailoring alteration'],
    amount: () => money(1400, 9200),
  },
];

/**
 * Planted outliers. Each sits far above the rest of its own category so the
 * demo has a deterministic, explainable anomaly beat rather than whatever the
 * random draw happened to produce. Measured against the generated data, all
 * four clear a z-score of 2.5 within their own category (the lowest is 4.44)
 * while the largest unplanted row reaches only 1.97 — so the default
 * threshold separates them cleanly from ordinary variation.
 */
const PLANTED = [
  { date: '2026-07-30', description: 'Airport transfer', category: 'Transport', amount: 12400.0 },
  { date: '2026-05-18', description: 'Emergency dental treatment', category: 'Healthcare', amount: 42000.0 },
  { date: '2026-02-09', description: 'Refrigerator replacement', category: 'Household', amount: 68000.0 },
  { date: '2026-06-12', description: 'Graduation dinner for family', category: 'Dining', amount: 24500.0 },
];

const rows = [];

for (let i = 0; i < MONTHS; i += 1) {
  const month0 = START.month - 1 + i;
  const year = START.year + Math.floor(month0 / 12);
  const month = (month0 % 12) + 1;
  const lastDay = daysInMonth(year, month);

  for (const item of RECURRING) {
    rows.push({
      date: iso(year, month, Math.min(item.day, lastDay)),
      description: item.description,
      category: item.category,
      amount: item.amount(),
    });
  }

  for (const group of SCATTERED) {
    const count = intBetween(group.perMonth[0], group.perMonth[1]);
    for (let n = 0; n < count; n += 1) {
      rows.push({
        date: iso(year, month, intBetween(1, lastDay)),
        description: pick(group.descriptions),
        category: group.category,
        amount: group.amount(),
      });
    }
  }
}

rows.push(...PLANTED);
rows.sort((a, b) => a.date.localeCompare(b.date));

const csv = [
  'date,description,category,amount',
  ...rows.map((r) => `${r.date},${r.description},${r.category},${r.amount.toFixed(2)}`),
].join('\n');

writeFileSync(OUT, `${csv}\n`, 'utf8');
console.log(`wrote ${rows.length} rows to ${OUT}`);
console.log(`range ${rows[0].date} .. ${rows[rows.length - 1].date}`);

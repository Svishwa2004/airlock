import {
  getHighlightCategory,
  getRows,
  loadCsv,
  subscribe,
  type Row,
} from './data';
import { registerTools } from './tools';
import { isSupported, registeredNames } from './webmcp';

const rowsBody = document.querySelector<HTMLTableSectionElement>('#rows')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const badgeEl = document.querySelector<HTMLElement>('#tool-badge')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const sampleButton = document.querySelector<HTMLButtonElement>('#load-sample')!;

const money = new Intl.NumberFormat('en-LK', {
  style: 'currency',
  currency: 'LKR',
  maximumFractionDigits: 2,
});

function renderRows(): void {
  const rows = getRows();
  const highlight = getHighlightCategory();

  if (rows.length === 0) {
    rowsBody.className = '';
    rowsBody.innerHTML = '<tr class="empty"><td colspan="4">No data loaded yet.</td></tr>';
    return;
  }

  rowsBody.className = highlight ? 'has-highlight' : '';
  rowsBody.replaceChildren(...rows.map((row) => renderRow(row, highlight)));
}

function renderRow(row: Row, highlight: string | null): HTMLTableRowElement {
  const tr = document.createElement('tr');
  if (highlight && row.category === highlight) tr.className = 'hit';

  for (const value of [row.date, row.description, row.category]) {
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(td);
  }

  const amount = document.createElement('td');
  amount.className = 'num';
  amount.textContent = money.format(row.amount);
  tr.append(amount);

  return tr;
}

type BadgePhase = 'registering' | 'settled' | 'failed';

/** Never reports a count before registration settles — a transient "0 tools" reads as broken. */
function renderBadge(phase: BadgePhase): void {
  if (!isSupported()) {
    badgeEl.dataset.state = 'unsupported';
    badgeEl.textContent = 'WebMCP unavailable — enable chrome://flags/#enable-webmcp-testing';
    return;
  }

  if (phase === 'failed') {
    badgeEl.dataset.state = 'unsupported';
    badgeEl.textContent = 'Tool registration failed';
    return;
  }

  if (phase === 'registering') {
    badgeEl.dataset.state = '';
    badgeEl.textContent = 'registering WebMCP tools…';
    return;
  }

  const names = registeredNames();
  badgeEl.dataset.state = names.length > 0 ? 'ready' : '';
  badgeEl.textContent = `${names.length} WebMCP tools registered`;
  badgeEl.title = names.join('\n');
}

function report(result: { rows: number; skipped: number }, name: string): void {
  const skipped = result.skipped > 0 ? `, ${result.skipped} skipped` : '';
  statusEl.textContent = `${name} — ${result.rows} rows parsed in-browser${skipped}. Nothing was uploaded.`;
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  report(loadCsv(await file.text(), file.name), file.name);
});

sampleButton.addEventListener('click', async () => {
  const response = await fetch('/sample-expenses.csv');
  report(loadCsv(await response.text(), 'sample-expenses.csv'), 'sample-expenses.csv');
});

subscribe(renderRows);
renderRows();
renderBadge('registering');

registerTools()
  .then(() => renderBadge('settled'))
  .catch((error: unknown) => {
    renderBadge('failed');
    console.error('WebMCP registration failed', error);
  });

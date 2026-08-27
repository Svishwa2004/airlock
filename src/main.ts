import { getHighlight, getRows, loadCsv, setPrivacyMode, subscribe, type Row } from './data.ts';
import { registerTools } from './tools.ts';
import { isSupported, registeredNames } from './webmcp.ts';

const rowsBody = document.querySelector<HTMLTableSectionElement>('#rows')!;
const tableWrap = document.querySelector<HTMLElement>('.table-wrap')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const badgeEl = document.querySelector<HTMLElement>('#tool-badge')!;
const noteEl = document.querySelector<HTMLElement>('#highlight-note')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const sampleButton = document.querySelector<HTMLButtonElement>('#load-sample')!;
const currencySelect = document.querySelector<HTMLSelectElement>('#currency')!;
const privacyInput = document.querySelector<HTMLInputElement>('#privacy')!;
const privacyStateEl = document.querySelector<HTMLElement>('#privacy-state')!;

const plainMoney = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const makeMoney = (code: string): Intl.NumberFormat => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 });
  } catch {
    return plainMoney;
  }
};

let money = makeMoney('LKR');

/**
 * Highlighting a handful of rows out of a thousand is invisible unless the
 * table moves, so the first hit is scrolled into the frame — but only when the
 * selection actually changes, otherwise a currency change would yank the view.
 */
let shownHighlight = '';

function revealFirstHit(): void {
  const hit = rowsBody.querySelector<HTMLTableRowElement>('tr.hit');
  if (!hit) return;
  tableWrap.scrollTop = Math.max(0, hit.offsetTop - tableWrap.clientHeight / 2);
}

function renderRows(): void {
  const rows = getRows();
  const highlight = getHighlight();

  if (rows.length === 0) {
    rowsBody.className = '';
    rowsBody.innerHTML = '<tr class="empty"><td colspan="4">No data loaded yet.</td></tr>';
    noteEl.textContent = '';
    return;
  }

  const hits = new Set(highlight?.ids ?? []);
  rowsBody.className = hits.size > 0 ? 'has-highlight' : '';
  rowsBody.replaceChildren(...rows.map((row) => renderRow(row, hits)));

  noteEl.textContent = highlight?.note ? `Agent highlighted: ${highlight.note}` : '';

  const selection = highlight?.ids.join(',') ?? '';
  if (selection !== shownHighlight) {
    shownHighlight = selection;
    if (selection) revealFirstHit();
    else tableWrap.scrollTop = 0;
  }
}

function renderRow(row: Row, hits: Set<number>): HTMLTableRowElement {
  const tr = document.createElement('tr');
  if (hits.has(row.id)) tr.className = 'hit';

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

async function loadSample(): Promise<void> {
  const response = await fetch('sample-expenses.csv');
  report(loadCsv(await response.text(), 'sample-expenses.csv'), 'sample-expenses.csv');
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  report(loadCsv(await file.text(), file.name), file.name);
});

sampleButton.addEventListener('click', () => {
  void loadSample();
});

currencySelect.addEventListener('change', () => {
  const code = currencySelect.value;
  money = code === 'plain' ? plainMoney : makeMoney(code);
  renderRows();
});

/**
 * Only this control can change privacy mode — no WebMCP tool is registered for
 * it, so the agent cannot widen its own access.
 */
function renderPrivacyState(): void {
  const on = privacyInput.checked;
  privacyStateEl.dataset.state = on ? 'on' : 'off';
  privacyStateEl.textContent = on
    ? 'On — the agent receives counts, totals and category names. Rows it finds are highlighted here for you to read, not sent to the model.'
    : 'Off — the agent can now receive the contents of rows it looks at, including dates, descriptions and amounts.';
}

privacyInput.addEventListener('change', () => {
  setPrivacyMode(privacyInput.checked);
  renderPrivacyState();
});

setPrivacyMode(privacyInput.checked);
renderPrivacyState();

subscribe(renderRows);
renderRows();
renderBadge('registering');

registerTools()
  .then(() => renderBadge('settled'))
  .catch((error: unknown) => {
    renderBadge('failed');
    console.error('WebMCP registration failed', error);
  });

/**
 * Seeded on load so an agent (or a judge) arriving cold finds a populated
 * table rather than an empty one. Any CSV the user chooses replaces it.
 */
void loadSample();

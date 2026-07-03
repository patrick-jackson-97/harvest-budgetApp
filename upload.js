/* ============================================================
   HARVEST — upload.js
   CSV parsing, institution detection, preview, Supabase import
   ============================================================ */

'use strict';

/* ── HEADER NORMALIZATION ──
   All detection uses normalized headers: trimmed + lowercased.
   Normalizers still look up by original header name via a lookup map.
   ============================================================ */
function normHeader(h) { return String(h).trim().toLowerCase(); }

// Build a lookup: normalized → original, so normalizers can still access by original key
function buildLookup(headers) {
  const map = {};
  headers.forEach(h => { map[normHeader(h)] = h; });
  return map;
}

// Get a value from a row by normalized header name
function rowGet(row, lookup, ...keys) {
  for (const k of keys) {
    const orig = lookup[normHeader(k)];
    if (orig !== undefined && row[orig] !== undefined) return row[orig];
    // Also try the normalized key directly
    if (row[k] !== undefined) return row[k];
  }
  return '';
}

// Check if normalized headers contain all of these strings
function hasAll(normHeaders, ...keys) {
  return keys.every(k => normHeaders.some(h => h === normHeader(k)));
}

function hasAny(normHeaders, ...keys) {
  return keys.some(k => normHeaders.some(h => h === normHeader(k)));
}

function hasContaining(normHeaders, substr) {
  return normHeaders.some(h => h.includes(substr));
}

/* ── KNOWN INSTITUTION FORMATS ── */
const INSTITUTIONS = [

  {
    name: 'Capital One',
    // Must check before Chase — also has "Transaction Date" + "Debit"/"Credit"
    detect: nh => hasAll(nh, 'Transaction Date', 'Debit', 'Credit') && hasContaining(nh, 'transaction'),
    normalize: (row, lk) => {
      const debit  = Math.abs(parseAmount(rowGet(row, lk, 'Debit')));
      const credit = Math.abs(parseAmount(rowGet(row, lk, 'Credit')));
      const amount = credit > 0 ? credit : -debit;
      return {
        date:         parseDate(rowGet(row, lk, 'Transaction Date', 'Post Date')),
        merchant:     clean(rowGet(row, lk, 'Transaction Description', 'Description')),
        amount,
        type:         debit > 0 ? 'debit' : 'credit',
        raw_category: clean(rowGet(row, lk, 'Category')),
      };
    }
  },

  {
    name: 'Chase',
    detect: nh => hasAll(nh, 'Transaction Date', 'Description', 'Amount') && !hasAll(nh, 'Debit', 'Credit'),
    normalize: (row, lk) => {
      const amount = parseAmount(rowGet(row, lk, 'Amount'));
      return {
        date:         parseDate(rowGet(row, lk, 'Transaction Date', 'Post Date')),
        merchant:     clean(rowGet(row, lk, 'Description')),
        amount,
        type:         amount < 0 ? 'debit' : 'credit',
        raw_category: clean(rowGet(row, lk, 'Category')),
      };
    }
  },

  {
    name: 'Citi',
    // Citi: Date + Description + Debit + Credit (no "Transaction" prefix)
    detect: nh => hasAll(nh, 'Date', 'Description', 'Debit', 'Credit') && !hasContaining(nh, 'transaction'),
    normalize: (row, lk) => {
      const debit  = parseFloat((rowGet(row, lk, 'Debit')  || '').replace(/[^0-9.-]/g,'')) || 0;
      const credit = parseFloat((rowGet(row, lk, 'Credit') || '').replace(/[^0-9.-]/g,'')) || 0;
      const amount = credit > 0 ? credit : -debit;
      return {
        date:         parseDate(rowGet(row, lk, 'Date')),
        merchant:     clean(rowGet(row, lk, 'Description')),
        amount,
        type:         debit > 0 ? 'debit' : 'credit',
        raw_category: clean(rowGet(row, lk, 'Member Name')),
      };
    }
  },

  {
    name: 'American Express',
    detect: nh => hasAll(nh, 'Date', 'Description', 'Amount') && hasContaining(nh, 'card member'),
    normalize: (row, lk) => {
      const raw = parseAmount(rowGet(row, lk, 'Amount'));
      return {
        date:         parseDate(rowGet(row, lk, 'Date')),
        merchant:     clean(rowGet(row, lk, 'Description')),
        amount:       -raw,   // Amex: positive = charge, negative = credit
        type:         raw > 0 ? 'debit' : 'credit',
        raw_category: clean(rowGet(row, lk, 'Category')),
      };
    }
  },

  {
    name: 'Discover',
    detect: nh => hasAny(nh, 'Trans. Date', 'Trans Date') && hasAll(nh, 'Description', 'Amount'),
    normalize: (row, lk) => {
      const raw = parseAmount(rowGet(row, lk, 'Amount'));
      return {
        date:         parseDate(rowGet(row, lk, 'Trans. Date', 'Trans Date', 'Post Date')),
        merchant:     clean(rowGet(row, lk, 'Description')),
        amount:       -raw,   // Discover: positive = charge
        type:         raw > 0 ? 'debit' : 'credit',
        raw_category: clean(rowGet(row, lk, 'Category')),
      };
    }
  },

  {
    name: 'Ally Bank',
    // Ally has a "Type" column (Debit/Credit) alongside Amount
    detect: nh => hasAll(nh, 'Date', 'Description', 'Amount', 'Type') && !hasContaining(nh, 'transaction'),
    normalize: (row, lk) => {
      const type   = rowGet(row, lk, 'Type');
      const amount = Math.abs(parseAmount(rowGet(row, lk, 'Amount')));
      return {
        date:         parseDate(rowGet(row, lk, 'Date')),
        merchant:     clean(rowGet(row, lk, 'Description')),
        amount:       /debit/i.test(type) ? -amount : amount,
        type:         /debit/i.test(type) ? 'debit' : 'credit',
        raw_category: clean(rowGet(row, lk, 'Category')),
      };
    }
  },

  {
    name: 'Bank of America',
    detect: nh => hasAll(nh, 'Date', 'Payee', 'Amount'),
    normalize: (row, lk) => {
      const amount = parseAmount(rowGet(row, lk, 'Amount'));
      return {
        date:         parseDate(rowGet(row, lk, 'Date')),
        merchant:     clean(rowGet(row, lk, 'Payee')),
        amount,
        type:         amount < 0 ? 'debit' : 'credit',
        raw_category: clean(rowGet(row, lk, 'Memo')),
      };
    }
  },

  {
    name: 'Fidelity',
    detect: nh => hasAny(nh, 'Settlement Date', 'Run Date') && hasContaining(nh, 'amount'),
    normalize: (row, lk) => {
      const amount = parseAmount(rowGet(row, lk, 'Amount ($)', 'Amount'));
      return {
        date:         parseDate(rowGet(row, lk, 'Settlement Date', 'Run Date', 'Date')),
        merchant:     clean(rowGet(row, lk, 'Description')),
        amount,
        type:         amount < 0 ? 'debit' : 'credit',
        raw_category: clean(rowGet(row, lk, 'Type', 'Action')),
      };
    }
  },

  {
    name: 'Wells Fargo',
    // Wells Fargo exports no column headers — all blank or generic
    detect: nh => nh.length >= 4 && nh.every(h => h === '' || /^column/i.test(h) || /^\d+$/.test(h)),
    normalize: (row, lk) => {
      const vals = Object.values(row);
      const amount = parseAmount(vals[1]);
      return {
        date:         parseDate(vals[0]),
        merchant:     clean(vals[4] || vals[2]),
        amount,
        type:         amount < 0 ? 'debit' : 'credit',
        raw_category: null,
      };
    }
  },

];

/* ── PARSE HELPERS ── */
function clean(val) {
  if (!val) return '';
  return String(val).trim().replace(/\s+/g, ' ');
}

function parseAmount(val) {
  if (!val && val !== 0) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdy) {
    const y = mdy[3].length === 2 ? '20' + mdy[3] : mdy[3];
    return `${y}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  }
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`;
  return s;
}

/* ── CSV PARSER ── */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  // Skip leading metadata lines (account info, blank lines, etc.)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const l = lines[i].trim();
    if (!l) continue;
    // A header row usually has multiple comma-separated values and no large numbers
    const cols = splitCSVLine(l);
    if (cols.length >= 3 && !cols.every(c => /^[\d\.\$\-\s]*$/.test(c))) {
      headerIdx = i; break;
    }
  }

  const headers = splitCSVLine(lines[headerIdx]);
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitCSVLine(line);
    const row  = {};
    headers.forEach((h, j) => { row[h] = vals[j] !== undefined ? vals[j] : ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function splitCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

/* ── DETECT INSTITUTION ── */
function detectInstitution(headers) {
  const nh = headers.map(normHeader);
  return INSTITUTIONS.find(inst => inst.detect(nh)) || null;
}

/* ── UPLOAD STATE ── */
let uploadParsed      = [];
let uploadAccountId   = null;
let uploadInstitution = null;
let _rawHeaders       = [];
let _rawRows          = [];

/* ── RENDER UPLOAD PAGE ── */
function renderUploadPage() {
  const content = document.getElementById('upload-content');
  if (!content) return;
  content.innerHTML = `
    <div class="section">
      <div class="section-title-row">
        <div class="section-title"><i class="fa-solid fa-wallet"></i> Account Data Status</div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn-ghost btn-sm" id="plaid-sync-btn" onclick="syncPlaidNow()" style="display:none">
            <i class="fa-solid fa-rotate"></i> Sync all
          </button>
          <button class="btn-primary btn-sm" id="plaid-connect-btn" onclick="initPlaidLink()">
            <i class="fa-solid fa-link"></i> Connect bank
          </button>
        </div>
      </div>
      <div id="plaid-status"></div>
      <div id="account-data-grid" class="acct-data-grid">
        <div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading…</p></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><i class="fa-solid fa-file-csv"></i> Upload a CSV export</div>
      <div style="margin-bottom:12px">
        <label class="form-label">Which account is this for?</label>
        <select class="form-select" id="upload-account-select" style="max-width:360px" onchange="uploadAccountId=this.value">
          <option value="">— Select an account —</option>
        </select>
      </div>
      <div class="upload-dropzone" id="upload-dropzone"
           ondragover="uploadDragOver(event)"
           ondragleave="uploadDragLeave(event)"
           ondrop="uploadDrop(event)"
           onclick="document.getElementById('upload-file-input').click()">
        <i class="fa-solid fa-cloud-arrow-up"></i>
        <p class="upload-dropzone-title">Drop your CSV here</p>
        <p class="upload-dropzone-sub">or click to browse — Chase, Ally, Capital One, Amex, Discover, Citi, BofA, Fidelity and more</p>
        <input type="file" id="upload-file-input" accept=".csv" style="display:none" onchange="uploadFileSelected(this)">
      </div>
    </div>
    <div id="upload-result"></div>

    <div style="text-align:center;margin-top:8px;margin-bottom:24px;font-size:12px;color:var(--text-tertiary)">
      Bank connections secured by <a href="https://plaid.com" target="_blank" rel="noopener">Plaid</a>
    </div>`;

  // Hidden element plaid.js still looks for
  const hidden = document.createElement('div');
  hidden.id = 'plaid-connections';
  hidden.style.display = 'none';
  content.appendChild(hidden);

  renderAccountDataGrid();
  populateAccountSelect();
}

/* ── ACCOUNT DATA GRID ── */
async function renderAccountDataGrid() {
  const grid = document.getElementById('account-data-grid');
  if (!grid || !currentUser) return;

  // Fetch accounts, transactions summary, and plaid items in parallel
  const [acctRes, txnRes, itemsRes] = await Promise.all([
    sb.from('accounts').select('id,name,type,institution,balance,plaid_account_id').eq('user_id', currentUser.id).order('institution').order('name'),
    sb.from('transactions').select('account_id,date,plaid_transaction_id').eq('user_id', currentUser.id),
    edgeFetch('plaid-list-items', {}).then(r => r.json()).catch(() => ({ items: [] })),
  ]);

  const accounts = acctRes.data || [];
  const txns     = txnRes.data || [];
  const items    = itemsRes.items || [];

  if (!accounts.length) {
    grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-plus-circle"></i><p>No accounts yet — <button class="btn-link" onclick="showIntake()">add one</button></p></div>`;
    return;
  }

  // Build per-account transaction stats
  const stats = {};
  txns.forEach(t => {
    if (!t.account_id) return;
    if (!stats[t.account_id]) stats[t.account_id] = { total: 0, lastDate: null, hasPlaid: false, hasCsv: false };
    stats[t.account_id].total++;
    if (!stats[t.account_id].lastDate || t.date > stats[t.account_id].lastDate) stats[t.account_id].lastDate = t.date;
    if (t.plaid_transaction_id) stats[t.account_id].hasPlaid = true;
    else stats[t.account_id].hasCsv = true;
  });

  // Build item map by institution name
  const itemByInst = {};
  items.forEach(item => { itemByInst[item.institution_name] = item; });

  const TYPE_ICON = { checking: 'fa-building-columns', savings: 'fa-piggy-bank', credit: 'fa-credit-card', investment: 'fa-chart-line', loan: 'fa-house', other: 'fa-wallet' };

  grid.innerHTML = accounts.map(a => {
    const s    = stats[a.id] || { total: 0, lastDate: null, hasPlaid: false, hasCsv: false };
    const item = a.plaid_account_id ? itemByInst[a.institution] : null;
    const icon = TYPE_ICON[a.type] || 'fa-wallet';

    let statusBadge, statusDetail, actions;

    if (a.plaid_account_id) {
      const lastSync = item?.last_synced_at ? new Date(item.last_synced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';
      statusBadge  = `<span class="acct-badge acct-badge-plaid"><i class="fa-solid fa-link"></i> Plaid Connected</span>`;
      statusDetail = `${s.total} transactions · Last sync: ${lastSync}`;
      actions      = `<button class="btn-ghost btn-xs" onclick="syncPlaidNow()"><i class="fa-solid fa-rotate"></i> Sync</button>
                      <button class="btn-ghost btn-xs acct-danger-btn" onclick="unlinkPlaidAccount('${a.id}','${a.name.replace(/'/g,"\\'")}')"><i class="fa-solid fa-unlink"></i> Unlink</button>`;
    } else if (s.hasCsv || s.hasPlaid) {
      const lastDate = s.lastDate ? new Date(s.lastDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
      statusBadge  = `<span class="acct-badge acct-badge-csv"><i class="fa-solid fa-file-csv"></i> CSV Data</span>`;
      statusDetail = `${s.total} transactions · Latest: ${lastDate}`;
      actions      = `<button class="btn-ghost btn-xs" onclick="uploadForAccount('${a.id}')"><i class="fa-solid fa-arrow-up-from-bracket"></i> Upload more</button>
                      <button class="btn-ghost btn-xs" onclick="connectPlaidForAccount('${a.id}')"><i class="fa-solid fa-link"></i> Connect Plaid</button>`;
    } else {
      statusBadge  = `<span class="acct-badge acct-badge-empty"><i class="fa-solid fa-circle-xmark"></i> No data</span>`;
      statusDetail = `No transactions yet`;
      actions      = `<button class="btn-ghost btn-xs" onclick="connectPlaidForAccount('${a.id}')"><i class="fa-solid fa-link"></i> Connect Plaid</button>
                      <button class="btn-ghost btn-xs" onclick="uploadForAccount('${a.id}')"><i class="fa-solid fa-file-csv"></i> Upload CSV</button>`;
    }

    return `
      <div class="acct-data-card">
        <div class="acct-data-icon"><i class="fa-solid ${icon}"></i></div>
        <div class="acct-data-body">
          <div class="acct-data-name">${a.name}</div>
          <div class="acct-data-inst">${a.institution || '—'}</div>
          <div class="acct-data-status">${statusBadge} <span class="acct-data-detail">${statusDetail}</span></div>
        </div>
        <div class="acct-data-actions">${actions}</div>
      </div>`;
  }).join('');

  // Show sync button if any Plaid accounts exist
  const hasPaid = accounts.some(a => a.plaid_account_id);
  const syncBtn = document.getElementById('plaid-sync-btn');
  if (syncBtn) syncBtn.style.display = hasPaid ? 'inline-flex' : 'none';
}

function uploadForAccount(accountId) {
  uploadAccountId = accountId;
  document.getElementById('upload-account-select').value = accountId;
  document.getElementById('upload-dropzone')?.scrollIntoView({ behavior: 'smooth' });
}

function connectPlaidForAccount(accountId) {
  // Store intent — after Plaid connects, the mapping modal will appear
  initPlaidLink();
}

async function unlinkPlaidAccount(accountId, accountName) {
  if (!confirm(`Unlink Plaid from "${accountName}"? Existing transactions are kept, but auto-sync will stop for this account.`)) return;
  await sb.from('accounts').update({ plaid_account_id: null }).eq('id', accountId).eq('user_id', currentUser.id);
  showQuickToast(`${accountName} unlinked from Plaid`);
  renderAccountDataGrid();
}

async function populateAccountSelect() {
  if (!currentUser) return;
  const { data: accounts } = await sb.from('accounts').select('id,name,type').eq('user_id', currentUser.id).order('type');
  const sel = document.getElementById('upload-account-select');
  if (!sel || !accounts) return;
  accounts.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name + ' (' + (TYPE_META[a.type]?.label || a.type) + ')';
    sel.appendChild(opt);
  });
}

/* ── DRAG & DROP ── */
function uploadDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-dropzone')?.classList.add('drag-over');
}
function uploadDragLeave() {
  document.getElementById('upload-dropzone')?.classList.remove('drag-over');
}
function uploadDrop(e) {
  e.preventDefault();
  document.getElementById('upload-dropzone')?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}
function uploadFileSelected(input) {
  if (input.files[0]) processFile(input.files[0]);
}

/* ── PROCESS FILE ── */
function processFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showUploadError('Please upload a .csv file.'); return;
  }

  // Show reading indicator immediately
  document.getElementById('upload-result').innerHTML = `
    <div class="upload-loading">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <span>Reading file…</span>
    </div>`;

  const reader = new FileReader();
  reader.onload  = e => handleCSVText(e.target.result, file.name);
  reader.onerror = () => showUploadError('Could not read the file. Please try again.');
  reader.readAsText(file);
}

function handleCSVText(text, filename) {
  document.getElementById('upload-result').innerHTML = `
    <div class="upload-loading">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <span>Parsing transactions…</span>
    </div>`;

  // Yield to browser so the loading indicator renders before heavy parsing
  setTimeout(() => {
    try {
      const { headers, rows } = parseCSV(text);

      if (!headers.length) {
        showUploadError('This file appears to be empty or not a valid CSV.'); return;
      }
      if (!rows.length) {
        showUploadError('No transaction rows found. Make sure you\'re exporting the right file from your bank.'); return;
      }

      _rawHeaders = headers;
      _rawRows    = rows;

      const inst = detectInstitution(headers);
      uploadInstitution = inst;

      if (inst) {
        const lk = buildLookup(headers);
        uploadParsed = rows.map(r => inst.normalize(r, lk)).filter(r => r.date && r.amount !== 0);

        if (!uploadParsed.length) {
          showUploadError(`Detected ${inst.name} format but couldn't parse any valid transactions. The file may be empty or use an unexpected layout.`);
          return;
        }

        showUploadPreview(inst.name, uploadParsed);
      } else {
        // Show detected headers to help debug
        showManualMapping(headers, rows);
      }
    } catch (err) {
      showUploadError('Parsing failed: ' + err.message);
    }
  }, 50);
}

/* ── PREVIEW TABLE ── */
function showUploadPreview(instName, rows, isManual = false) {
  const result   = document.getElementById('upload-result');
  const expenses = rows.filter(r => r.amount < 0).length;
  const income   = rows.filter(r => r.amount > 0).length;
  const total    = rows.reduce((s, r) => s + r.amount, 0);

  // Build columns dynamically — only show fields that have actual data
  const POSSIBLE_COLS = [
    { key: 'date',         label: 'Date' },
    { key: 'merchant',     label: 'Merchant' },
    { key: 'amount',       label: 'Amount',   isAmount: true },
    { key: 'raw_category', label: 'Category' },
    { key: 'type',         label: 'Type' },
  ];
  const cols = POSSIBLE_COLS.filter(col =>
    rows.some(r => r[col.key] !== null && r[col.key] !== undefined && r[col.key] !== '')
  );

  result.innerHTML = `
    <div class="section">
      <div class="upload-detected">
        <i class="fa-solid fa-circle-check"></i>
        ${isManual ? 'Custom mapping' : 'Detected: <strong>' + instName + '</strong>'} — ${rows.length} transactions ready to import
      </div>
      <div class="upload-preview-stats">
        <div class="upload-stat"><span>${expenses}</span> expenses</div>
        <div class="upload-stat"><span>${income}</span> income / credits</div>
        <div class="upload-stat ${total < 0 ? 'neg' : 'pos'}"><span>${fmtFull(total)}</span> net</div>
      </div>
      <div class="upload-table-wrap">
        <table class="upload-table">
          <thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.slice(0, 100).map(r => `
              <tr>${cols.map(c => {
                if (c.isAmount) return `<td class="${r.amount < 0 ? 'amt-neg' : 'amt-pos'}">${fmtFull(r.amount)}</td>`;
                return `<td class="${c.key === 'raw_category' || c.key === 'type' ? 'text-muted' : ''}">${r[c.key] || '—'}</td>`;
              }).join('')}</tr>`).join('')}
            ${rows.length > 100 ? `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--text-tertiary);padding:12px;font-size:13px">… and ${rows.length - 100} more rows</td></tr>` : ''}
          </tbody>
        </table>
      </div>
      <div class="upload-actions">
        <button class="btn-secondary" onclick="${isManual ? 'showManualMapping(_rawHeaders,_rawRows)' : 'resetUpload()'}">
          <i class="fa-solid fa-rotate-left"></i> ${isManual ? 'Adjust mapping' : 'Start over'}
        </button>
        <button class="btn-primary" onclick="confirmImport()">
          <i class="fa-solid fa-database"></i> Import ${rows.length} transactions
        </button>
      </div>
    </div>`;
}

/* ── MANUAL COLUMN MAPPING ── */

// Smart defaults: guess which column maps to which field based on header name
function guessMapping(headers) {
  const guess = {};
  headers.forEach(h => {
    const n = normHeader(h);
    if (!guess.date     && /date|dt$/.test(n))                           guess.date     = h;
    if (!guess.merchant && /desc|merchant|payee|memo|name/.test(n))      guess.merchant = h;
    if (!guess.amount   && /^amount$|^amt$/.test(n))                     guess.amount   = h;
    if (!guess.debit    && /debit|withdrawal|charge/.test(n))             guess.debit    = h;
    if (!guess.credit   && /credit|deposit|payment/.test(n))              guess.credit   = h;
    if (!guess.category && /categ|type|class/.test(n))                   guess.category = h;
  });
  return guess;
}

function showManualMapping(headers, rows) {
  _rawRows = rows;
  const result  = document.getElementById('upload-result');
  const guess   = guessMapping(headers);
  const preview = rows.slice(0, 4);   // Show 4 sample rows below each column

  // Build a mini sample table of raw data
  const sampleTableHTML = `
    <div class="upload-table-wrap" style="margin-bottom:20px">
      <table class="upload-table">
        <thead>
          <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${preview.map(row => `
            <tr>${headers.map(h => `<td>${row[h] || ''}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;

  const FIELDS = [
    { id: 'date',     label: 'Date',                hint: 'When the transaction happened',  required: true  },
    { id: 'merchant', label: 'Merchant / Description', hint: 'Who you paid or what it was', required: true  },
    { id: 'amount',   label: 'Amount (single column)', hint: 'Negative = expense, positive = income', required: false },
    { id: 'debit',    label: 'Debit / Withdrawal',   hint: 'If debits and credits are split', required: false },
    { id: 'credit',   label: 'Credit / Deposit',     hint: 'If debits and credits are split', required: false },
    { id: 'category', label: 'Category',             hint: 'Optional — your bank\'s category', required: false },
  ];

  result.innerHTML = `
    <div class="section">
      <div class="upload-detected warn">
        <i class="fa-solid fa-triangle-exclamation"></i>
        We couldn't auto-detect your bank. Use the sample data below to match each column.
      </div>
      <p class="mapping-hint">Here's a preview of your file — match each field to the right column:</p>
      ${sampleTableHTML}
      <div class="manual-mapping-grid">
        ${FIELDS.map(f => `
          <div class="mapping-field">
            <label class="form-label">${f.label}${f.required ? ' <span class="req">*</span>' : ''}</label>
            <p class="mapping-field-hint">${f.hint}</p>
            <select class="form-select" id="map-${f.id}">
              <option value="">— not in this file —</option>
              ${headers.map(h => `<option value="${h}" ${guess[f.id] === h ? 'selected' : ''}>${h}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="resetUpload()"><i class="fa-solid fa-rotate-left"></i> Start over</button>
        <button class="btn-primary" onclick="applyManualMapping()"><i class="fa-solid fa-eye"></i> Preview transactions</button>
      </div>
    </div>`;
}

function applyManualMapping() {
  const rows        = _rawRows;
  const dateCol     = document.getElementById('map-date')?.value;
  const merchantCol = document.getElementById('map-merchant')?.value;
  const amountCol   = document.getElementById('map-amount')?.value;
  const debitCol    = document.getElementById('map-debit')?.value;
  const creditCol   = document.getElementById('map-credit')?.value;
  const catCol      = document.getElementById('map-category')?.value;

  if (!dateCol || !merchantCol) {
    alert('Date and Merchant / Description are required.'); return;
  }
  if (!amountCol && !debitCol && !creditCol) {
    alert('Please map either an Amount column or Debit/Credit columns.'); return;
  }

  uploadParsed = rows.map(row => {
    let amount = 0;
    if (amountCol) {
      amount = parseAmount(row[amountCol]);
    } else {
      const debit  = debitCol  ? Math.abs(parseAmount(row[debitCol]))  : 0;
      const credit = creditCol ? Math.abs(parseAmount(row[creditCol])) : 0;
      amount = credit > 0 ? credit : (debit > 0 ? -debit : 0);
    }
    return {
      date:         parseDate(row[dateCol]),
      merchant:     clean(row[merchantCol]),
      amount,
      type:         amount < 0 ? 'debit' : 'credit',
      raw_category: catCol ? clean(row[catCol]) : null,
    };
  }).filter(r => r.date && r.amount !== 0);

  showUploadPreview('Custom import', uploadParsed, true);
}

/* ── CONFIRM IMPORT ── */
async function confirmImport() {
  if (!currentUser) return;

  const sel    = document.getElementById('upload-account-select');
  const acctId = sel ? sel.value : uploadAccountId;
  if (!acctId) { alert('Please select an account at the top before importing.'); return; }
  uploadAccountId = acctId;

  if (!uploadParsed.length) return;

  const btn = document.querySelector('.upload-actions .btn-primary');
  const result = document.getElementById('upload-result');

  // Show progress
  const setProgress = (msg) => {
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${msg}`; }
  };

  setProgress('Preparing…');

  const rows = uploadParsed.map(r => ({
    user_id:      currentUser.id,
    account_id:   uploadAccountId,
    date:         r.date,
    merchant:     r.merchant || '',
    amount:       r.amount,
    type:         r.type,
    category:     'other',
    raw_category: r.raw_category || null,
  }));

  // Supabase has a row limit per request — batch in chunks of 500
  const CHUNK = 500;
  let imported = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    setProgress(`Importing ${Math.min(i + CHUNK, rows.length)} of ${rows.length}…`);

    const { error } = await sb.from('transactions').insert(chunk);

    if (error) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-database"></i> Import transactions'; }
      showUploadError(`Import failed on row ~${i + 1}: ${error.message}<br><small>Code: ${error.code || 'unknown'} — ${error.details || ''}</small>`);
      return;
    }
    imported += chunk.length;
  }

  showUploadSuccess(imported);
}

function showUploadSuccess(count) {
  document.getElementById('upload-result').innerHTML = `
    <div class="upload-success">
      <i class="fa-solid fa-circle-check"></i>
      <h3>${count} transactions imported!</h3>
      <p>Head to the Budget page to see your spending by category.</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="resetUpload()">Upload another file</button>
        <button class="btn-primary" onclick="showPage('budget')">Go to Budget <i class="fa-solid fa-arrow-right"></i></button>
      </div>
    </div>`;
}

function showUploadError(msg) {
  document.getElementById('upload-result').innerHTML = `
    <div class="upload-error">
      <i class="fa-solid fa-circle-exclamation"></i> ${msg}
    </div>`;
}

function resetUpload() {
  uploadParsed      = [];
  uploadAccountId   = null;
  uploadInstitution = null;
  _rawHeaders       = [];
  _rawRows          = [];
  renderUploadPage();
  populateAccountSelect();
}

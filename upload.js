/* ============================================================
   HARVEST — upload.js
   CSV parsing, institution detection, preview, Supabase import
   ============================================================ */

'use strict';

/* ── KNOWN INSTITUTION FORMATS ──
   Each entry maps a set of known header patterns to a normalizer function.
   normalizer(row) returns: { date, merchant, amount, type, raw_category }
   amount convention: negative = expense, positive = income
   ============================================================ */
const INSTITUTIONS = [

  {
    name: 'Chase',
    detect: h => h.includes('Transaction Date') && h.includes('Description') && h.includes('Amount'),
    normalize: row => ({
      date:         parseDate(row['Transaction Date']),
      merchant:     clean(row['Description']),
      amount:       parseAmount(row['Amount']),
      type:         parseFloat(row['Amount']) < 0 ? 'debit' : 'credit',
      raw_category: clean(row['Category']),
    })
  },

  {
    name: 'Bank of America',
    detect: h => h.includes('Date') && h.includes('Payee') && h.includes('Amount'),
    normalize: row => ({
      date:         parseDate(row['Date']),
      merchant:     clean(row['Payee']),
      amount:       parseAmount(row['Amount']),
      type:         parseFloat(row['Amount']) < 0 ? 'debit' : 'credit',
      raw_category: clean(row['Memo']),
    })
  },

  {
    name: 'Wells Fargo',
    detect: h => h.length >= 5 && !h.includes('Description') && !h.includes('Payee') && h[0] === '' || h.includes('*'),
    // Wells Fargo exports no headers — positional columns
    normalize: row => {
      const vals = Object.values(row);
      return {
        date:         parseDate(vals[0]),
        merchant:     clean(vals[4]),
        amount:       parseAmount(vals[1]),
        type:         parseFloat(vals[1]) < 0 ? 'debit' : 'credit',
        raw_category: null,
      };
    }
  },

  {
    name: 'Ally Bank',
    detect: h => h.includes('Date') && h.includes('Description') && h.includes('Amount') && h.includes('Type'),
    normalize: row => ({
      date:         parseDate(row['Date']),
      merchant:     clean(row['Description']),
      amount:       row['Type'] === 'Debit' ? -Math.abs(parseAmount(row['Amount'])) : Math.abs(parseAmount(row['Amount'])),
      type:         row['Type'] === 'Debit' ? 'debit' : 'credit',
      raw_category: clean(row['Category']),
    })
  },

  {
    name: 'Capital One',
    detect: h => h.includes('Transaction Date') && h.includes('Transaction Type') && h.includes('Debit') && h.includes('Credit'),
    normalize: row => {
      const debit  = parseFloat(row['Debit']  || '0') || 0;
      const credit = parseFloat(row['Credit'] || '0') || 0;
      const amount = credit > 0 ? credit : -debit;
      return {
        date:         parseDate(row['Transaction Date']),
        merchant:     clean(row['Transaction Description']),
        amount,
        type:         debit > 0 ? 'debit' : 'credit',
        raw_category: clean(row['Category']),
      };
    }
  },

  {
    name: 'Citi',
    detect: h => h.includes('Date') && h.includes('Description') && h.includes('Debit') && h.includes('Credit'),
    normalize: row => {
      const debit  = parseFloat((row['Debit']  || '').replace(/[^0-9.-]/g,'')) || 0;
      const credit = parseFloat((row['Credit'] || '').replace(/[^0-9.-]/g,'')) || 0;
      const amount = credit > 0 ? credit : -debit;
      return {
        date:         parseDate(row['Date']),
        merchant:     clean(row['Description']),
        amount,
        type:         debit > 0 ? 'debit' : 'credit',
        raw_category: clean(row['Member Name']),
      };
    }
  },

  {
    name: 'American Express',
    detect: h => h.includes('Date') && h.includes('Description') && h.includes('Amount') && h.includes('Card Member'),
    normalize: row => ({
      date:         parseDate(row['Date']),
      merchant:     clean(row['Description']),
      // Amex exports positive = charge, negative = credit/refund
      amount:       -parseAmount(row['Amount']),
      type:         parseAmount(row['Amount']) > 0 ? 'debit' : 'credit',
      raw_category: clean(row['Category']),
    })
  },

  {
    name: 'Discover',
    detect: h => h.includes('Trans. Date') && h.includes('Description') && h.includes('Amount'),
    normalize: row => ({
      date:         parseDate(row['Trans. Date']),
      merchant:     clean(row['Description']),
      amount:       -parseAmount(row['Amount']), // Discover: positive = charge
      type:         parseAmount(row['Amount']) > 0 ? 'debit' : 'credit',
      raw_category: clean(row['Category']),
    })
  },

  {
    name: 'Fidelity',
    detect: h => h.includes('Settlement Date') && h.includes('Description') && h.includes('Amount ($)'),
    normalize: row => ({
      date:         parseDate(row['Settlement Date'] || row['Run Date']),
      merchant:     clean(row['Description']),
      amount:       parseAmount(row['Amount ($)']),
      type:         parseAmount(row['Amount ($)']) < 0 ? 'debit' : 'credit',
      raw_category: clean(row['Type']),
    })
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
  // Try common formats: MM/DD/YYYY, YYYY-MM-DD, MM-DD-YYYY
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

  // Find header row (skip leading blank/comment lines)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].trim() && !lines[i].startsWith('Account') && !lines[i].startsWith('Total')) {
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
    headers.forEach((h, j) => { row[h] = vals[j] || ''; });
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
  return INSTITUTIONS.find(inst => inst.detect(headers)) || null;
}

/* ── UPLOAD STATE ── */
let uploadParsed    = [];   // normalized rows ready to import
let uploadAccountId = null;
let uploadInstitution = null;
let unmappedHeaders = [];

/* ── RENDER UPLOAD PAGE ── */
function renderUploadPage() {
  const content = document.getElementById('upload-content');
  if (!content) return;
  content.innerHTML = buildUploadHTML();
}

function buildUploadHTML() {
  return `
    <div class="section">
      <div class="section-title"><i class="fa-solid fa-university"></i> Which account is this for?</div>
      <select class="form-select" id="upload-account-select" style="max-width:360px" onchange="uploadAccountId=this.value">
        <option value="">— Select an account —</option>
      </select>
    </div>
    <div class="section">
      <div class="section-title"><i class="fa-solid fa-file-csv"></i> Upload a CSV export</div>
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
    <div id="upload-result"></div>`;
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
  document.getElementById('upload-dropzone').classList.add('drag-over');
}
function uploadDragLeave(e) {
  document.getElementById('upload-dropzone').classList.remove('drag-over');
}
function uploadDrop(e) {
  e.preventDefault();
  document.getElementById('upload-dropzone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}
function uploadFileSelected(input) {
  if (input.files[0]) processFile(input.files[0]);
}

/* ── PROCESS FILE ── */
function processFile(file) {
  if (!file.name.endsWith('.csv')) {
    showUploadError('Please upload a .csv file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => handleCSVText(e.target.result, file.name);
  reader.readAsText(file);
}

function handleCSVText(text, filename) {
  const { headers, rows } = parseCSV(text);
  if (!rows.length) { showUploadError('No transactions found in this file.'); return; }

  const inst = detectInstitution(headers);
  uploadInstitution = inst;

  if (inst) {
    // Auto-normalize all rows
    uploadParsed = rows.map(r => inst.normalize(r)).filter(r => r.date && r.amount !== 0);
    showUploadPreview(inst.name, uploadParsed);
  } else {
    // Unknown format — show manual mapping UI
    showManualMapping(headers, rows);
  }
}

/* ── PREVIEW TABLE ── */
function showUploadPreview(instName, rows) {
  const result = document.getElementById('upload-result');
  const expenses = rows.filter(r => r.amount < 0).length;
  const income   = rows.filter(r => r.amount > 0).length;
  const total    = rows.reduce((s, r) => s + r.amount, 0);

  result.innerHTML = `
    <div class="section">
      <div class="upload-detected">
        <i class="fa-solid fa-circle-check" style="color:var(--green-pos)"></i>
        Detected: <strong>${instName}</strong> — ${rows.length} transactions found
      </div>
      <div class="upload-preview-stats">
        <div class="upload-stat"><span>${expenses}</span> expenses</div>
        <div class="upload-stat"><span>${income}</span> income</div>
        <div class="upload-stat ${total < 0 ? 'neg' : 'pos'}"><span>${fmtFull(total)}</span> net</div>
      </div>
      <div class="upload-table-wrap">
        <table class="upload-table">
          <thead>
            <tr>
              <th>Date</th><th>Merchant</th><th>Amount</th><th>Category</th>
            </tr>
          </thead>
          <tbody>
            ${rows.slice(0, 50).map(r => `
              <tr>
                <td>${r.date || '—'}</td>
                <td>${r.merchant || '—'}</td>
                <td class="${r.amount < 0 ? 'amt-neg' : 'amt-pos'}">${fmtFull(r.amount)}</td>
                <td>${r.raw_category || '—'}</td>
              </tr>`).join('')}
            ${rows.length > 50 ? `<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary);font-size:13px">… and ${rows.length - 50} more</td></tr>` : ''}
          </tbody>
        </table>
      </div>
      <div class="upload-actions">
        <button class="btn-secondary" onclick="resetUpload()">
          <i class="fa-solid fa-rotate-left"></i> Start over
        </button>
        <button class="btn-primary" onclick="confirmImport()">
          <i class="fa-solid fa-database"></i> Import ${rows.length} transactions
        </button>
      </div>
    </div>`;
}

/* ── MANUAL COLUMN MAPPING ── */
function showManualMapping(headers, rows) {
  const result = document.getElementById('upload-result');
  const FIELDS = [
    { id: 'date',     label: 'Date',        required: true  },
    { id: 'merchant', label: 'Merchant',     required: true  },
    { id: 'amount',   label: 'Amount',       required: false },
    { id: 'debit',    label: 'Debit column', required: false },
    { id: 'credit',   label: 'Credit column',required: false },
    { id: 'category', label: 'Category',     required: false },
  ];

  result.innerHTML = `
    <div class="section">
      <div class="upload-detected warn">
        <i class="fa-solid fa-triangle-exclamation" style="color:var(--amber)"></i>
        Couldn't auto-detect your bank. Map the columns manually:
      </div>
      <div class="manual-mapping-grid">
        ${FIELDS.map(f => `
          <div class="form-row">
            <label class="form-label">${f.label}${f.required ? ' *' : ''}</label>
            <select class="form-select" id="map-${f.id}">
              <option value="">— skip —</option>
              ${headers.map(h => `<option value="${h}">${h}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>
      <button class="btn-primary" style="margin-top:8px" onclick="applyManualMapping(${JSON.stringify(rows).replace(/</g,'&lt;')})">
        <i class="fa-solid fa-arrow-right"></i> Preview transactions
      </button>
    </div>`;

  // Store rows for later
  window._manualRows = rows;
}

function applyManualMapping() {
  const rows    = window._manualRows || [];
  const dateCol     = document.getElementById('map-date')?.value;
  const merchantCol = document.getElementById('map-merchant')?.value;
  const amountCol   = document.getElementById('map-amount')?.value;
  const debitCol    = document.getElementById('map-debit')?.value;
  const creditCol   = document.getElementById('map-credit')?.value;
  const catCol      = document.getElementById('map-category')?.value;

  if (!dateCol || !merchantCol) {
    alert('Date and Merchant columns are required.');
    return;
  }

  uploadParsed = rows.map(row => {
    let amount = 0;
    if (amountCol) {
      amount = parseAmount(row[amountCol]);
    } else if (debitCol || creditCol) {
      const debit  = debitCol  ? Math.abs(parseAmount(row[debitCol]))  : 0;
      const credit = creditCol ? Math.abs(parseAmount(row[creditCol])) : 0;
      amount = credit > 0 ? credit : -debit;
    }
    return {
      date:         parseDate(row[dateCol]),
      merchant:     clean(row[merchantCol]),
      amount,
      type:         amount < 0 ? 'debit' : 'credit',
      raw_category: catCol ? clean(row[catCol]) : null,
    };
  }).filter(r => r.date && r.amount !== 0);

  showUploadPreview('Custom import', uploadParsed);
}

/* ── CONFIRM IMPORT ── */
async function confirmImport() {
  if (!currentUser) return;
  if (!uploadAccountId) {
    alert('Please select an account at the top before importing.');
    return;
  }
  if (!uploadParsed.length) return;

  const btn = document.querySelector('.upload-actions .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importing…'; }

  const rows = uploadParsed.map(r => ({
    user_id:      currentUser.id,
    account_id:   uploadAccountId,
    date:         r.date,
    merchant:     r.merchant,
    amount:       r.amount,
    type:         r.type,
    category:     'other',      // default — user can reassign on Expenses page
    raw_category: r.raw_category || null,
  }));

  const { error } = await sb.from('transactions').insert(rows);

  if (error) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-database"></i> Import transactions'; }
    showUploadError('Import failed: ' + error.message);
    return;
  }

  showUploadSuccess(rows.length);
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
  renderUploadPage();
  populateAccountSelect();
}

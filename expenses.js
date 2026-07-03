/* ============================================================
   HARVEST — expenses.js
   Transaction list, filtering, inline categorization,
   bulk assign, merchant memory
   ============================================================ */

'use strict';

/* ── STATE ── */
let allTransactions  = [];
let filteredTxns     = [];
let merchantRules    = {};   // { normalizedMerchant: category }
let selectedTxnIds   = new Set();
let expenseAccounts  = [];

let expenseFilters = {
  search:   '',
  account:  '',
  category: '',
  type:     '',           // 'debit' | 'credit' | ''
  dateFrom: '',
  dateTo:   '',
};

let expenseSort = { col: 'date', dir: 'desc' };

/* ── NORMALIZE MERCHANT for rule matching ── */
function normMerchant(m) {
  return String(m || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/* ============================================================
   RENDER EXPENSES PAGE
   ============================================================ */
async function renderExpensesPage() {
  if (!currentUser) return;

  const page = document.getElementById('page-expenses');
  // Replace stub with real layout
  page.innerHTML = `
    <div class="page-topbar">
      <div class="page-topbar-left">
        <h1>Expenses</h1>
        <p id="expenses-count">Loading…</p>
      </div>
      <div class="topbar-actions">
        <button class="btn-secondary btn-sm" onclick="showPage('upload')">
          <i class="fa-solid fa-arrow-up-from-bracket"></i> Upload more
        </button>
      </div>
    </div>
    <div class="page-content">
      ${buildFiltersHTML()}
      <div id="bulk-bar" class="bulk-bar" style="display:none"></div>
      <div id="txn-list"></div>
    </div>`;

  // Load data in parallel
  const [txnRes, acctRes, ruleRes] = await Promise.all([
    sb.from('transactions').select('*').eq('user_id', currentUser.id).order('date', { ascending: false }),
    sb.from('accounts').select('id,name,type').eq('user_id', currentUser.id).order('name'),
    sb.from('merchant_rules').select('merchant,category').eq('user_id', currentUser.id),
  ]);

  allTransactions = txnRes.data || [];
  expenseAccounts = acctRes.data || [];
  merchantRules   = {};
  (ruleRes.data || []).forEach(r => { merchantRules[r.merchant] = r.category; });

  // Auto-apply rules to uncategorized transactions (in memory only)
  allTransactions.forEach(t => {
    if (t.category === 'other' || !t.category) {
      const rule = merchantRules[normMerchant(t.merchant)];
      if (rule) t._suggestedCat = rule;
    }
  });

  populateExpenseAccountFilter();
  applyFiltersAndRender();
}

function buildFiltersHTML() {
  return `
    <div class="expense-filters">
      <div class="expense-search-wrap">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input class="expense-search" id="exp-search" type="text"
          placeholder="Search merchant…"
          oninput="expenseFilters.search=this.value; applyFiltersAndRender()">
      </div>
      <select class="form-select expense-filter-sel" id="exp-account"
        onchange="expenseFilters.account=this.value; applyFiltersAndRender()">
        <option value="">All accounts</option>
      </select>
      <select class="form-select expense-filter-sel" id="exp-type"
        onchange="expenseFilters.type=this.value; applyFiltersAndRender()">
        <option value="">All types</option>
        <option value="debit">Expenses</option>
        <option value="credit">Income / Credits</option>
      </select>
      <select class="form-select expense-filter-sel" id="exp-category"
        onchange="expenseFilters.category=this.value; applyFiltersAndRender()">
        <option value="">All categories</option>
        ${Object.entries(CAT_META).map(([id, m]) =>
          `<option value="${id}">${m.label}</option>`).join('')}
      </select>
      <div class="expense-date-range">
        <input class="form-input expense-date-input" type="date" id="exp-from"
          onchange="expenseFilters.dateFrom=this.value; applyFiltersAndRender()">
        <span class="date-sep">–</span>
        <input class="form-input expense-date-input" type="date" id="exp-to"
          onchange="expenseFilters.dateTo=this.value; applyFiltersAndRender()">
      </div>
      <button class="btn-ghost" onclick="clearExpenseFilters()">
        <i class="fa-solid fa-xmark"></i> Clear
      </button>
    </div>`;
}

function populateExpenseAccountFilter() {
  const sel = document.getElementById('exp-account');
  if (!sel) return;
  expenseAccounts.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  });
}

function clearExpenseFilters() {
  expenseFilters = { search: '', account: '', category: '', type: '', dateFrom: '', dateTo: '' };
  document.getElementById('exp-search').value   = '';
  document.getElementById('exp-account').value  = '';
  document.getElementById('exp-type').value     = '';
  document.getElementById('exp-category').value = '';
  document.getElementById('exp-from').value     = '';
  document.getElementById('exp-to').value       = '';
  applyFiltersAndRender();
}

/* ============================================================
   FILTER + SORT
   ============================================================ */
function applyFiltersAndRender() {
  const { search, account, category, type, dateFrom, dateTo } = expenseFilters;
  const q = search.toLowerCase();

  filteredTxns = allTransactions.filter(t => {
    if (q        && !t.merchant?.toLowerCase().includes(q)) return false;
    if (account  && t.account_id !== account)               return false;
    if (category && t.category !== category)                return false;
    if (type     && t.type !== type)                        return false;
    if (dateFrom && t.date < dateFrom)                      return false;
    if (dateTo   && t.date > dateTo)                        return false;
    return true;
  });

  // Sort
  filteredTxns.sort((a, b) => {
    let av = a[expenseSort.col], bv = b[expenseSort.col];
    if (expenseSort.col === 'amount') { av = parseFloat(av); bv = parseFloat(bv); }
    if (av < bv) return expenseSort.dir === 'asc' ? -1 : 1;
    if (av > bv) return expenseSort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const count = document.getElementById('expenses-count');
  if (count) {
    const total = filteredTxns.reduce((s, t) => s + parseFloat(t.amount), 0);
    count.textContent = `${filteredTxns.length} transaction${filteredTxns.length !== 1 ? 's' : ''} · net ${fmtFull(total)}`;
  }

  selectedTxnIds.clear();
  renderBulkBar();
  renderTxnList();
}

function setSort(col) {
  if (expenseSort.col === col) {
    expenseSort.dir = expenseSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    expenseSort.col = col;
    expenseSort.dir = col === 'date' ? 'desc' : 'asc';
  }
  applyFiltersAndRender();
}

/* ============================================================
   TRANSACTION LIST
   ============================================================ */
function renderTxnList() {
  const container = document.getElementById('txn-list');
  if (!container) return;

  if (!filteredTxns.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-receipt"></i>
        <p>${allTransactions.length ? 'No transactions match your filters.' : 'No transactions yet. Upload a CSV to get started.'}</p>
        ${!allTransactions.length ? `<button class="btn-primary btn-sm" onclick="showPage('upload')"><i class="fa-solid fa-arrow-up-from-bracket"></i> Upload transactions</button>` : ''}
      </div>`;
    return;
  }

  // Group by month
  const groups = {};
  filteredTxns.forEach(t => {
    const ym = t.date?.slice(0, 7) || 'Unknown';
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(t);
  });

  const sortIcon = (col) => {
    if (expenseSort.col !== col) return '<i class="fa-solid fa-sort" style="opacity:.3"></i>';
    return expenseSort.dir === 'asc'
      ? '<i class="fa-solid fa-sort-up"></i>'
      : '<i class="fa-solid fa-sort-down"></i>';
  };

  container.innerHTML = `
    <div class="txn-table-wrap">
      <table class="txn-table">
        <thead>
          <tr>
            <th class="txn-check-col">
              <input type="checkbox" id="select-all-chk" onchange="toggleSelectAll(this.checked)"
                title="Select all">
            </th>
            <th class="sortable" onclick="setSort('date')">Date ${sortIcon('date')}</th>
            <th class="sortable" onclick="setSort('merchant')">Merchant ${sortIcon('merchant')}</th>
            <th>Account</th>
            <th class="sortable" onclick="setSort('amount')">Amount ${sortIcon('amount')}</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(groups).map(([ym, txns]) => `
            <tr class="txn-month-header">
              <td colspan="6">${monthLabel(ym)} <span class="txn-month-count">${txns.length}</span></td>
            </tr>
            ${txns.map(t => renderTxnRow(t)).join('')}
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderTxnRow(t) {
  const amt      = parseFloat(t.amount);
  const isDebit  = amt < 0;
  const acct     = expenseAccounts.find(a => a.id === t.account_id);
  const cat      = CAT_META[t.category] || CAT_META['other'];
  const hasSug   = t._suggestedCat && t.category === 'other';
  const checked  = selectedTxnIds.has(t.id);

  return `
    <tr class="txn-row ${checked ? 'selected' : ''}" data-id="${t.id}">
      <td class="txn-check-col">
        <input type="checkbox" ${checked ? 'checked' : ''}
          onchange="toggleTxnSelect('${t.id}', this.checked)" onclick="event.stopPropagation()">
      </td>
      <td class="txn-date">${formatTxnDate(t.date)}</td>
      <td class="txn-merchant">
        <span class="txn-merchant-name">${t.merchant || '—'}</span>
        ${t.raw_category ? `<span class="txn-raw-cat">${t.raw_category}</span>` : ''}
      </td>
      <td class="txn-account">${acct ? acct.name : '—'}</td>
      <td class="txn-amount ${isDebit ? 'amt-neg' : 'amt-pos'}">${fmtFull(amt)}</td>
      <td class="txn-cat-cell">
        ${hasSug ? `
          <div class="txn-suggestion">
            <span class="suggestion-label">Usually: ${CAT_META[t._suggestedCat]?.label}</span>
            <button class="suggestion-apply" onclick="applySuggestion('${t.id}', '${t._suggestedCat}')">Apply</button>
          </div>` : ''}
        <div class="txn-cat-select-wrap">
          <select class="txn-cat-select" data-id="${t.id}" onchange="categorizeTxn('${t.id}', this.value, '${normMerchant(t.merchant)}')">
            ${Object.entries(CAT_META).map(([id, m]) =>
              `<option value="${id}" ${t.category === id ? 'selected' : ''}>${m.label}</option>`
            ).join('')}
          </select>
        </div>
      </td>
    </tr>`;
}

function formatTxnDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ============================================================
   CATEGORIZATION
   ============================================================ */
async function categorizeTxn(txnId, category, merchantNorm) {
  // Update in memory immediately for snappy UI
  const txn = allTransactions.find(t => t.id === txnId);
  if (txn) { txn.category = category; txn._suggestedCat = null; }

  // Save to Supabase
  await sb.from('transactions').update({ category }).eq('id', txnId);

  // Offer to remember this merchant
  if (merchantNorm && category !== 'other') {
    const existing = merchantRules[merchantNorm];
    if (existing !== category) {
      showRememberMerchantToast(txnId, merchantNorm, txn?.merchant, category);
    }
  }
}

async function applySuggestion(txnId, category) {
  const txn = allTransactions.find(t => t.id === txnId);
  if (!txn) return;
  txn.category      = category;
  txn._suggestedCat = null;
  await sb.from('transactions').update({ category }).eq('id', txnId);
  renderTxnList();
}

function showRememberMerchantToast(txnId, merchantNorm, merchantDisplay, category) {
  // Remove any existing toast
  document.getElementById('merchant-toast')?.remove();

  const catLabel = CAT_META[category]?.label || category;
  const toast = document.createElement('div');
  toast.id = 'merchant-toast';
  toast.className = 'merchant-toast';
  toast.innerHTML = `
    <div class="merchant-toast-msg">
      <i class="fa-solid fa-brain"></i>
      Always categorize <strong>${merchantDisplay}</strong> as <strong>${catLabel}</strong>?
    </div>
    <div class="merchant-toast-actions">
      <button class="toast-btn-yes" onclick="rememberMerchant('${merchantNorm}', '${merchantDisplay}', '${category}')">
        Yes, remember it
      </button>
      <button class="toast-btn-no" onclick="document.getElementById('merchant-toast')?.remove()">
        Just this once
      </button>
    </div>`;
  document.body.appendChild(toast);

  // Auto-dismiss after 8 seconds
  setTimeout(() => toast.remove(), 8000);
}

async function rememberMerchant(merchantNorm, merchantDisplay, category) {
  document.getElementById('merchant-toast')?.remove();
  merchantRules[merchantNorm] = category;

  await sb.from('merchant_rules').upsert(
    { user_id: currentUser.id, merchant: merchantNorm, category },
    { onConflict: 'user_id,merchant' }
  );

  // Apply rule to all uncategorized transactions from this merchant
  const toUpdate = allTransactions.filter(t =>
    normMerchant(t.merchant) === merchantNorm && (t.category === 'other' || !t.category)
  );

  if (toUpdate.length > 1) {
    await Promise.all(toUpdate.map(t => {
      t.category = category;
      return sb.from('transactions').update({ category }).eq('id', t.id);
    }));
    applyFiltersAndRender();
    showQuickToast(`Updated ${toUpdate.length} "${merchantDisplay}" transactions`);
  }
}

function showQuickToast(msg) {
  document.getElementById('merchant-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'merchant-toast';
  toast.className = 'merchant-toast success';
  toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${msg}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* ============================================================
   BULK SELECTION
   ============================================================ */
function toggleTxnSelect(id, checked) {
  if (checked) selectedTxnIds.add(id);
  else         selectedTxnIds.delete(id);
  renderBulkBar();

  // Update row highlight
  const row = document.querySelector(`tr.txn-row[data-id="${id}"]`);
  if (row) row.classList.toggle('selected', checked);

  // Update select-all state
  const allChk = document.getElementById('select-all-chk');
  if (allChk) allChk.checked = selectedTxnIds.size === filteredTxns.length;
}

function toggleSelectAll(checked) {
  selectedTxnIds.clear();
  if (checked) filteredTxns.forEach(t => selectedTxnIds.add(t.id));
  renderBulkBar();
  renderTxnList();
  if (checked) {
    const allChk = document.getElementById('select-all-chk');
    if (allChk) allChk.checked = true;
  }
}

function renderBulkBar() {
  const bar = document.getElementById('bulk-bar');
  if (!bar) return;

  if (selectedTxnIds.size === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = `
    <div class="bulk-bar-left">
      <i class="fa-solid fa-check-square"></i>
      <strong>${selectedTxnIds.size}</strong> selected
    </div>
    <div class="bulk-bar-right">
      <span class="bulk-label">Set category:</span>
      <select class="form-select bulk-cat-select" onchange="bulkCategorize(this.value); this.value=''">
        <option value="">— Choose —</option>
        ${Object.entries(CAT_META).map(([id, m]) =>
          `<option value="${id}">${m.label}</option>`).join('')}
      </select>
      <button class="btn-ghost bulk-clear" onclick="toggleSelectAll(false)">
        <i class="fa-solid fa-xmark"></i> Clear selection
      </button>
    </div>`;
}

async function bulkCategorize(category) {
  if (!category || selectedTxnIds.size === 0) return;

  const ids = [...selectedTxnIds];

  // Update in memory
  ids.forEach(id => {
    const t = allTransactions.find(t => t.id === id);
    if (t) t.category = category;
  });

  // Update in Supabase in batches
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    await sb.from('transactions').update({ category }).in('id', chunk);
  }

  selectedTxnIds.clear();
  renderBulkBar();
  applyFiltersAndRender();
  showQuickToast(`Updated ${ids.length} transactions to "${CAT_META[category]?.label}"`);
}

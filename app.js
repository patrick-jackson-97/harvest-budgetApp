/* ============================================================
   HARVEST — app.js
   Auth + Dashboard + Budget page
   ============================================================ */

'use strict';

/* ── SUPABASE ── */
const SUPABASE_URL = 'https://gvdbwnkhksdvauopjfnf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZGJ3bmtoa3NkdmF1b3BqZm5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNzgxMjcsImV4cCI6MjA5ODY1NDEyN30.FXGmQKaWmLjtN5BUHQEViHUkL8hlpdEJY7l9iBba76Y';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true }
});

let currentUser = null;
let trendChart  = null;

/* ── ACCOUNT TYPE META ── */
const TYPE_META = {
  checking:   { label: 'Checking',    iconClass: 'checking',   icon: 'fa-solid fa-landmark',            pill: '🏦 Checking'  },
  savings:    { label: 'Savings',     iconClass: 'savings',    icon: 'fa-solid fa-piggy-bank',           pill: '🌱 Savings'   },
  investment: { label: 'Investment',  iconClass: 'investment', icon: 'fa-solid fa-chart-line',           pill: '📈 Investing' },
  credit:     { label: 'Credit Card', iconClass: 'credit',     icon: 'fa-solid fa-credit-card',          pill: null           },
  loan:       { label: 'Loan',        iconClass: 'loan',       icon: 'fa-solid fa-hand-holding-dollar',  pill: null           },
};

/* ── CATEGORY META ── */
const CAT_META = {
  housing:       { label: 'Housing',             icon: 'fa-solid fa-house' },
  groceries:     { label: 'Groceries',           icon: 'fa-solid fa-basket-shopping' },
  dining:        { label: 'Dining Out',          icon: 'fa-solid fa-utensils' },
  transport:     { label: 'Transportation',      icon: 'fa-solid fa-car' },
  utilities:     { label: 'Utilities',           icon: 'fa-solid fa-bolt' },
  health:        { label: 'Health',              icon: 'fa-solid fa-heart-pulse' },
  subscriptions: { label: 'Subscriptions',       icon: 'fa-solid fa-rotate' },
  clothing:      { label: 'Clothing',            icon: 'fa-solid fa-shirt' },
  entertainment: { label: 'Entertainment',       icon: 'fa-solid fa-clapperboard' },
  travel:        { label: 'Travel',              icon: 'fa-solid fa-plane' },
  pets:          { label: 'Pets',                icon: 'fa-solid fa-paw' },
  education:        { label: 'Education',           icon: 'fa-solid fa-graduation-cap' },
  home_improvement: { label: 'Home Improvement',   icon: 'fa-solid fa-hammer' },
  insurance:        { label: 'Insurance',           icon: 'fa-solid fa-shield-halved' },
  savings_cat:      { label: 'Savings / Investing', icon: 'fa-solid fa-seedling' },
  personal:      { label: 'Personal Care',       icon: 'fa-solid fa-spa' },
  kids:          { label: 'Kids / Family',       icon: 'fa-solid fa-baby' },
  income:        { label: 'Income',              icon: 'fa-solid fa-arrow-down-to-bracket' },
  cc_payment:    { label: 'Credit Card Payment', icon: 'fa-solid fa-credit-card' },
  other:         { label: 'Other',               icon: 'fa-solid fa-ellipsis' },
};

/* ============================================================
   AUTH
   ============================================================ */
async function sendMagicLink() {
  const email = document.getElementById('login-email').value.trim();
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!email) { showLoginError('Please enter your email address.'); return; }

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

  const redirectUrl = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl }
  });

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send link';

  if (error) { showLoginError(error.message); return; }

  document.getElementById('login-sent-email').textContent = email;
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('login-sent').style.display  = 'block';
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function resetLoginForm() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('login-sent').style.display  = 'none';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-email').value = '';
}

async function signOut() {
  await sb.auth.signOut();
  currentUser = null;
  showLoginScreen();
}

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  resetLoginForm();
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', () => {
  const emailInput = document.getElementById('login-email');
  if (emailInput) emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMagicLink(); });
});

/* ============================================================
   BOOT — process magic link before any auth check
   ============================================================ */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();

  if (session) {
    currentUser = session.user;
    showApp();
    renderDashboard();
    initBudgetPage();
  } else {
    showLoginScreen();
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      showApp();
      renderDashboard();
      initBudgetPage();
    }
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      showLoginScreen();
    }
  });
}

boot();

/* ============================================================
   NAVIGATION
   ============================================================ */
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });
  document.getElementById('page-' + page)?.classList.add('active');
  if (page === 'dashboard') renderDashboard();
  if (page === 'budget')    renderBudgetPage();
  if (page === 'upload')    { renderUploadPage(); populateAccountSelect(); }
  if (page === 'expenses')  renderExpensesPage();
  if (page === 'security')  renderSecurityPage();
}

/* ============================================================
   FORMAT HELPERS
   ============================================================ */
function fmt(n) {
  const abs = Math.abs(n);
  const s   = abs >= 1000 ? '$' + (abs / 1000).toFixed(1) + 'k' : '$' + abs.toLocaleString();
  return n < 0 ? '-' + s : s;
}
function fmtFull(n) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function currentYM() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function offsetYM(ym, months) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function renderDashboard() {
  if (!currentUser) return;
  renderTopbarDate();

  const { data: accounts } = await sb.from('accounts')
    .select('*').eq('user_id', currentUser.id).order('type');

  if (!accounts || accounts.length === 0) {
    renderEmptyDashboard(); return;
  }

  renderNetWorth(accounts);
  renderStatRow(accounts);
  renderAccountCards(accounts);
  await renderTrendChart(accounts);
}

function renderTopbarDate() {
  const el = document.getElementById('topbar-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function renderEmptyDashboard() {
  document.getElementById('nw-total').textContent = '$0.00';
  document.getElementById('nw-change').textContent = '';
  document.getElementById('nw-pills').innerHTML = '';
  document.getElementById('stat-row').innerHTML = '';
  document.getElementById('account-cards').innerHTML = `
    <div class="empty-state" style="grid-column:1/-1">
      <i class="fa-solid fa-seedling"></i>
      <p>No accounts yet. <button class="btn-ghost" onclick="showIntake()">Add your first account</button></p>
    </div>`;
  const chartCard = document.querySelector('.card.card-padded');
  if (chartCard) chartCard.style.display = 'none';
}

function isDebtAccount(a) {
  return a.type === 'credit' || a.type === 'loan';
}

function accountNetWorthValue(a) {
  if (a.exclude_from_net_worth) return 0;
  const bal = parseFloat(a.balance) || 0;
  return isDebtAccount(a) ? -Math.abs(bal) : bal;
}

function renderNetWorth(accounts) {
  const total = accounts.reduce((s, a) => s + accountNetWorthValue(a), 0);
  document.getElementById('nw-total').textContent = fmtFull(total);

  const groups = {};
  accounts.forEach(a => {
    if (!groups[a.type]) groups[a.type] = 0;
    groups[a.type] += parseFloat(a.balance) || 0;
  });

  document.getElementById('nw-pills').innerHTML = Object.entries(groups)
    .filter(([type]) => TYPE_META[type]?.pill)
    .map(([type, val]) => `
      <div class="networth-pill">
        <i class="${TYPE_META[type].icon}"></i> ${TYPE_META[type].pill}: ${fmt(val)}
      </div>`).join('');

  document.getElementById('nw-change').innerHTML =
    `<span style="color:rgba(255,255,255,.6)">Upload balance history to track changes over time</span>`;
}

function renderStatRow(accounts) {
  const assets      = accounts.filter(a => !isDebtAccount(a)).reduce((s,a) => s + (parseFloat(a.balance)||0), 0);
  const liabilities = accounts.filter(a => isDebtAccount(a) && !a.exclude_from_net_worth).reduce((s,a) => s + Math.abs(parseFloat(a.balance)||0), 0);
  const liquid      = accounts.filter(a => a.type === 'checking' || a.type === 'savings').reduce((s,a) => s + (parseFloat(a.balance)||0), 0);

  document.getElementById('stat-row').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Assets</div>
      <div class="stat-value">${fmt(assets)}</div>
      <div class="stat-change neutral">Accounts &amp; investments</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Debt</div>
      <div class="stat-value" style="color:var(--red)">${fmt(liabilities)}</div>
      <div class="stat-change neutral">Credit cards &amp; loans</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Liquid Cash</div>
      <div class="stat-value">${fmt(liquid)}</div>
      <div class="stat-change neutral">Checking + savings</div>
    </div>`;
}

function renderAccountCards(accounts) {
  document.getElementById('account-cards').innerHTML = accounts.map(a => {
    const meta    = TYPE_META[a.type] || {};
    const bal     = parseFloat(a.balance) || 0;
    const isDebt  = isDebtAccount(a);
    const excluded = a.exclude_from_net_worth;
    return `
      <div class="account-card" onclick="openAccountDrawer(${JSON.stringify(a).replace(/"/g,'&quot;')})" style="cursor:pointer">
        <div class="account-card-icon ${meta.iconClass || ''}">
          <i class="${meta.icon || 'fa-solid fa-circle-dollar-to-slot'}"></i>
        </div>
        <div class="account-card-type">${meta.label || a.type}${excluded ? ' <span class="acct-excluded-tag">excluded</span>' : ''}</div>
        <div class="account-card-name">${a.name}</div>
        <div class="account-card-balance ${isDebt ? 'liability' : 'asset'}">${isDebt ? '-' : ''}${fmtFull(Math.abs(bal))}</div>
      </div>`;
  }).join('');
}

/* ── ACCOUNT DETAIL / EDIT DRAWER ── */
async function openAccountDrawer(account) {
  const existing = document.getElementById('acct-drawer-overlay');
  if (existing) existing.remove();

  const isDebt = isDebtAccount(account);
  const meta   = TYPE_META[account.type] || {};
  const bal    = parseFloat(account.balance) || 0;

  const overlay = document.createElement('div');
  overlay.id = 'acct-drawer-overlay';
  overlay.className = 'acct-drawer-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeAccountDrawer(); };

  overlay.innerHTML = `
    <div class="acct-drawer acct-drawer-wide">
      <div class="acct-drawer-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="account-card-icon ${meta.iconClass || ''}" style="margin:0;width:32px;height:32px;font-size:14px;flex-shrink:0">
            <i class="${meta.icon || 'fa-solid fa-wallet'}"></i>
          </div>
          <div>
            <div class="acct-drawer-title">${account.name}</div>
            <div style="font-size:12px;color:var(--text-tertiary)">${account.institution || meta.label || ''}</div>
          </div>
        </div>
        <button class="btn-ghost btn-xs" onclick="closeAccountDrawer()"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Balance hero -->
      <div class="acct-drawer-balance-hero">
        <div class="acct-drawer-balance-label">Current Balance</div>
        <div class="acct-drawer-balance-value ${isDebt ? 'liability' : 'asset'}">${isDebt ? '-' : ''}${fmtFull(Math.abs(bal))}</div>
        ${account.exclude_from_net_worth ? '<div class="acct-excluded-tag" style="display:inline-block;margin-top:6px">excluded from net worth</div>' : ''}
      </div>

      <!-- Tabs -->
      <div class="acct-drawer-tabs">
        <button class="acct-tab active" onclick="switchAcctTab('overview', this)">Overview</button>
        <button class="acct-tab" onclick="switchAcctTab('trend', this)">Balance Trend</button>
        <button class="acct-tab" onclick="switchAcctTab('transactions', this)">Transactions</button>
        <button class="acct-tab" onclick="switchAcctTab('edit', this)">Edit</button>
      </div>

      <div class="acct-drawer-body">
        <!-- OVERVIEW TAB -->
        <div id="acct-tab-overview" class="acct-tab-panel">
          <div class="acct-detail-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>
        </div>

        <!-- TREND TAB -->
        <div id="acct-tab-trend" class="acct-tab-panel" style="display:none">
          <div class="acct-detail-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>
        </div>

        <!-- TRANSACTIONS TAB -->
        <div id="acct-tab-transactions" class="acct-tab-panel" style="display:none">
          <div class="acct-detail-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>
        </div>

        <!-- EDIT TAB -->
        <div id="acct-tab-edit" class="acct-tab-panel" style="display:none">
          <div class="form-group">
            <label class="form-label">Account name</label>
            <input class="form-input" id="edit-acct-name" value="${account.name}">
          </div>
          <div class="form-group">
            <label class="form-label">Institution</label>
            <input class="form-input" id="edit-acct-institution" value="${account.institution || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Type</label>
            <select class="form-select" id="edit-acct-type">
              ${Object.entries(TYPE_META).map(([k,v]) =>
                `<option value="${k}" ${account.type===k?'selected':''}>${v.label}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Current balance</label>
            <input class="form-input" id="edit-acct-balance" type="number" step="0.01" value="${Math.abs(bal)}">
          </div>
          ${isDebt ? `
          <div class="acct-drawer-toggle">
            <label class="toggle-label">
              <input type="checkbox" id="edit-acct-exclude" ${account.exclude_from_net_worth ? 'checked' : ''}>
              <span class="toggle-track"></span>
              <span class="toggle-text">Exclude from net worth</span>
            </label>
            <p class="toggle-hint">Use when the asset this loan is against (car, home) isn't tracked in Harvest — prevents the debt from unfairly reducing your net worth.</p>
          </div>` : ''}
          <div class="acct-drawer-footer">
            <button class="btn-secondary btn-sm" onclick="closeAccountDrawer()">Cancel</button>
            <button class="btn-primary btn-sm" onclick="saveAccountEdits('${account.id}')">
              <i class="fa-solid fa-check"></i> Save changes
            </button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.querySelector('.acct-drawer').classList.add('open'));

  // Show account info immediately from the account object — no fetch needed for the basics
  populateAcctOverview(account, [], []);

  // Then fetch transactions with a 10s timeout
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Query timed out after 10s')), 10000)
  );

  try {
    const fetchPromise = sb.from('transactions')
      .select('date, amount, plaid_transaction_id')
      .eq('account_id', account.id)
      .eq('user_id', currentUser.id)
      .order('date', { ascending: false })
      .limit(2000);

    const { data: txns, error: txnErr } = await Promise.race([fetchPromise, timeoutPromise]);

    if (txnErr) throw new Error(txnErr.message);

    const allTxns = txns || [];
    console.log('[1] fetch done, rows:', allTxns.length);
    populateAcctOverview(account, allTxns, []);
    console.log('[2] overview done');
    populateAcctTrend(account, allTxns);
    console.log('[3] trend done');
  } catch(e) {
    console.error('[drawer] load error:', e);
    const p = document.getElementById('acct-tab-trend');
    if (p) p.innerHTML = `<div style="padding:24px;color:var(--red);font-size:13px"><i class="fa-solid fa-triangle-exclamation"></i> ${e.message}</div>`;
    const p2 = document.getElementById('acct-tab-overview');
    if (p2) {
      const spinner = p2.querySelector('.acct-detail-loading');
      if (spinner) spinner.innerHTML = `<span style="color:var(--red);font-size:12px">${e.message}</span>`;
    }
  }

  // Transactions tab lazy-loads on click
  const txnPanel = document.getElementById('acct-tab-transactions');
  txnPanel._accountId = account.id;
  txnPanel.innerHTML = `<div style="padding:32px 0;text-align:center;color:var(--text-tertiary);font-size:13px"><i class="fa-solid fa-hand-pointer"></i> Click the Transactions tab to load</div>`;

  // Plaid last-sync info loads in background and patches overview when ready
  if (account.plaid_account_id) {
    edgeFetch('plaid-list-items', {})
      .then(r => r.json())
      .then(({ items }) => {
        const plaidItem = (items || []).find(i => i.institution_name === account.institution);
        const el = document.getElementById('acct-overview-last-sync');
        if (el && plaidItem?.last_synced_at) {
          const d = new Date(plaidItem.last_synced_at);
          el.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
      })
      .catch(() => {});
  }
}

function switchAcctTab(tab, btn) {
  document.querySelectorAll('.acct-tab-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.acct-tab').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(`acct-tab-${tab}`);
  panel.style.display = 'block';
  btn.classList.add('active');

  // Lazy-load transactions tab on first click
  if (tab === 'transactions' && panel._accountId && !panel._loaded) {
    panel._loaded = true;
    panel.innerHTML = `<div class="acct-detail-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>`;
    sb.from('transactions')
      .select('date, merchant, amount, category, plaid_transaction_id')
      .eq('account_id', panel._accountId)
      .eq('user_id', currentUser.id)
      .order('date', { ascending: false })
      .limit(500)
      .then(({ data }) => populateAcctTransactions(data || []));
  }
}

function populateAcctOverview(account, txns, items) {
  const panel = document.getElementById('acct-tab-overview');
  if (!panel) return;

  const isDebt = isDebtAccount(account);
  const plaidItem = (items || []).find(i => i.institution_name === account.institution);

  const plaidTxns = txns.filter(t => t.plaid_transaction_id);
  const csvTxns   = txns.filter(t => !t.plaid_transaction_id);
  const totalIn   = txns.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0);
  const totalOut  = txns.filter(t => t.amount < 0).reduce((s,t) => s + t.amount, 0);
  const oldest    = txns.length ? txns[txns.length - 1].date : null;
  const newest    = txns.length ? txns[0].date : null;
  const fmtDate   = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  // Data source section
  let dataSourceHTML = '';
  if (account.plaid_account_id) {
    dataSourceHTML = `
      <div class="acct-info-card acct-info-plaid">
        <div class="acct-info-card-head">
          <i class="fa-solid fa-link"></i> Plaid Connected
          <span class="acct-badge acct-badge-plaid" style="margin-left:auto">Live sync</span>
        </div>
        <div class="acct-info-row"><span>Institution</span><strong>${account.institution || '—'}</strong></div>
        <div class="acct-info-row"><span>Last synced</span><strong id="acct-overview-last-sync">…</strong></div>
        <div class="acct-info-row"><span>Plaid transactions</span><strong>${plaidTxns.length}</strong></div>
        <div class="acct-info-card-actions">
          <button class="btn-ghost btn-xs" onclick="syncPlaidNow()"><i class="fa-solid fa-rotate"></i> Sync now</button>
          <button class="btn-ghost btn-xs acct-danger-btn" onclick="closeAccountDrawer();unlinkPlaidAccount('${account.id}','${account.name.replace(/'/g,"\\'")}')">
            <i class="fa-solid fa-unlink"></i> Unlink Plaid
          </button>
        </div>
      </div>`;
  } else {
    dataSourceHTML = `
      <div class="acct-info-card">
        <div class="acct-info-card-head"><i class="fa-solid fa-link"></i> Plaid Connection</div>
        <p style="font-size:13px;color:var(--text-secondary);margin:0">Not connected. Link this account to automatically sync transactions.</p>
        <div class="acct-info-card-actions">
          <button class="btn-primary btn-xs" onclick="closeAccountDrawer();initPlaidLink()">
            <i class="fa-solid fa-link"></i> Connect via Plaid
          </button>
        </div>
      </div>`;
  }

  if (csvTxns.length > 0) {
    dataSourceHTML += `
      <div class="acct-info-card">
        <div class="acct-info-card-head"><i class="fa-solid fa-file-csv"></i> CSV Uploads</div>
        <div class="acct-info-row"><span>Imported transactions</span><strong>${csvTxns.length}</strong></div>
        <div class="acct-info-card-actions">
          <button class="btn-ghost btn-xs" onclick="closeAccountDrawer();showPage('upload');uploadForAccount('${account.id}')">
            <i class="fa-solid fa-arrow-up-from-bracket"></i> Upload more
          </button>
        </div>
      </div>`;
  } else if (!account.plaid_account_id) {
    dataSourceHTML += `
      <div class="acct-info-card">
        <div class="acct-info-card-head"><i class="fa-solid fa-file-csv"></i> CSV Upload</div>
        <p style="font-size:13px;color:var(--text-secondary);margin:0">No CSV data yet. Export a statement from your bank and upload it.</p>
        <div class="acct-info-card-actions">
          <button class="btn-ghost btn-xs" onclick="closeAccountDrawer();showPage('upload');uploadForAccount('${account.id}')">
            <i class="fa-solid fa-file-csv"></i> Upload CSV
          </button>
        </div>
      </div>`;
  }

  panel.innerHTML = `
    <div class="acct-overview-stats">
      <div class="acct-stat">
        <div class="acct-stat-val">${txns.length}</div>
        <div class="acct-stat-lbl">Transactions</div>
      </div>
      <div class="acct-stat">
        <div class="acct-stat-val">${fmtDate(oldest)}</div>
        <div class="acct-stat-lbl">Earliest</div>
      </div>
      <div class="acct-stat">
        <div class="acct-stat-val">${fmtDate(newest)}</div>
        <div class="acct-stat-lbl">Latest</div>
      </div>
      ${!isDebt ? `
      <div class="acct-stat">
        <div class="acct-stat-val" style="color:var(--green)">${fmt(totalIn)}</div>
        <div class="acct-stat-lbl">Total in</div>
      </div>
      <div class="acct-stat">
        <div class="acct-stat-val" style="color:var(--red)">${fmt(Math.abs(totalOut))}</div>
        <div class="acct-stat-lbl">Total out</div>
      </div>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">
      ${dataSourceHTML}
    </div>
    <div style="margin-top:16px">
      <button class="btn-ghost btn-sm" onclick="closeAccountDrawer();showPage('expenses')">
        <i class="fa-solid fa-receipt"></i> View all transactions →
      </button>
    </div>`;
}

function populateAcctTransactions(txns) {
  const panel = document.getElementById('acct-tab-transactions');
  if (!panel) return;

  if (!txns || txns.length === 0) {
    panel.innerHTML = `<div class="empty-state" style="padding:40px 0"><i class="fa-solid fa-receipt"></i><p>No transactions yet</p></div>`;
    return;
  }

  panel.innerHTML = `
    <div class="acct-txn-list">
      ${txns.map(t => {
        const cat  = CAT_META[t.category] || CAT_META['other'];
        const isIn = t.amount >= 0;
        const src  = t.plaid_transaction_id ? '<i class="fa-solid fa-link" title="Plaid" style="color:var(--text-tertiary);font-size:10px"></i>' : '<i class="fa-solid fa-file-csv" title="CSV" style="color:var(--text-tertiary);font-size:10px"></i>';
        return `
          <div class="acct-txn-row">
            <div class="acct-txn-icon"><i class="${cat.icon}"></i></div>
            <div class="acct-txn-body">
              <div class="acct-txn-merchant">${t.merchant || '—'}</div>
              <div class="acct-txn-meta">${t.date} · ${cat.label} ${src}</div>
            </div>
            <div class="acct-txn-amount ${isIn ? 'pos' : 'neg'}">${isIn ? '+' : ''}${fmtFull(t.amount)}</div>
          </div>`;
      }).join('')}
      <div style="text-align:center;padding:12px;font-size:12px;color:var(--text-tertiary)"><button class="btn-link" onclick="closeAccountDrawer();showPage('expenses')">View on Expenses page →</button></div>
    </div>`;
}

let _trendAllMonths = [];   // cache so timeframe buttons don't re-fetch
let _trendAccount   = null;

function populateAcctTrend(account, txnsDesc) {
  const panel = document.getElementById('acct-tab-trend');
  if (!panel) return;

  if (!txnsDesc || txnsDesc.length === 0) {
    panel.innerHTML = `<div class="empty-state" style="padding:40px 0"><i class="fa-solid fa-chart-line"></i><p>Not enough data to show a trend yet</p></div>`;
    return;
  }

  // txns arrive newest-first; sort ascending for running balance calc
  const txns = [...txnsDesc].reverse();

  const currentBal  = parseFloat(account.balance) || 0;
  const totalTxnSum = txns.reduce((s, t) => s + parseFloat(t.amount), 0);
  let runningBal    = currentBal - totalTxnSum;

  const byDate = {};
  txns.forEach(t => {
    byDate[t.date] = (byDate[t.date] || 0) + parseFloat(t.amount);
  });

  const dates = Object.keys(byDate).sort();
  const monthData = {};
  dates.forEach(d => {
    runningBal += byDate[d];
    const ym = d.slice(0, 7);
    if (!monthData[ym]) monthData[ym] = { end: runningBal, min: runningBal };
    monthData[ym].end = runningBal;
    monthData[ym].min = Math.min(monthData[ym].min, runningBal);
  });

  _trendAccount   = account;
  _trendAllMonths = Object.keys(monthData).sort().map(ym => ({
    ym,
    end: monthData[ym].end,
    min: monthData[ym].min,
  }));

  console.log('[2a] months computed:', _trendAllMonths.length);
  if (!_trendAllMonths.length) return;
  renderTrendChart(account, _trendAllMonths, 'all');
  const _p = document.getElementById('acct-tab-trend');
  console.log('[2b] panel innerHTML length after render:', _p ? _p.innerHTML.length : 'PANEL NOT FOUND');
}

function renderTrendChart(account, months, activeWindow) {
  const panel = document.getElementById('acct-tab-trend');
  if (!panel) return;

  const endVals = months.map(m => m.end);
  const minVals = months.map(m => m.min);
  const allVals = [...endVals, ...minVals];

  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range  = maxVal - minVal || 1;
  const n      = months.length;
  const isDebt = isDebtAccount(account);
  const lineColor = isDebt ? 'var(--red)' : 'var(--accent)';

  const W = 480, H = 190, PAD = { top: 16, right: 16, bottom: 32, left: 64 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top  - PAD.bottom;

  const xScale = i => PAD.left + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
  const yScale = v => PAD.top  + chartH - ((v - minVal) / range) * chartH;

  // End-of-month line
  const endPts   = months.map((_, i) => `${xScale(i).toFixed(1)},${yScale(endVals[i]).toFixed(1)}`);
  const linePath = `M ${endPts.join(' L ')}`;
  const fillPath = `M ${xScale(0).toFixed(1)},${(PAD.top + chartH).toFixed(1)} L ${endPts.join(' L ')} L ${xScale(n-1).toFixed(1)},${(PAD.top + chartH).toFixed(1)} Z`;

  // Minimum balance dashed line
  const minPts    = months.map((_, i) => `${xScale(i).toFixed(1)},${yScale(minVals[i]).toFixed(1)}`);
  const minPath   = `M ${minPts.join(' L ')}`;

  // Y-axis ticks
  const yTicks = [minVal, minVal + range / 2, maxVal];
  const yTicksHTML = yTicks.map(v => {
    const y = yScale(v);
    return `
      <text x="${(PAD.left - 6)}" y="${y.toFixed(0)}" text-anchor="end" dominant-baseline="middle" font-size="10" fill="var(--text-tertiary)">${fmtShort(v)}</text>
      <line x1="${PAD.left}" y1="${y.toFixed(0)}" x2="${W - PAD.right}" y2="${y.toFixed(0)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,3"/>`;
  }).join('');

  // X-axis labels
  const maxLabels  = Math.min(n, 12);
  const step       = Math.max(1, Math.floor(n / maxLabels));
  const xTicksHTML = months.map((m, i) => {
    if (i % step !== 0 && i !== n - 1) return '';
    const [yr, mo] = m.ym.split('-');
    const label = new Date(+yr, +mo - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return `<text x="${xScale(i).toFixed(0)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-tertiary)">${label}</text>`;
  }).join('');

  const lastX = xScale(n - 1), lastY = yScale(endVals[n - 1]);
  const change = endVals[n - 1] - endVals[0];
  const earliest = new Date(months[0].ym + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const latest   = new Date(months[n-1].ym + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  const WINDOWS = [
    { key: '3',   label: '3M' },
    { key: '6',   label: '6M' },
    { key: '12',  label: '1Y' },
    { key: '24',  label: '2Y' },
    { key: 'all', label: 'All' },
  ];

  panel.innerHTML = `
    <div class="acct-trend-header">
      <div>
        <div class="acct-trend-range">${earliest} – ${latest} · ${n} months</div>
      </div>
      <div class="acct-trend-windows">
        ${WINDOWS.map(w => `
          <button class="acct-trend-win-btn ${activeWindow == w.key ? 'active' : ''}"
            onclick="renderTrendChart(_trendAccount, _trendAllMonths.slice(${w.key === 'all' ? '' : '-' + w.key}), '${w.key}')">
            ${w.label}
          </button>`).join('')}
      </div>
    </div>
    <div class="acct-trend-legend">
      <span class="acct-trend-legend-item"><span class="acct-trend-legend-line solid" style="background:${lineColor}"></span>End of month</span>
      <span class="acct-trend-legend-item"><span class="acct-trend-legend-line dashed" style="border-color:${lineColor}"></span>Monthly low</span>
      <span class="acct-trend-legend-delta ${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '▲' : '▼'} ${fmtFull(Math.abs(change))}</span>
    </div>
    <div class="acct-trend-chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
        <defs>
          <linearGradient id="trendFill${account.id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="${lineColor}" stop-opacity="0.01"/>
          </linearGradient>
        </defs>
        ${yTicksHTML}
        <path d="${fillPath}" fill="url(#trendFill${account.id})"/>
        <path d="${minPath}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-dasharray="4,3" stroke-opacity="0.5" stroke-linejoin="round"/>
        <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" fill="${lineColor}"/>
        ${xTicksHTML}
      </svg>
    </div>
    <div class="acct-trend-months">
      <div class="acct-trend-month-row acct-trend-month-head">
        <span>Month</span><span>End balance</span><span>Low</span><span>Change</span>
      </div>
      ${[...months].reverse().map((m, i, arr) => {
        const origIdx = months.length - 1 - i;
        const [yr, mo] = m.ym.split('-');
        const label = new Date(+yr, +mo - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        const delta = origIdx > 0 ? endVals[origIdx] - endVals[origIdx - 1] : null;
        return `
          <div class="acct-trend-month-row">
            <span class="acct-trend-month-lbl">${label}</span>
            <span class="acct-trend-month-bal">${fmtFull(m.end)}</span>
            <span class="acct-trend-month-low ${m.min < m.end * 0.95 ? 'warn' : ''}">${fmtFull(m.min)}</span>
            ${delta !== null
              ? `<span class="acct-trend-month-delta ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${fmtShort(delta)}</span>`
              : '<span>—</span>'}
          </div>`;
      }).join('')}
    </div>`;
}

function fmtShort(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000000) return sign + '$' + (abs / 1000000).toFixed(1) + 'M';
  if (abs >= 1000)    return sign + '$' + (abs / 1000).toFixed(1) + 'k';
  return sign + '$' + abs.toFixed(0);
}

function closeAccountDrawer() {
  const overlay = document.getElementById('acct-drawer-overlay');
  if (!overlay) return;
  overlay.querySelector('.acct-drawer').classList.remove('open');
  setTimeout(() => overlay.remove(), 250);
}

async function saveAccountEdits(accountId) {
  const name        = document.getElementById('edit-acct-name')?.value.trim();
  const institution = document.getElementById('edit-acct-institution')?.value.trim();
  const type        = document.getElementById('edit-acct-type')?.value;
  const balRaw      = parseFloat(document.getElementById('edit-acct-balance')?.value) || 0;
  const exclude     = document.getElementById('edit-acct-exclude')?.checked ?? false;
  const isDebt      = type === 'credit' || type === 'loan';
  const balance     = isDebt ? -Math.abs(balRaw) : balRaw;

  if (!name) { showQuickToast('Name is required'); return; }

  const { error } = await sb.from('accounts').update({
    name, institution, type, balance,
    exclude_from_net_worth: exclude,
  }).eq('id', accountId).eq('user_id', currentUser.id);

  if (error) { showQuickToast('Save failed: ' + error.message); return; }

  closeAccountDrawer();
  renderDashboard();
  showQuickToast('Account updated');
}

async function renderTrendChart(accounts) {
  const twelveMonthsAgo = offsetYM(currentYM(), -11);
  const { data: history } = await sb.from('balance_history')
    .select('*').eq('user_id', currentUser.id)
    .gte('month', twelveMonthsAgo).order('month');

  const chartCard = document.querySelector('.card.card-padded');
  if (!history || history.length === 0) {
    if (chartCard) chartCard.style.display = 'none'; return;
  }
  if (chartCard) chartCard.style.display = 'block';

  const months = [];
  for (let i = 11; i >= 0; i--) {
    const ym = offsetYM(currentYM(), -i);
    months.push({ ym, label: new Date(ym + '-02').toLocaleDateString('en-US', { month: 'short' }) });
  }

  const COLORS = ['#3d6b22','#7a4f2e','#5c4fa8','#a06b10','#b83c2a','#2d9196'];
  const trackable = accounts.filter(a => ['checking','savings','investment'].includes(a.type));

  const datasets = trackable.map((acct, i) => ({
    label: acct.name,
    data: months.map(({ ym }) => {
      const row = (history || []).find(h => h.account_id === acct.id && h.month === ym);
      return row ? parseFloat(row.balance) : null;
    }),
    borderColor: COLORS[i % COLORS.length],
    backgroundColor: COLORS[i % COLORS.length] + '18',
    borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5,
    tension: 0.35, fill: false, spanGaps: true,
  }));

  document.getElementById('chart-legend').innerHTML = trackable.map((a, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${COLORS[i % COLORS.length]}"></div> ${a.name}
    </div>`).join('');

  const ctx = document.getElementById('trend-chart').getContext('2d');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: { labels: months.map(m => m.label), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fff', borderColor: '#ddd4c0', borderWidth: 1,
          titleColor: '#1e2a14', bodyColor: '#6b5a42', padding: 12,
          callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + fmtFull(ctx.parsed.y) }
        }
      },
      scales: {
        x: { grid: { color: '#ede7dc' }, ticks: { color: '#9e8a70', font: { size: 12 } } },
        y: { grid: { color: '#ede7dc' }, ticks: { color: '#9e8a70', font: { size: 12 }, callback: v => fmt(v) } }
      }
    }
  });
}

/* ============================================================
   BUDGET PAGE
   ============================================================ */
let budgetMonth = currentYM();

function initBudgetPage() {
  budgetMonth = currentYM();
  updateBudgetMonthUI();
}

function updateBudgetMonthUI() {
  document.getElementById('budget-month-label').textContent = monthLabel(budgetMonth);
  document.getElementById('budget-next-month').disabled = budgetMonth >= currentYM();
}

function budgetChangeMonth(delta) {
  budgetMonth = offsetYM(budgetMonth, delta);
  updateBudgetMonthUI();
  renderBudgetPage();
}

async function renderBudgetPage() {
  if (!currentUser) return;
  const content = document.getElementById('budget-content');
  content.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading…</p></div>';

  const [
    { data: budgets },
    { data: incomeGoals },
    { data: transactions },
    { data: userCats }
  ] = await Promise.all([
    sb.from('budgets').select('*').eq('user_id', currentUser.id).eq('month', budgetMonth),
    sb.from('income_goals').select('*').eq('user_id', currentUser.id).eq('month', budgetMonth),
    sb.from('transactions').select('*').eq('user_id', currentUser.id)
      .gte('date', budgetMonth + '-01').lt('date', offsetYM(budgetMonth, 1) + '-01'),
    sb.from('user_categories').select('*').eq('user_id', currentUser.id).order('sort_order'),
  ]);

  // Exclude CC payments and savings/investing transfers — money moving between your
  // own accounts, not real income or spending.
  const EXCLUDE_CATS = new Set(['cc_payment', 'savings_cat']);
  const realTxns = (transactions || []).filter(t => !EXCLUDE_CATS.has(t.category));

  const incomeTxns = realTxns.filter(t => parseFloat(t.amount) > 0);
  const actualIncome = incomeTxns.reduce((s, t) => s + parseFloat(t.amount), 0);

  const incomeGoal = (incomeGoals || []).reduce((s, g) => s + parseFloat(g.goal), 0);

  const spendTxns = realTxns.filter(t => parseFloat(t.amount) < 0);
  const spendByCat = {};
  spendTxns.forEach(t => {
    const cat = t.category || 'other';
    spendByCat[cat] = (spendByCat[cat] || 0) + Math.abs(parseFloat(t.amount));
  });

  const totalSpend = Object.values(spendByCat).reduce((s, v) => s + v, 0);
  const totalGoal  = (budgets || []).reduce((s, b) => s + parseFloat(b.goal), 0);

  const cats = (userCats && userCats.length)
    ? userCats.map(c => c.category_id)
    : Object.keys(CAT_META);

  content.innerHTML = `
    ${renderIncomeSection(incomeGoal, actualIncome)}
    <div class="section grid-3">
      <div class="stat-card">
        <div class="stat-label">Total Budgeted</div>
        <div class="stat-value">${fmtFull(totalGoal)}</div>
        <div class="stat-change neutral">Across all categories</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Spent</div>
        <div class="stat-value" style="color:${totalSpend > totalGoal && totalGoal > 0 ? 'var(--red)' : 'var(--text)'}">${fmtFull(totalSpend)}</div>
        ${totalGoal > 0 ? `<div class="stat-change ${totalSpend > totalGoal ? 'down' : 'up'}">
          ${totalSpend > totalGoal ? '⚠ Over by ' + fmtFull(totalSpend - totalGoal) : '✓ ' + fmtFull(totalGoal - totalSpend) + ' remaining'}
        </div>` : '<div class="stat-change neutral">Set goals to track</div>'}
      </div>
      <div class="stat-card">
        <div class="stat-label">Income Surplus</div>
        <div class="stat-value" style="color:${actualIncome - totalSpend >= 0 ? 'var(--green-pos)' : 'var(--red)'}">
          ${fmtFull(actualIncome - totalSpend)}
        </div>
        <div class="stat-change neutral">Income minus spending</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title"><i class="fa-solid fa-scale-balanced"></i> Spending by Category</div>
      <div class="budget-cat-list">
        ${cats.map(catId => renderBudgetCatRow(catId, budgets || [], spendByCat)).join('')}
      </div>
      <button class="btn-primary" style="margin-top:16px" onclick="saveBudgetGoals()">
        <i class="fa-solid fa-floppy-disk"></i> Save goals
      </button>
    </div>
    <details class="budget-diag-section">
      <summary class="budget-diag-toggle">
        <i class="fa-solid fa-bug"></i> What's being counted?
        <i class="fa-solid fa-chevron-down" style="margin-left:auto;font-size:11px;color:var(--text-tertiary)"></i>
      </summary>
      <div class="budget-diag-body">
        <div class="budget-diag-col">
          <div class="budget-diag-head">Top income transactions</div>
          ${incomeTxns.sort((a,b) => parseFloat(b.amount)-parseFloat(a.amount)).slice(0,8).map(t => `
            <div class="budget-diag-row">
              <span class="budget-diag-date">${t.date}</span>
              <span class="budget-diag-merchant">${t.merchant || '—'}</span>
              <span class="budget-diag-cat">${CAT_META[t.category]?.label || t.category || 'other'}</span>
              <span class="budget-diag-amt income">${fmtFull(parseFloat(t.amount))}</span>
            </div>`).join('')}
        </div>
        <div class="budget-diag-col">
          <div class="budget-diag-head">Top spending transactions</div>
          ${spendTxns.sort((a,b) => parseFloat(a.amount)-parseFloat(b.amount)).slice(0,8).map(t => `
            <div class="budget-diag-row">
              <span class="budget-diag-date">${t.date}</span>
              <span class="budget-diag-merchant">${t.merchant || '—'}</span>
              <span class="budget-diag-cat">${CAT_META[t.category]?.label || t.category || 'other'}</span>
              <span class="budget-diag-amt expense">${fmtFull(Math.abs(parseFloat(t.amount)))}</span>
            </div>`).join('')}
        </div>
        <p class="budget-diag-note">Excluded from calculations: CC Payments, Savings/Investing transfers. To fix miscategorized transactions, go to the <a href="#" onclick="showPage('expenses');return false">Expenses page</a>.</p>
      </div>
    </details>`;
}

function renderIncomeSection(goal, actual) {
  const pct  = goal > 0 ? Math.min((actual / goal) * 100, 100) : 0;
  const over = actual > goal && goal > 0;
  return `
    <div class="section">
      <div class="section-title"><i class="fa-solid fa-money-bill-trend-up"></i> Income</div>
      <div class="card card-padded">
        <div class="budget-income-row">
          <div>
            <div class="stat-label">Expected this month</div>
            <div class="budget-income-input-wrap">
              <span class="budget-currency">$</span>
              <input class="budget-income-input" id="income-goal-input" type="number"
                value="${goal || ''}" placeholder="0.00" min="0" step="100"
                onchange="updateIncomeGoal(this.value)">
              <span class="budget-per-month">/ month</span>
            </div>
          </div>
          <div style="text-align:right">
            <div class="stat-label">Received so far</div>
            <div class="stat-value" style="color:var(--green-pos);margin-top:4px">${fmtFull(actual)}</div>
          </div>
        </div>
        ${goal > 0 ? `
        <div class="budget-bar-wrap">
          <div class="budget-bar">
            <div class="budget-bar-fill ${over ? 'over' : ''}" style="width:${pct}%"></div>
          </div>
          <div class="budget-bar-labels">
            <span>${fmtFull(actual)} received</span>
            <span>${fmtFull(goal)} expected</span>
          </div>
        </div>` : ''}
      </div>
    </div>`;
}

function renderBudgetCatRow(catId, budgets, spendByCat) {
  const meta   = CAT_META[catId] || { label: catId, icon: 'fa-solid fa-tag' };
  const budget = budgets.find(b => b.category === catId);
  const goal   = budget ? parseFloat(budget.goal) : 0;
  const spent  = spendByCat[catId] || 0;
  const pct    = goal > 0 ? Math.min((spent / goal) * 100, 100) : (spent > 0 ? 100 : 0);
  const over   = spent > goal && goal > 0;
  const rem    = goal - spent;

  return `
    <div class="budget-cat-row">
      <div class="budget-cat-header">
        <div class="budget-cat-name"><i class="${meta.icon}"></i> ${meta.label}</div>
        <div class="budget-cat-amounts">
          <span class="budget-spent ${over ? 'over' : ''}">${fmtFull(spent)}</span>
          <span class="budget-divider"> of </span>
          <span class="budget-goal-wrap">
            $<input class="budget-goal-input" type="number"
              value="${goal || ''}" placeholder="—"
              min="0" step="50" data-cat="${catId}"
              title="Monthly goal for ${meta.label}">
          </span>
        </div>
      </div>
      <div class="budget-bar ${!goal && !spent ? 'budget-bar-empty' : ''}">
        <div class="budget-bar-fill ${over ? 'over' : ''}" style="width:${pct}%"></div>
      </div>
      ${goal > 0 || spent > 0 ? `
      <div class="budget-bar-labels">
        <span class="${over ? 'text-red' : 'text-muted'}">${over ? '⚠ Over by ' + fmtFull(Math.abs(rem)) : (goal > 0 ? fmtFull(rem) + ' left' : 'No goal set')}</span>
        <span class="text-muted">${goal > 0 ? Math.round(pct) + '%' : ''}</span>
      </div>` : ''}
    </div>`;
}

async function saveBudgetGoals() {
  if (!currentUser) return;
  const inputs  = document.querySelectorAll('.budget-goal-input[data-cat]');
  const upserts = [];
  inputs.forEach(input => {
    const cat  = input.dataset.cat;
    const goal = parseFloat(input.value) || 0;
    if (goal > 0) upserts.push({ user_id: currentUser.id, month: budgetMonth, category: cat, goal });
  });
  if (upserts.length === 0) return;
  const { error } = await sb.from('budgets').upsert(upserts, { onConflict: 'user_id,month,category' });
  if (!error) renderBudgetPage();
}

async function updateIncomeGoal(value) {
  if (!currentUser) return;
  const goal = parseFloat(value) || 0;
  if (goal <= 0) return;
  await sb.from('income_goals').upsert(
    { user_id: currentUser.id, month: budgetMonth, source: 'Primary', goal },
    { onConflict: 'user_id,month,source' }
  );
}

/* ============================================================
   SECURITY & PRIVACY PAGE
   ============================================================ */
function renderSecurityPage() {
  const page = document.getElementById('page-security');
  if (!page) return;

  page.innerHTML = `
    <div class="page-topbar">
      <div class="page-topbar-left">
        <h1>Security & Privacy</h1>
        <p>How Harvest protects your data and what each service does</p>
      </div>
    </div>
    <div class="page-content">

      <div class="sec-hero">
        <i class="fa-solid fa-shield-halved sec-hero-icon"></i>
        <div>
          <div class="sec-hero-title">Your data stays yours</div>
          <div class="sec-hero-sub">Harvest never sells your data, never stores bank credentials, and never accesses your accounts beyond what you explicitly authorize.</div>
        </div>
      </div>

      <!-- PLAID -->
      <div class="sec-section">
        <div class="sec-section-header">
          <div class="sec-badge sec-badge-plaid"><i class="fa-solid fa-link"></i></div>
          <div>
            <div class="sec-section-title">Plaid — Bank Connections</div>
            <div class="sec-section-sub">plaid.com</div>
          </div>
        </div>
        <div class="sec-cards">
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Read-only access</strong>
              Plaid connects to your bank in read-only mode. It cannot move money, initiate transfers, or make any changes to your accounts.
            </div>
          </div>
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Bank credentials never stored</strong>
              When you log into your bank through Plaid Link, your username and password go directly to your bank. Harvest never sees them.
            </div>
          </div>
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Access token stored server-side only</strong>
              Plaid gives Harvest an opaque access token after you connect. This token is stored in Supabase and only ever read by the server — it is never sent to your browser.
            </div>
          </div>
          <div class="sec-card sec-neutral">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <strong>What Plaid can see</strong>
              Plaid has access to your account balances, transaction history, and account metadata (name, type, last 4 digits). It does not have access to statements, routing numbers, or full account numbers.
            </div>
          </div>
          <div class="sec-card sec-neutral">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <strong>Revoking access</strong>
              You can disconnect any bank at any time. Harvest will delete the access token from Supabase, and Plaid will revoke its connection to that institution.
            </div>
          </div>
        </div>
      </div>

      <!-- SUPABASE -->
      <div class="sec-section">
        <div class="sec-section-header">
          <div class="sec-badge sec-badge-supabase"><i class="fa-solid fa-database"></i></div>
          <div>
            <div class="sec-section-title">Supabase — Database & Auth</div>
            <div class="sec-section-sub">supabase.com · hosted on AWS</div>
          </div>
        </div>
        <div class="sec-cards">
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Row Level Security on every table</strong>
              Every database table has RLS enforced. Queries automatically filter to <code>auth.uid() = user_id</code> — no query can return another user's data, even if someone had your API key.
            </div>
          </div>
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>No passwords stored</strong>
              Authentication uses magic links only. Supabase never stores a password for your account, so there is nothing to leak if their database were ever breached.
            </div>
          </div>
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Encryption at rest and in transit</strong>
              All data is encrypted at rest (AES-256) and in transit (TLS 1.2+). This is managed by Supabase and the underlying AWS infrastructure.
            </div>
          </div>
          <div class="sec-card sec-neutral">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <strong>What Supabase stores</strong>
              Your email address, transaction history, account names and balances, budget goals, and Plaid access tokens (server-side only). No bank credentials, no Social Security numbers, no full account numbers.
            </div>
          </div>
          <div class="sec-card sec-neutral">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <strong>The anon key is intentionally public</strong>
              The Supabase "anon key" embedded in the app's JavaScript is designed to be public. It grants no data access on its own — RLS ensures every request must be authenticated.
            </div>
          </div>
        </div>
      </div>

      <!-- VERCEL -->
      <div class="sec-section">
        <div class="sec-section-header">
          <div class="sec-badge sec-badge-vercel"><i class="fa-solid fa-server"></i></div>
          <div>
            <div class="sec-section-title">Vercel — Hosting & API</div>
            <div class="sec-section-sub">vercel.com · hosted on AWS/Cloudflare</div>
          </div>
        </div>
        <div class="sec-cards">
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Secrets never reach the browser</strong>
              Your Plaid secret and Supabase service role key live in Vercel's encrypted environment variable store. They are only available inside serverless functions — your browser never sees them.
            </div>
          </div>
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>HTTPS enforced</strong>
              All traffic to harvest-budget-app.vercel.app is served over HTTPS with automatic TLS certificates. HTTP requests are redirected automatically.
            </div>
          </div>
          <div class="sec-card sec-neutral">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <strong>Serverless functions are ephemeral</strong>
              The API routes that talk to Plaid and Supabase run in short-lived serverless functions. No data is held in memory between requests.
            </div>
          </div>
        </div>
      </div>

      <!-- AUTH -->
      <div class="sec-section">
        <div class="sec-section-header">
          <div class="sec-badge sec-badge-auth"><i class="fa-solid fa-envelope"></i></div>
          <div>
            <div class="sec-section-title">Authentication — Magic Links</div>
            <div class="sec-section-sub">Powered by Supabase Auth</div>
          </div>
        </div>
        <div class="sec-cards">
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>No password to steal</strong>
              Sign-in is email-only via a one-time link. There is no password that can be phished, reused, or breached.
            </div>
          </div>
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Links expire in 1 hour</strong>
              Magic links are single-use and expire after 60 minutes. A link that has already been clicked cannot be reused.
            </div>
          </div>
          <div class="sec-card sec-good">
            <i class="fa-solid fa-circle-check"></i>
            <div>
              <strong>Session tokens are scoped</strong>
              Your session JWT is stored in browser memory and scoped to this app's origin. It cannot be read by other websites or browser extensions.
            </div>
          </div>
        </div>
      </div>

      <!-- WHAT WE DON'T DO -->
      <div class="sec-section">
        <div class="sec-section-header">
          <div class="sec-badge sec-badge-never"><i class="fa-solid fa-ban"></i></div>
          <div>
            <div class="sec-section-title">What Harvest never does</div>
            <div class="sec-section-sub"></div>
          </div>
        </div>
        <div class="sec-cards">
          ${[
            'Sell or share your financial data with third parties',
            'Store your bank username or password',
            'Move money or initiate any transactions',
            'Access accounts you haven\'t explicitly connected',
            'Store full bank account or routing numbers',
            'Display ads or use your data for targeting',
          ].map(item => `
          <div class="sec-card sec-never">
            <i class="fa-solid fa-xmark"></i>
            <div>${item}</div>
          </div>`).join('')}
        </div>
      </div>

      <div class="sec-footer">
        <i class="fa-solid fa-circle-info"></i>
        Questions about data handling? This app is self-hosted and privately operated — you own the Supabase project and control all data.
      </div>

    </div>`;
}

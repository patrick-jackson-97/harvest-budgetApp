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
  education:     { label: 'Education',           icon: 'fa-solid fa-graduation-cap' },
  savings_cat:   { label: 'Savings / Investing', icon: 'fa-solid fa-seedling' },
  personal:      { label: 'Personal Care',       icon: 'fa-solid fa-spa' },
  kids:          { label: 'Kids / Family',       icon: 'fa-solid fa-baby' },
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

function renderNetWorth(accounts) {
  const total = accounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
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
  const assets      = accounts.filter(a => a.type !== 'credit' && a.type !== 'loan').reduce((s,a) => s + (parseFloat(a.balance)||0), 0);
  const liabilities = accounts.filter(a => a.type === 'credit' || a.type === 'loan').reduce((s,a) => s + Math.abs(parseFloat(a.balance)||0), 0);
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
    const meta   = TYPE_META[a.type] || {};
    const bal    = parseFloat(a.balance) || 0;
    const isDebt = a.type === 'credit' || a.type === 'loan';
    return `
      <div class="account-card">
        <div class="account-card-icon ${meta.iconClass || ''}">
          <i class="${meta.icon || 'fa-solid fa-circle-dollar-to-slot'}"></i>
        </div>
        <div class="account-card-type">${meta.label || a.type}</div>
        <div class="account-card-name">${a.name}</div>
        <div class="account-card-balance ${isDebt ? 'liability' : 'asset'}">${fmtFull(bal)}</div>
      </div>`;
  }).join('');
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
      .gte('date', budgetMonth + '-01').lte('date', budgetMonth + '-31'),
    sb.from('user_categories').select('*').eq('user_id', currentUser.id).order('sort_order'),
  ]);

  const actualIncome = (transactions || [])
    .filter(t => parseFloat(t.amount) > 0)
    .reduce((s, t) => s + parseFloat(t.amount), 0);

  const incomeGoal = (incomeGoals || []).reduce((s, g) => s + parseFloat(g.goal), 0);

  const spendByCat = {};
  (transactions || []).filter(t => parseFloat(t.amount) < 0).forEach(t => {
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
    </div>`;
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

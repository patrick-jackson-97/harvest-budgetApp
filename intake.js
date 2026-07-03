/* ============================================================
   HARVEST — intake.js  (account setup wizard)
   ============================================================ */

'use strict';

/* ── ACCOUNT TYPES ── */
const ACCOUNT_TYPES = [
  { id: 'checking',   label: 'Checking',     icon: 'fa-solid fa-landmark',             iconClass: 'checking'   },
  { id: 'savings',    label: 'Savings',       icon: 'fa-solid fa-piggy-bank',            iconClass: 'savings'    },
  { id: 'credit',     label: 'Credit Card',   icon: 'fa-solid fa-credit-card',           iconClass: 'credit'     },
  { id: 'investment', label: 'Investment',    icon: 'fa-solid fa-chart-line',            iconClass: 'investment' },
  { id: 'loan',       label: 'Loan / Debt',   icon: 'fa-solid fa-hand-holding-dollar',  iconClass: 'loan'       },
];

/* ── SPENDING CATEGORIES ── */
const SPENDING_CATS = [
  { id: 'housing',     label: 'Housing',       icon: 'fa-solid fa-house' },
  { id: 'groceries',   label: 'Groceries',     icon: 'fa-solid fa-basket-shopping' },
  { id: 'dining',      label: 'Dining Out',    icon: 'fa-solid fa-utensils' },
  { id: 'transport',   label: 'Transportation',icon: 'fa-solid fa-car' },
  { id: 'utilities',   label: 'Utilities',     icon: 'fa-solid fa-bolt' },
  { id: 'health',      label: 'Health',        icon: 'fa-solid fa-heart-pulse' },
  { id: 'subscriptions', label: 'Subscriptions', icon: 'fa-solid fa-rotate' },
  { id: 'clothing',    label: 'Clothing',      icon: 'fa-solid fa-shirt' },
  { id: 'entertainment', label: 'Entertainment', icon: 'fa-solid fa-clapperboard' },
  { id: 'travel',      label: 'Travel',        icon: 'fa-solid fa-plane' },
  { id: 'pets',        label: 'Pets',          icon: 'fa-solid fa-paw' },
  { id: 'education',   label: 'Education',     icon: 'fa-solid fa-graduation-cap' },
  { id: 'savings_cat', label: 'Savings / Investing', icon: 'fa-solid fa-seedling' },
  { id: 'personal',    label: 'Personal Care', icon: 'fa-solid fa-spa' },
  { id: 'kids',        label: 'Kids / Family', icon: 'fa-solid fa-baby' },
  // 'other' is always included — not shown as a selectable chip
];

/* ── STATE ── */
let intakeStep     = 0;   // 0=welcome, 1=accounts, 2=categories, 3=summary
let addedAccounts  = [];
let selectedCats   = new Set();
let showingAddForm = false;
let addFormType    = null;

const STEPS = ['welcome', 'accounts', 'categories', 'summary'];

/* ── OPEN / CLOSE ── */
function showIntake() {
  intakeStep    = 0;
  addedAccounts = [];
  selectedCats  = new Set();
  showingAddForm = false;
  addFormType   = null;

  const el = document.getElementById('intake-overlay');
  el.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  renderIntake();
}

function hideIntake() {
  const el = document.getElementById('intake-overlay');
  el.classList.remove('is-open');
  document.body.style.overflow = '';
}

/* ── MAIN RENDER ── */
function renderIntake() {
  const inner = document.getElementById('intake-inner');
  inner.innerHTML = buildIntakeHTML();
}

function buildIntakeHTML() {
  const step = STEPS[intakeStep];
  const progress = (intakeStep / (STEPS.length - 1)) * 100;

  const topbar = `
    <div class="intake-topbar">
      <span class="intake-topbar-title">${stepTitle()}</span>
      <button class="intake-topbar-close" onclick="hideIntake()" title="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="intake-progress">
      <div class="intake-progress-fill" style="width:${progress}%"></div>
    </div>`;

  if (step === 'welcome')    return topbar + buildWelcome();
  if (step === 'accounts')   return topbar + buildAccounts();
  if (step === 'categories') return topbar + buildCategories();
  if (step === 'summary')    return topbar + buildSummary();
  return topbar;
}

function stepTitle() {
  return ['Get started', 'Your accounts', 'Spending categories', 'All set!'][intakeStep] || 'Setup';
}

/* ── STEP DOTS ── */
function buildStepDots() {
  return `<div class="step-indicator">
    ${STEPS.map((_, i) => `<div class="step-dot ${i < intakeStep ? 'complete' : i === intakeStep ? 'active' : ''}"></div>`).join('')}
  </div>`;
}

/* ── STEP 0: WELCOME ── */
function buildWelcome() {
  return `
    <div class="intake-hero">
      <div class="intake-hero-inner">
        <div class="intake-hero-icon">🌾</div>
        <h1>You've worked hard growing your crops.</h1>
        <p>Now let's see what you've brought in. Add your accounts and spending categories — takes about 3 minutes.</p>
      </div>
    </div>
    <div class="intake-body">
      <div class="intake-callout">
        <i class="fa-solid fa-lock"></i>
        <span>Your data stays on your device. We never store account numbers or passwords.</span>
      </div>
      <div class="intake-section-label">What we'll cover</div>
      <div class="summary-group">
        <div class="summary-row"><i class="fa-solid fa-landmark"></i> Add your bank and investment accounts</div>
        <div class="summary-row"><i class="fa-solid fa-tags"></i> Pick the spending categories you use</div>
        <div class="summary-row"><i class="fa-solid fa-chart-line"></i> See your wealth health dashboard</div>
      </div>
      <button class="intake-btn-primary" onclick="intakeNext()">
        Get started <i class="fa-solid fa-arrow-right"></i>
      </button>
      ${buildStepDots()}
    </div>`;
}

/* ── STEP 1: ACCOUNTS ── */
function buildAccounts() {
  const addedHTML = addedAccounts.length ? `
    <div class="added-accounts" id="added-accounts-list">
      ${addedAccounts.map((a, i) => buildAddedRow(a, i)).join('')}
    </div>` : '';

  const typeGrid = !showingAddForm ? `
    <div class="intake-section-label">Add an account</div>
    <div class="account-type-grid">
      ${ACCOUNT_TYPES.map(t => `
        <button class="account-type-chip" onclick="startAddAccount('${t.id}')">
          <i class="${t.icon}"></i> ${t.label}
        </button>`).join('')}
    </div>` : '';

  const form = showingAddForm ? buildAddForm() : '';

  const canContinue = addedAccounts.length > 0;

  return `
    <div class="intake-body">
      <button class="intake-btn-back" onclick="intakeBack()">
        <i class="fa-solid fa-arrow-left"></i> Back
      </button>
      <div class="intake-section-label">${addedAccounts.length ? 'Added accounts' : 'No accounts yet'}</div>
      ${addedHTML}
      ${typeGrid}
      ${form}
      <button class="intake-btn-primary" onclick="intakeNext()" ${canContinue ? '' : 'disabled'}>
        Continue <i class="fa-solid fa-arrow-right"></i>
      </button>
      ${!canContinue ? `<p style="text-align:center;font-size:13px;color:var(--text-tertiary);margin-top:10px;">Add at least one account to continue</p>` : ''}
      ${buildStepDots()}
    </div>`;
}

function buildAddedRow(a, i) {
  const meta = ACCOUNT_TYPES.find(t => t.id === a.type) || {};
  const isDebt = a.type === 'credit' || a.type === 'loan';
  return `
    <div class="added-account-row">
      <div class="added-account-icon ${meta.iconClass || ''}">
        <i class="${meta.icon || 'fa-solid fa-circle-dollar-to-slot'}"></i>
      </div>
      <div class="added-account-info">
        <div class="added-account-name">${a.name}</div>
        <div class="added-account-type">${meta.label || a.type}${a.balance !== '' ? ' · ' + (isDebt ? '-' : '') + '$' + Math.abs(parseFloat(a.balance)||0).toLocaleString() : ''}</div>
      </div>
      <button class="added-account-remove" onclick="removeAccount(${i})" title="Remove">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>`;
}

function buildAddForm() {
  const meta = ACCOUNT_TYPES.find(t => t.id === addFormType) || {};
  return `
    <div class="account-add-form visible" id="account-add-form">
      <div class="form-row">
        <label class="form-label">Account type</label>
        <select class="form-select" id="af-type" onchange="addFormType=this.value">
          ${ACCOUNT_TYPES.map(t => `<option value="${t.id}" ${t.id === addFormType ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label class="form-label">Nickname</label>
          <input class="form-input" id="af-name" type="text" placeholder="e.g. Chase Checking" value="">
        </div>
        <div class="form-row">
          <label class="form-label">Institution</label>
          <input class="form-input" id="af-institution" type="text" placeholder="e.g. Chase" value="">
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">Current balance (optional)</label>
        <input class="form-input" id="af-balance" type="number" placeholder="0.00" step="0.01" value="">
      </div>
      <div style="display:flex;gap:10px;margin-top:4px;">
        <button class="btn-secondary btn-sm" onclick="cancelAddForm()" style="flex:1">Cancel</button>
        <button class="btn-primary btn-sm" onclick="saveAccount()" style="flex:2">
          <i class="fa-solid fa-plus"></i> Add account
        </button>
      </div>
    </div>`;
}

function startAddAccount(typeId) {
  addFormType    = typeId;
  showingAddForm = true;
  renderIntake();
  setTimeout(() => {
    const n = document.getElementById('af-name');
    if (n) n.focus();
  }, 50);
}

function cancelAddForm() {
  showingAddForm = false;
  addFormType    = null;
  renderIntake();
}

function saveAccount() {
  const name        = (document.getElementById('af-name')?.value || '').trim();
  const institution = (document.getElementById('af-institution')?.value || '').trim();
  const balance     = document.getElementById('af-balance')?.value || '';
  const type        = document.getElementById('af-type')?.value || addFormType;

  if (!name) {
    document.getElementById('af-name').style.borderColor = 'var(--red)';
    document.getElementById('af-name').focus();
    return;
  }

  addedAccounts.push({ name, institution, balance, type });
  showingAddForm = false;
  addFormType    = null;
  renderIntake();
}

function removeAccount(i) {
  addedAccounts.splice(i, 1);
  renderIntake();
}

/* ── STEP 2: CATEGORIES ── */
function buildCategories() {
  return `
    <div class="intake-body">
      <button class="intake-btn-back" onclick="intakeBack()">
        <i class="fa-solid fa-arrow-left"></i> Back
      </button>
      <div class="intake-section-label">Which categories do you spend in?</div>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:18px;line-height:1.5">
        Select all that apply — you can always adjust these later.
      </p>
      <div class="category-grid" id="cat-grid">
        ${SPENDING_CATS.map(c => `
          <button class="category-chip ${selectedCats.has(c.id) ? 'selected' : ''}"
                  onclick="toggleCat('${c.id}', this)">
            <i class="${c.icon}"></i> ${c.label}
          </button>`).join('')}
      </div>
      <button class="intake-btn-primary" onclick="intakeNext()">
        Continue <i class="fa-solid fa-arrow-right"></i>
      </button>
      ${buildStepDots()}
    </div>`;
}

function toggleCat(id, btn) {
  if (selectedCats.has(id)) {
    selectedCats.delete(id);
    btn.classList.remove('selected');
  } else {
    selectedCats.add(id);
    btn.classList.add('selected');
  }
}

/* ── STEP 3: SUMMARY ── */
function buildSummary() {
  const accountRows = addedAccounts.map(a => {
    const meta = ACCOUNT_TYPES.find(t => t.id === a.type) || {};
    return `<div class="summary-row"><i class="${meta.icon || 'fa-solid fa-circle'}"></i> ${a.name} <span style="margin-left:auto;color:var(--text-tertiary);font-size:13px">${meta.label||a.type}</span></div>`;
  }).join('');

  const catRows = [...selectedCats].map(id => {
    const c = SPENDING_CATS.find(x => x.id === id);
    return c ? `<div class="summary-row"><i class="${c.icon}"></i> ${c.label}</div>` : '';
  }).join('');

  return `
    <div class="intake-hero">
      <div class="intake-hero-inner">
        <div class="intake-hero-icon"><i class="fa-solid fa-check"></i></div>
        <h1>You're all set!</h1>
        <p>Here's what we've got. You can update these anytime from the sidebar.</p>
      </div>
    </div>
    <div class="intake-body">
      <div class="intake-section-label">Accounts added (${addedAccounts.length})</div>
      <div class="summary-group">
        ${accountRows || '<div class="summary-row" style="color:var(--text-tertiary)">No accounts added</div>'}
      </div>

      ${selectedCats.size ? `
      <div class="intake-section-label">Spending categories (${selectedCats.size})</div>
      <div class="summary-group">${catRows}</div>` : ''}

      <button class="intake-btn-primary" onclick="finishIntake()">
        Go to dashboard <i class="fa-solid fa-seedling"></i>
      </button>
      <button class="intake-btn-back" onclick="intakeBack()" style="justify-content:center;margin-top:12px">
        <i class="fa-solid fa-arrow-left"></i> Go back and edit
      </button>
      ${buildStepDots()}
    </div>`;
}

/* ── NAVIGATION ── */
function intakeNext() {
  if (intakeStep < STEPS.length - 1) {
    intakeStep++;
    renderIntake();
    document.getElementById('intake-inner').scrollTop = 0;
  }
}

function intakeBack() {
  if (showingAddForm) {
    cancelAddForm();
    return;
  }
  if (intakeStep > 0) {
    intakeStep--;
    renderIntake();
  }
}

async function finishIntake() {
  // 'other' is always a category
  selectedCats.add('other');

  if (!currentUser) { hideIntake(); return; }

  // Show saving state
  const btn = document.querySelector('#intake-inner .intake-btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…'; }

  // Save accounts
  if (addedAccounts.length > 0) {
    const rows = addedAccounts.map(a => ({
      user_id:     currentUser.id,
      name:        a.name,
      type:        a.type,
      institution: a.institution || null,
      balance:     parseFloat(a.balance) || 0,
    }));
    const { error } = await sb.from('accounts').insert(rows);
    if (error) { console.error('Error saving accounts:', error); }
  }

  // Save user categories
  if (selectedCats.size > 0) {
    const catRows = [...selectedCats].map((id, i) => {
      const meta = (typeof CAT_META !== 'undefined' && CAT_META[id]) || { label: id, icon: 'fa-solid fa-tag' };
      return { user_id: currentUser.id, category_id: id, label: meta.label, icon: meta.icon, sort_order: i };
    });
    // Upsert so re-running intake doesn't error on duplicates
    await sb.from('user_categories').upsert(catRows, { onConflict: 'user_id,category_id' });
  }

  hideIntake();
  showPage('dashboard');
  renderDashboard();
}

/* ============================================================
   HARVEST — plaid.js
   Client-side Plaid Link integration
   ============================================================ */

'use strict';

/* ── CONNECT: open Plaid Link ── */
async function initPlaidLink() {
  if (!currentUser) return;

  const btn = document.getElementById('plaid-connect-btn');
  setPlaidBtnLoading(btn, true);
  clearPlaidStatus();

  try {
    const res = await fetch('/api/plaid/create-link-token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user_id: currentUser.id }),
    });
    const { link_token, error } = await res.json();
    if (error) throw new Error(error);

    const handler = Plaid.create({
      token: link_token,

      onSuccess: async (public_token, metadata) => {
        await handlePlaidSuccess(public_token, metadata);
      },

      onExit: (err) => {
        if (err) console.error('Plaid Link exited with error:', err);
        setPlaidBtnLoading(btn, false);
      },
    });

    handler.open();
    // Button re-enables after Link closes (onExit or onSuccess)
  } catch (e) {
    console.error('Plaid init error:', e);
    setPlaidBtnLoading(btn, false);
    showPlaidStatus('error', 'Could not open Plaid: ' + e.message);
  }
}

/* ── AFTER LINK SUCCESS ── */
async function handlePlaidSuccess(public_token, metadata) {
  const btn = document.getElementById('plaid-connect-btn');

  showPlaidStatus('loading', 'Linking your account…');

  try {
    // Exchange public_token server-side (keeps access_token off the browser)
    const exchangeRes = await fetch('/api/plaid/exchange-token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        public_token,
        user_id:          currentUser.id,
        institution_name: metadata.institution?.name || '',
        institution_id:   metadata.institution?.institution_id || '',
      }),
    });
    const exchangeData = await exchangeRes.json();
    if (!exchangeData.success) throw new Error(exchangeData.error);

    showPlaidStatus('loading', 'Syncing transactions…');

    // Pull transactions
    const syncRes = await fetch('/api/plaid/sync', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user_id: currentUser.id }),
    });
    const syncData = await syncRes.json();

    setPlaidBtnLoading(btn, false);
    showPlaidStatus('success',
      `<strong>${metadata.institution?.name || 'Account'} connected!</strong> ` +
      `${exchangeData.accounts_created} account${exchangeData.accounts_created !== 1 ? 's' : ''} added · ` +
      `${syncData.added || 0} transactions imported.`
    );

    // Refresh the connected accounts list and dashboard
    renderPlaidConnections();
    renderDashboard();

  } catch (e) {
    console.error('Plaid success handler error:', e);
    setPlaidBtnLoading(btn, false);
    showPlaidStatus('error', 'Error connecting account: ' + e.message);
  }
}

/* ── SYNC: refresh transactions for all connected items ── */
async function syncPlaidNow() {
  if (!currentUser) return;
  const btn = document.getElementById('plaid-sync-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing…'; }

  try {
    const res = await fetch('/api/plaid/sync', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user_id: currentUser.id }),
    });
    const data = await res.json();

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync now'; }
    showQuickToast(`Synced: ${data.added || 0} new transaction${data.added !== 1 ? 's' : ''}`);
    if ((data.added || 0) > 0 && document.getElementById('page-expenses')?.classList.contains('active')) {
      renderExpensesPage();
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync now'; }
    showQuickToast('Sync failed — check console');
  }
}

/* ── RENDER CONNECTED ACCOUNTS LIST ── */
async function renderPlaidConnections() {
  const el = document.getElementById('plaid-connections');
  if (!el || !currentUser) return;

  // We can't query plaid_items from the client (no RLS), so we rely on accounts table
  const { data: accounts } = await sb
    .from('accounts')
    .select('id,name,type,institution,balance,plaid_account_id')
    .eq('user_id', currentUser.id)
    .not('plaid_account_id', 'is', null)
    .order('institution');

  if (!accounts || accounts.length === 0) {
    el.innerHTML = '<p class="plaid-no-connections">No connected accounts yet.</p>';
    return;
  }

  // Group by institution
  const byInst = {};
  accounts.forEach(a => {
    const key = a.institution || 'Unknown';
    if (!byInst[key]) byInst[key] = [];
    byInst[key].push(a);
  });

  el.innerHTML = Object.entries(byInst).map(([inst, accts]) => `
    <div class="plaid-institution">
      <div class="plaid-inst-name"><i class="fa-solid fa-landmark"></i> ${inst}</div>
      ${accts.map(a => `
        <div class="plaid-account-row">
          <span class="plaid-account-name">${a.name}</span>
          <span class="plaid-account-balance">${fmtFull(a.balance)}</span>
        </div>`).join('')}
    </div>`).join('');
}

/* ── HELPERS ── */
function setPlaidBtnLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<i class="fa-solid fa-spinner fa-spin"></i> Connecting…'
    : '<i class="fa-solid fa-link"></i> Connect a bank account';
}

function clearPlaidStatus() {
  const el = document.getElementById('plaid-status');
  if (el) el.innerHTML = '';
}

function showPlaidStatus(type, html) {
  const el = document.getElementById('plaid-status');
  if (!el) return;
  const icons = { loading: 'fa-spinner fa-spin', success: 'fa-circle-check', error: 'fa-triangle-exclamation' };
  el.innerHTML = `
    <div class="plaid-status-msg plaid-status-${type}">
      <i class="fa-solid ${icons[type] || ''}"></i>
      <span>${html}</span>
    </div>`;
}

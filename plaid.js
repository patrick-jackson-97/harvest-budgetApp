/* ============================================================
   HARVEST — plaid.js
   Client-side Plaid Link integration
   ============================================================ */

'use strict';

const EDGE_BASE = 'https://gvdbwnkhksdvauopjfnf.supabase.co/functions/v1';

async function edgeFetch(path, body) {
  const { data: { session } } = await sb.auth.getSession();
  return fetch(`${EDGE_BASE}/${path}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(body),
  });
}

/* ── CONNECT: open Plaid Link ── */
async function initPlaidLink() {
  if (!currentUser) return;

  const btn = document.getElementById('plaid-connect-btn');
  setPlaidBtnLoading(btn, true);
  clearPlaidStatus();

  try {
    const res = await edgeFetch('plaid-create-link-token', {});
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
    const exchangeRes = await edgeFetch('plaid-exchange-token', {
      public_token,
      institution_name: metadata.institution?.name || '',
      institution_id:   metadata.institution?.institution_id || '',
    });
    const exchangeData = await exchangeRes.json();
    if (!exchangeData.success) throw new Error(exchangeData.error);

    setPlaidBtnLoading(btn, false);
    clearPlaidStatus();

    // Show account mapping modal before syncing
    await showAccountMappingModal(exchangeData.plaid_accounts || [], metadata.institution?.name);

  } catch (e) {
    console.error('Plaid success handler error:', e);
    setPlaidBtnLoading(btn, false);
    showPlaidStatus('error', 'Error connecting account: ' + e.message);
  }
}

/* ── ACCOUNT MAPPING MODAL ── */
async function showAccountMappingModal(plaidAccounts, institutionName) {
  // Fetch existing user accounts
  const { data: existingAccounts } = await sb
    .from('accounts')
    .select('id, name, type, institution')
    .eq('user_id', currentUser.id)
    .order('name');

  // Build modal HTML
  const modal = document.createElement('div');
  modal.id = 'plaid-map-modal';
  modal.className = 'plaid-map-overlay';
  modal.innerHTML = `
    <div class="plaid-map-box">
      <div class="plaid-map-header">
        <div class="plaid-map-title"><i class="fa-solid fa-link"></i> Match your accounts</div>
        <div class="plaid-map-sub">We found ${plaidAccounts.length} account${plaidAccounts.length !== 1 ? 's' : ''} at <strong>${institutionName || 'your bank'}</strong>.
        Link each one to an existing account or add it as new.</div>
      </div>
      <div class="plaid-map-rows">
        ${plaidAccounts.map((a, i) => `
          <div class="plaid-map-row">
            <div class="plaid-map-plaid-acct">
              <div class="plaid-map-acct-name">${a.name}</div>
              <div class="plaid-map-acct-meta">${a.type} · ${fmtFull(a.balance)}</div>
            </div>
            <i class="fa-solid fa-arrow-right plaid-map-arrow"></i>
            <select class="form-select plaid-map-select" data-plaid-idx="${i}">
              <option value="new">+ Add as new account</option>
              ${(existingAccounts || []).map(e =>
                `<option value="${e.id}">${e.name} (${e.type})</option>`
              ).join('')}
              <option value="skip">Skip / ignore</option>
            </select>
          </div>`).join('')}
      </div>
      <div class="plaid-map-footer">
        <button class="btn-primary" onclick="confirmAccountMapping()">
          <i class="fa-solid fa-check"></i> Confirm & sync transactions
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  window._plaidAccountsToMap = plaidAccounts;
}

async function confirmAccountMapping() {
  const modal = document.getElementById('plaid-map-modal');
  const selects = modal.querySelectorAll('.plaid-map-select');
  const plaidAccounts = window._plaidAccountsToMap || [];

  const mappings = Array.from(selects).map((sel, i) => {
    const val = sel.value;
    const a = plaidAccounts[i];
    if (val === 'new') {
      return { ...a, action: 'new' };
    } else if (val === 'skip') {
      return { ...a, action: 'skip' };
    } else {
      return { ...a, action: 'link', existing_account_id: val };
    }
  });

  // Show loading state
  modal.querySelector('.btn-primary').disabled = true;
  modal.querySelector('.btn-primary').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

  try {
    await edgeFetch('plaid-save-accounts', { mappings });

    // Now sync transactions
    modal.querySelector('.btn-primary').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing transactions…';
    const syncRes = await edgeFetch('plaid-sync', {});
    const syncData = await syncRes.json();

    modal.remove();
    showPlaidStatus('success',
      `<strong>Connected!</strong> ${syncData.added || 0} transactions imported.`
    );

    renderPlaidConnections().then(() => {
      const syncRow = document.getElementById('plaid-sync-row');
      if (syncRow) syncRow.style.display = 'flex';
    });
    renderDashboard();
    if (typeof renderExpensesPage === 'function') renderExpensesPage();

  } catch (e) {
    console.error('Account mapping error:', e);
    modal.querySelector('.btn-primary').disabled = false;
    modal.querySelector('.btn-primary').innerHTML = '<i class="fa-solid fa-check"></i> Confirm & sync transactions';
    showQuickToast('Error saving accounts: ' + e.message);
  }
}

/* ── SYNC: refresh transactions for all connected items ── */
async function syncPlaidNow() {
  if (!currentUser) return;
  const btn = document.getElementById('plaid-sync-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing…'; }

  try {
    const res = await edgeFetch('plaid-sync', {});
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

  // Fetch connected items (via edge function — plaid_items has no client RLS)
  const itemsRes = await edgeFetch('plaid-list-items', {});
  const { items } = await itemsRes.json();

  if (!items || items.length === 0) {
    el.innerHTML = '<p class="plaid-no-connections">No connected accounts yet.</p>';
    return;
  }

  // Fetch linked accounts from DB
  const { data: accounts } = await sb
    .from('accounts')
    .select('id,name,type,institution,balance,plaid_account_id')
    .eq('user_id', currentUser.id)
    .not('plaid_account_id', 'is', null);

  const acctsByInst = {};
  (accounts || []).forEach(a => {
    const key = a.institution || 'Unknown';
    if (!acctsByInst[key]) acctsByInst[key] = [];
    acctsByInst[key].push(a);
  });

  el.innerHTML = items.map(item => {
    const inst = item.institution_name || 'Unknown';
    const linked = acctsByInst[inst] || [];
    const lastSync = item.last_synced_at
      ? new Date(item.last_synced_at).toLocaleDateString()
      : 'Never';
    return `
    <div class="plaid-institution">
      <div class="plaid-inst-header">
        <div class="plaid-inst-name"><i class="fa-solid fa-landmark"></i> ${inst}</div>
        <button class="btn-ghost btn-xs" onclick="remapPlaidItem('${item.item_id}', '${inst}')">
          <i class="fa-solid fa-arrows-rotate"></i> Re-map accounts
        </button>
      </div>
      ${linked.length > 0
        ? linked.map(a => `
          <div class="plaid-account-row">
            <span class="plaid-account-name">${a.name}</span>
            <span class="plaid-account-balance">${fmtFull(a.balance)}</span>
            <button class="btn-ghost btn-xs plaid-delete-btn"
              onclick="deletePlaidAccount('${a.id}', '${a.name.replace(/'/g,"\\'")}')">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>`).join('')
        : `<p class="plaid-no-connections" style="margin:4px 0 0 0;font-size:0.82rem">
             No accounts mapped yet — click Re-map accounts.
           </p>`
      }
      <div class="plaid-inst-footer">Last synced: ${lastSync}</div>
    </div>`;
  }).join('');
}

/* ── DELETE a connected account and its Plaid transactions ── */
async function deletePlaidAccount(accountId, accountName) {
  if (!confirm(`Delete "${accountName}" and all its imported transactions? This cannot be undone.`)) return;

  try {
    // Delete transactions for this account
    await sb.from('transactions').delete()
      .eq('user_id', currentUser.id)
      .eq('account_id', accountId)
      .not('plaid_transaction_id', 'is', null);

    // Delete the account row
    await sb.from('accounts').delete()
      .eq('id', accountId)
      .eq('user_id', currentUser.id);

    showQuickToast(`Deleted ${accountName}`);
    renderPlaidConnections();
    renderDashboard();
  } catch (e) {
    showQuickToast('Delete failed: ' + e.message);
  }
}

/* ── RE-MAP: fetch accounts for an existing item and show mapping modal ── */
async function remapPlaidItem(itemId, institutionName) {
  showPlaidStatus('loading', `Loading ${institutionName} accounts…`);
  try {
    const res = await edgeFetch('plaid-get-accounts', { item_id: itemId });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    clearPlaidStatus();
    await showAccountMappingModal(data.plaid_accounts, institutionName);
  } catch (e) {
    showPlaidStatus('error', 'Could not load accounts: ' + e.message);
  }
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

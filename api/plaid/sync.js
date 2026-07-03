// HARVEST — /api/plaid/sync
// Syncs transactions for all of a user's connected Plaid items
// Uses Plaid's transactions/sync endpoint with cursor for incremental updates

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const plaidEnv = process.env.PLAID_ENV || 'sandbox';

  try {
    // 1. Get all Plaid items for this user
    const itemsRes = await sbGet(`plaid_items?user_id=eq.${user_id}&select=*`);
    const items = await itemsRes.json();
    if (!Array.isArray(items) || items.length === 0) {
      return res.json({ success: true, added: 0, message: 'No connected accounts' });
    }

    // 2. Get internal accounts so we can map plaid_account_id → our UUID
    const acctRes = await sbGet(`accounts?user_id=eq.${user_id}&select=id,plaid_account_id`);
    const accounts = await acctRes.json();
    const acctMap = {};
    (accounts || []).forEach(a => { if (a.plaid_account_id) acctMap[a.plaid_account_id] = a.id; });

    let totalAdded = 0;

    for (const item of items) {
      let cursor  = item.sync_cursor || undefined;
      let allAdded = [];
      let hasMore  = true;

      // Paginate through all changes since last cursor
      while (hasMore) {
        const body = {
          client_id:    process.env.PLAID_CLIENT_ID,
          secret:       process.env.PLAID_SECRET,
          access_token: item.access_token,
          options:      { include_personal_finance_category: true },
        };
        if (cursor) body.cursor = cursor;

        const syncRes = await fetch(`https://${plaidEnv}.plaid.com/transactions/sync`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });
        const syncData = await syncRes.json();

        if (syncData.error_code) {
          console.error(`Plaid sync error for item ${item.item_id}:`, syncData);
          break;
        }

        allAdded = allAdded.concat(syncData.added || []);
        hasMore  = syncData.has_more;
        cursor   = syncData.next_cursor;
      }

      if (allAdded.length > 0) {
        const rows = allAdded.map(t => ({
          user_id,
          account_id:           acctMap[t.account_id] || null,
          date:                 t.date,
          merchant:             t.merchant_name || t.name,
          amount:               -t.amount,   // Plaid: positive = money out; we use negative = expense
          type:                 t.amount > 0 ? 'debit' : 'credit',
          raw_category:         t.personal_finance_category?.primary
                                  ?.replace(/_/g, ' ').toLowerCase() || null,
          category:             'other',
          plaid_transaction_id: t.transaction_id,
        }));

        // Insert in chunks of 500, ignore duplicates (plaid_transaction_id unique index)
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/transactions`, {
            method:  'POST',
            headers: {
              'Content-Type':  'application/json',
              'apikey':        process.env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
              'Prefer':        'resolution=ignore-duplicates,return=minimal',
            },
            body: JSON.stringify(rows.slice(i, i + CHUNK)),
          });
        }

        totalAdded += rows.length;
      }

      // Always update cursor + last_synced_at, even if nothing new
      if (cursor) {
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/plaid_items?id=eq.${item.id}`, {
          method:  'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        process.env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify({
            sync_cursor:    cursor,
            last_synced_at: new Date().toISOString(),
          }),
        });
      }
    }

    res.json({ success: true, added: totalAdded });
  } catch (e) {
    console.error('sync error:', e);
    res.status(500).json({ error: e.message });
  }
};

function sbGet(path) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });
}

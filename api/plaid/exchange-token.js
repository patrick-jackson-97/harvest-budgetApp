// HARVEST — /api/plaid/exchange-token
// Exchanges Plaid public_token for access_token (server-side only)
// Stores the access_token in Supabase via service role key — never sent to browser

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { public_token, user_id, institution_name, institution_id } = req.body || {};
  if (!public_token || !user_id) {
    return res.status(400).json({ error: 'public_token and user_id required' });
  }

  const plaidEnv = process.env.PLAID_ENV || 'sandbox';

  try {
    // 1. Exchange public_token for access_token
    const exchangeRes = await fetch(`https://${plaidEnv}.plaid.com/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    process.env.PLAID_CLIENT_ID,
        secret:       process.env.PLAID_SECRET,
        public_token,
      }),
    });
    const exchangeData = await exchangeRes.json();
    if (exchangeData.error_code) {
      console.error('Plaid exchange error:', exchangeData);
      return res.status(400).json({ error: exchangeData.error_message });
    }
    const { access_token, item_id } = exchangeData;

    // 2. Store item in Supabase (service role — bypasses RLS, access_token never leaves server)
    await sbFetch('POST', 'plaid_items', {
      user_id, item_id, access_token, institution_name, institution_id,
    });

    // 3. Fetch Plaid accounts and upsert into our accounts table
    const acctRes = await fetch(`https://${plaidEnv}.plaid.com/accounts/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    process.env.PLAID_CLIENT_ID,
        secret:       process.env.PLAID_SECRET,
        access_token,
      }),
    });
    const { accounts } = await acctRes.json();

    const accountRows = (accounts || []).map(a => ({
      user_id,
      name:             a.official_name || a.name,
      type:             mapPlaidType(a.type, a.subtype),
      institution:      institution_name || null,
      balance:          a.balances.current ?? 0,
      plaid_account_id: a.account_id,
    }));

    if (accountRows.length > 0) {
      // Upsert: update balance if account already exists
      await sbFetch('POST', 'accounts', accountRows, {
        'Prefer': 'resolution=merge-duplicates,return=minimal',
        'on_conflict': 'plaid_account_id',
      });
    }

    res.json({ success: true, item_id, accounts_created: accountRows.length });
  } catch (e) {
    console.error('exchange-token error:', e);
    res.status(500).json({ error: e.message });
  }
};

function mapPlaidType(type, subtype) {
  if (type === 'credit')     return 'credit';
  if (type === 'investment') return 'investment';
  if (type === 'loan')       return 'loan';
  if (subtype === 'savings') return 'savings';
  return 'checking';
}

async function sbFetch(method, table, body, extra = {}) {
  const { on_conflict, ...extraHeaders } = extra;
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}${on_conflict ? `?on_conflict=${on_conflict}` : ''}`;
  return fetch(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Prefer':        'return=minimal',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

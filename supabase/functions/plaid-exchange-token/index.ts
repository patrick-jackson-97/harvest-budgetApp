// HARVEST — plaid-exchange-token (Supabase Edge Function)
// Exchanges public_token for access_token, stores it, creates accounts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  'https://harvest-budget-app.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // Verify user JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    // Admin client for plaid_items (bypasses RLS — access_token never leaves server)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { public_token, institution_name, institution_id } = await req.json();
    if (!public_token) return json({ error: 'public_token required' }, 400);

    // Exchange public_token for access_token
    const exchangeRes = await fetch('https://api.plaid.com/item/public_token/exchange', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('PLAID_CLIENT_ID'),
        secret:    Deno.env.get('PLAID_SECRET'),
        public_token,
      }),
    });
    const exchangeData = await exchangeRes.json();
    if (exchangeData.error_code) return json({ error: exchangeData.error_message }, 400);

    const { access_token, item_id } = exchangeData;

    // Store item (server-side only, no user RLS on plaid_items)
    await admin.from('plaid_items').upsert(
      { user_id: user.id, item_id, access_token, institution_name, institution_id },
      { onConflict: 'item_id' }
    );

    // Fetch Plaid accounts and upsert into our accounts table
    const acctRes = await fetch('https://api.plaid.com/accounts/get', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    Deno.env.get('PLAID_CLIENT_ID'),
        secret:       Deno.env.get('PLAID_SECRET'),
        access_token,
      }),
    });
    const { accounts } = await acctRes.json();

    const accountRows = (accounts || []).map((a: any) => ({
      user_id:          user.id,
      name:             a.official_name || a.name,
      type:             mapPlaidType(a.type, a.subtype),
      institution:      institution_name || null,
      balance:          a.balances.current ?? 0,
      plaid_account_id: a.account_id,
    }));

    if (accountRows.length > 0) {
      await admin.from('accounts').upsert(accountRows, { onConflict: 'plaid_account_id' });
    }

    return json({ success: true, item_id, accounts_created: accountRows.length });
  } catch (e) {
    console.error('plaid-exchange-token error:', e);
    return json({ error: e.message }, 500);
  }
});

function mapPlaidType(type: string, subtype: string) {
  if (type === 'credit')     return 'credit';
  if (type === 'investment') return 'investment';
  if (type === 'loan')       return 'loan';
  if (subtype === 'savings') return 'savings';
  return 'checking';
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// HARVEST — plaid-exchange-token (Supabase Edge Function)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  'https://harvest-budget-app.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const plaidUrl = (path: string) =>
  `https://${Deno.env.get('PLAID_ENV') === 'production' ? 'production' : 'sandbox'}.plaid.com${path}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { public_token, institution_name, institution_id } = await req.json();
    if (!public_token) return json({ error: 'public_token required' }, 400);

    const exchangeRes = await fetch(plaidUrl('/item/public_token/exchange'), {
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

    await admin.from('plaid_items').upsert(
      { user_id: user.id, item_id, access_token, institution_name, institution_id },
      { onConflict: 'item_id' }
    );

    const acctRes = await fetch(plaidUrl('/accounts/get'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    Deno.env.get('PLAID_CLIENT_ID'),
        secret:       Deno.env.get('PLAID_SECRET'),
        access_token,
      }),
    });
    const { accounts } = await acctRes.json();

    // Return Plaid accounts to the client for mapping — don't save yet
    const plaidAccounts = (accounts || []).map((a: any) => ({
      plaid_account_id: a.account_id,
      name:             a.official_name || a.name,
      type:             mapPlaidType(a.type, a.subtype),
      balance:          a.balances.current ?? 0,
      institution:      institution_name || null,
    }));

    return json({ success: true, item_id, plaid_accounts: plaidAccounts });
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

// HARVEST — plaid-create-link-token (Supabase Edge Function)

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

    const plaidRes = await fetch(plaidUrl('/link/token/create'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     Deno.env.get('PLAID_CLIENT_ID'),
        secret:        Deno.env.get('PLAID_SECRET'),
        user:          { client_user_id: user.id },
        client_name:   'Harvest',
        products:      ['transactions'],
        country_codes: ['US'],
        language:      'en',
        redirect_uri:  'https://harvest-budget-app.vercel.app',
      }),
    });

    const data = await plaidRes.json();
    if (data.error_code) return json({ error: data.error_message }, 400);

    return json({ link_token: data.link_token });
  } catch (e) {
    console.error('plaid-create-link-token error:', e);
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

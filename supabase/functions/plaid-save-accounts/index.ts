// HARVEST — plaid-save-accounts (Supabase Edge Function)
// Saves the user's account mapping decisions after Plaid connection:
// - "link" an existing account to a Plaid account (updates plaid_account_id + balance)
// - "new" creates a fresh account row

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  'https://harvest-budget-app.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // mappings: array of { plaid_account_id, name, type, balance, institution, action: 'link'|'new', existing_account_id? }
    const { mappings } = await req.json();
    if (!Array.isArray(mappings)) return json({ error: 'mappings array required' }, 400);

    for (const m of mappings) {
      if (m.action === 'link' && m.existing_account_id) {
        // Update existing account with Plaid account ID + refresh balance
        await sb.from('accounts').update({
          plaid_account_id: m.plaid_account_id,
          balance:          m.balance,
          institution:      m.institution || null,
        }).eq('id', m.existing_account_id).eq('user_id', user.id);

      } else if (m.action === 'new') {
        // Insert new account row
        await sb.from('accounts').upsert({
          user_id:          user.id,
          name:             m.name,
          type:             m.type,
          institution:      m.institution || null,
          balance:          m.balance,
          plaid_account_id: m.plaid_account_id,
        }, { onConflict: 'plaid_account_id' });
      }
      // action === 'skip': do nothing
    }

    return json({ success: true });
  } catch (e) {
    console.error('plaid-save-accounts error:', e);
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

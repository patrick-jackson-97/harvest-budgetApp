// HARVEST — plaid-save-accounts (Supabase Edge Function)
// Saves the user's account mapping decisions after Plaid connection:
// - "link" an existing account to a Plaid account (updates plaid_account_id + balance)
// - "new" creates a fresh account row
// Also patches any transactions that were synced before mapping was confirmed,
// and resets sync cursor so next sync re-fetches with correct account_id.

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

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // mappings: array of { plaid_account_id, name, type, balance, institution, action: 'link'|'new'|'skip', existing_account_id? }
    const { mappings } = await req.json();
    if (!Array.isArray(mappings)) return json({ error: 'mappings array required' }, 400);

    for (const m of mappings) {
      let internalId: string | null = null;

      if (m.action === 'link' && m.existing_account_id) {
        // Update existing account with Plaid account ID + refresh balance
        await sb.from('accounts').update({
          plaid_account_id: m.plaid_account_id,
          balance:          m.balance,
          institution:      m.institution || null,
        }).eq('id', m.existing_account_id).eq('user_id', user.id);

        internalId = m.existing_account_id;

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

        // Look up the ID we just upserted
        const { data: found } = await sb
          .from('accounts')
          .select('id')
          .eq('plaid_account_id', m.plaid_account_id)
          .eq('user_id', user.id)
          .single();
        internalId = found?.id || null;
      }
      // action === 'skip': do nothing, internalId stays null

      // Patch any transactions that were synced before mapping (account_id = null)
      // They carry raw_plaid_account_id so we can match them to the right internal account.
      if (internalId && m.plaid_account_id) {
        await admin.from('transactions')
          .update({ account_id: internalId })
          .eq('user_id', user.id)
          .is('account_id', null)
          .eq('raw_plaid_account_id', m.plaid_account_id);
      }
    }

    // Reset sync cursor so next plaid-sync re-fetches all transactions
    // and assigns them to now-mapped accounts (ignoreDuplicates means no duplicates).
    await admin.from('plaid_items')
      .update({ sync_cursor: null })
      .eq('user_id', user.id);

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

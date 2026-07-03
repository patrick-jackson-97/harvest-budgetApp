// HARVEST — plaid-sync (Supabase Edge Function)
// Syncs transactions for all connected Plaid items using cursor-based pagination

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

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get all Plaid items for this user
    const { data: items } = await admin
      .from('plaid_items')
      .select('*')
      .eq('user_id', user.id);

    if (!items || items.length === 0) {
      return json({ success: true, added: 0, message: 'No connected accounts' });
    }

    // Get internal accounts for plaid_account_id → UUID mapping
    const { data: accounts } = await admin
      .from('accounts')
      .select('id, plaid_account_id')
      .eq('user_id', user.id);

    const acctMap: Record<string, string> = {};
    (accounts || []).forEach((a: any) => {
      if (a.plaid_account_id) acctMap[a.plaid_account_id] = a.id;
    });

    let totalAdded = 0;

    for (const item of items) {
      let cursor: string | undefined = item.sync_cursor || undefined;
      let allAdded: any[] = [];
      let hasMore = true;

      while (hasMore) {
        const body: any = {
          client_id:    Deno.env.get('PLAID_CLIENT_ID'),
          secret:       Deno.env.get('PLAID_SECRET'),
          access_token: item.access_token,
          options:      { include_personal_finance_category: true },
        };
        if (cursor) body.cursor = cursor;

        const syncRes = await fetch('https://api.plaid.com/transactions/sync', {
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
        const rows = allAdded.map((t: any) => ({
          user_id:              user.id,
          account_id:           acctMap[t.account_id] || null,
          date:                 t.date,
          merchant:             t.merchant_name || t.name,
          amount:               -t.amount,
          type:                 t.amount > 0 ? 'debit' : 'credit',
          raw_category:         t.personal_finance_category?.primary
                                  ?.replace(/_/g, ' ').toLowerCase() || null,
          category:             'other',
          plaid_transaction_id: t.transaction_id,
        }));

        // Insert in chunks of 500, ignore duplicates
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          await admin.from('transactions').upsert(
            rows.slice(i, i + CHUNK),
            { onConflict: 'plaid_transaction_id', ignoreDuplicates: true }
          );
        }

        totalAdded += rows.length;
      }

      // Update cursor
      if (cursor) {
        await admin.from('plaid_items').update({
          sync_cursor:    cursor,
          last_synced_at: new Date().toISOString(),
        }).eq('id', item.id);
      }
    }

    return json({ success: true, added: totalAdded });
  } catch (e) {
    console.error('plaid-sync error:', e);
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// HARVEST — plaid-remove-item (Supabase Edge Function)
// Removes a Plaid connection (item) for the current user.

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

    const { item_id } = await req.json();
    if (!item_id) return json({ error: 'item_id required' }, 400);

    // Verify item belongs to this user
    const { data: item } = await admin
      .from('plaid_items')
      .select('id')
      .eq('item_id', item_id)
      .eq('user_id', user.id)
      .single();

    if (!item) return json({ error: 'Item not found' }, 404);

    await admin.from('plaid_items').delete().eq('id', item.id);

    return json({ success: true });
  } catch (e) {
    console.error('plaid-remove-item error:', e);
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

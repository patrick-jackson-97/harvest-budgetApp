// HARVEST — /api/plaid/create-link-token
// Creates a Plaid Link token for the frontend to initialize Link UI

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const plaidEnv = process.env.PLAID_ENV || 'sandbox';

  try {
    const r = await fetch(`https://${plaidEnv}.plaid.com/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     process.env.PLAID_CLIENT_ID,
        secret:        process.env.PLAID_SECRET,
        user:          { client_user_id: user_id },
        client_name:   'Harvest',
        products:      ['transactions'],
        country_codes: ['US'],
        language:      'en',
      }),
    });

    const data = await r.json();
    if (data.error_code) {
      console.error('Plaid error:', data);
      return res.status(400).json({ error: data.error_message });
    }

    res.json({ link_token: data.link_token });
  } catch (e) {
    console.error('create-link-token error:', e);
    res.status(500).json({ error: e.message });
  }
};

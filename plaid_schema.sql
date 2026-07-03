-- ============================================================
-- HARVEST — plaid_schema.sql
-- Run in Supabase → SQL Editor
-- ============================================================

-- Add Plaid account ID to accounts table (for mapping Plaid accounts → internal accounts)
alter table accounts add column if not exists plaid_account_id text;
create unique index if not exists accounts_plaid_account_id_idx
  on accounts(plaid_account_id) where plaid_account_id is not null;

-- Add Plaid transaction ID to transactions table (for dedup on re-sync)
alter table transactions add column if not exists plaid_transaction_id text;
create unique index if not exists transactions_plaid_txn_id_idx
  on transactions(plaid_transaction_id) where plaid_transaction_id is not null;

-- Plaid items: one row per connected bank login
-- Access tokens are sensitive — NO user-facing RLS policy.
-- Only accessible server-side via service role key.
create table if not exists plaid_items (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  item_id          text not null unique,
  access_token     text not null,
  institution_name text,
  institution_id   text,
  sync_cursor      text,
  last_synced_at   timestamptz,
  created_at       timestamptz default now()
);
alter table plaid_items enable row level security;
-- Intentionally no SELECT/INSERT/UPDATE policy — only service role can touch this table

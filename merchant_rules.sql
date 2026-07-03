-- ============================================================
-- HARVEST — merchant_rules.sql
-- Remembers how the user has categorized each merchant
-- Run in Supabase → SQL Editor
-- ============================================================

create table if not exists merchant_rules (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  merchant    text not null,   -- normalized merchant name (trimmed, lowercased)
  category    text not null,
  created_at  timestamptz default now(),
  unique (user_id, merchant)
);

alter table merchant_rules enable row level security;
create policy "merchant_rules: user owns rows" on merchant_rules
  for all using (auth.uid() = user_id);

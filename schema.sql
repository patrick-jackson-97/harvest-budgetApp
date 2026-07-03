-- ============================================================
-- HARVEST — schema.sql
-- Run this in Supabase → SQL Editor
-- ============================================================

-- ── ENABLE UUID EXTENSION ──
create extension if not exists "uuid-ossp";

-- ── ACCOUNTS ──
create table if not exists accounts (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  name          text not null,
  type          text not null check (type in ('checking','savings','credit','investment','loan')),
  institution   text,
  balance       numeric(12,2) default 0,
  created_at    timestamptz default now()
);

alter table accounts enable row level security;
create policy "accounts: user owns rows" on accounts
  for all using (auth.uid() = user_id);

-- ── TRANSACTIONS ──
create table if not exists transactions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  account_id      uuid references accounts(id) on delete cascade,
  date            date not null,
  merchant        text,
  amount          numeric(12,2) not null,  -- negative = expense, positive = income
  type            text check (type in ('debit','credit')),
  category        text default 'other',
  raw_category    text,
  notes           text,
  created_at      timestamptz default now()
);

alter table transactions enable row level security;
create policy "transactions: user owns rows" on transactions
  for all using (auth.uid() = user_id);

-- ── BUDGETS ──
-- One row per category per month per user
create table if not exists budgets (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  month         text not null,  -- format: 'YYYY-MM'
  category      text not null,
  goal          numeric(12,2) not null default 0,
  created_at    timestamptz default now(),
  unique (user_id, month, category)
);

alter table budgets enable row level security;
create policy "budgets: user owns rows" on budgets
  for all using (auth.uid() = user_id);

-- ── INCOME GOALS ──
-- Expected monthly income (separate from transactions)
create table if not exists income_goals (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  month         text not null,  -- format: 'YYYY-MM'
  source        text not null default 'Primary',
  goal          numeric(12,2) not null default 0,
  created_at    timestamptz default now(),
  unique (user_id, month, source)
);

alter table income_goals enable row level security;
create policy "income_goals: user owns rows" on income_goals
  for all using (auth.uid() = user_id);

-- ── USER CATEGORIES ──
-- The categories a user has selected / created
create table if not exists user_categories (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  category_id   text not null,
  label         text not null,
  icon          text,
  sort_order    int default 0,
  created_at    timestamptz default now(),
  unique (user_id, category_id)
);

alter table user_categories enable row level security;
create policy "user_categories: user owns rows" on user_categories
  for all using (auth.uid() = user_id);

-- ── ACCOUNT BALANCE HISTORY ──
-- Monthly snapshots for the trend chart
create table if not exists balance_history (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  account_id    uuid references accounts(id) on delete cascade not null,
  month         text not null,  -- format: 'YYYY-MM'
  balance       numeric(12,2) not null,
  created_at    timestamptz default now(),
  unique (account_id, month)
);

alter table balance_history enable row level security;
create policy "balance_history: user owns rows" on balance_history
  for all using (auth.uid() = user_id);

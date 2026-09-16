-- =====================================================================
-- Family Smart Dashboard — Supabase schema
-- =====================================================================
-- Run this once in your Supabase project's SQL editor (Database > SQL
-- Editor > New query > paste this whole file > Run).
--
-- Design:
--   * One row in `families` per household.
--   * `profiles` extends auth.users 1:1 (id = auth.users.id) and carries
--     role ('parent' | 'child'), so the SAME login system serves both apps
--     — the Parent App and Kids App just show different UI for the role.
--   * Parents get full read/write on everything in their family via RLS.
--   * Children get READ-ONLY access to everything via RLS, and can only
--     change data through SECURITY DEFINER functions (RPCs) below, which
--     enforce exactly what a child is allowed to do (complete their own
--     task, request a reward, log their own Qur'an reading) — they can
--     never touch points, task point values, the catalog, or approvals.
-- =====================================================================

-- ---------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------

create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our Family',
  theme text not null default 'light',
  temp_unit text not null default 'C',
  prayer_times jsonb not null default '{"fajr":"05:30","dhuhr":"13:00","asr":"16:30","maghrib":"19:15","isha":"20:45"}',
  task_points jsonb not null default '{"fajr":5,"dhuhr":5,"asr":5,"maghrib":5,"isha":5,"quran":10}',
  family_goal jsonb not null default '{"rewardOptions":[{"title":"Fishing Trip","icon":"🎣"},{"title":"Family Picnic","icon":"🏝️"},{"title":"Family Dinner","icon":"🍕"},{"title":"Family Movie Night","icon":"🎬"}],"selectedIndex":0}',
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  role text not null check (role in ('parent','child')),
  name text not null,
  subtitle text default '',
  color text default '#8B8F98',
  emoji text default '🙂',
  points int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_profiles_family on profiles(family_id);

create table if not exists task_catalog (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  key text not null,
  category text not null check (category in ('FAITH','LEARNING','RESPONSIBILITY','ACTIVITIES')),
  name text not null,
  icon text default '⭐',
  points int not null default 5,
  needs_approval boolean not null default false,
  family_required boolean not null default false,
  weekdays int[] not null default '{0,1,2,3,4,5,6}',
  child_ids uuid[],
  active boolean not null default true,
  unique(family_id, key)
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  catalog_key text,
  category text not null check (category in ('FAITH','LEARNING','RESPONSIBILITY','ACTIVITIES')),
  name text not null,
  icon text default '⭐',
  date date not null,
  points int not null default 5,
  done boolean not null default false,
  needs_approval boolean not null default false,
  approval_status text not null default 'none' check (approval_status in ('none','pending','approved','rejected')),
  family_required boolean not null default false,
  notes text default '',
  pages_read int default 0,
  minutes_spent int default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, catalog_key, date)
);
create index if not exists idx_tasks_family_date on tasks(family_id, date);
create index if not exists idx_tasks_owner_date on tasks(owner_id, date);

create table if not exists rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  title text not null,
  icon text default '🎁',
  cost int not null,
  requires_approval boolean not null default false,
  active boolean not null default true
);

create table if not exists redemptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  reward_id uuid references rewards(id),
  reward_title text not null,
  icon text default '🎁',
  cost int not null,
  requires_approval boolean not null default false,
  status text not null default 'pending' check (status in ('pending','fulfilled','denied')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists idx_redemptions_family on redemptions(family_id);

create table if not exists quran_goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  child_id uuid not null references profiles(id) on delete cascade,
  target_pages int not null default 3,
  target_minutes int not null default 15,
  unique(child_id)
);

create table if not exists school_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  day int not null check (day between 0 and 6),
  start_time text not null,
  end_time text,
  subject text not null,
  teacher text default '',
  room text default ''
);

create table if not exists homework (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  subject text default '',
  due_date date,
  done boolean not null default false
);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  owner_id uuid, -- a profile id, or NULL for the whole family
  type text not null check (type in ('exam','event','holiday')),
  title text not null,
  date date not null,
  notes text default ''
);

-- ---------------------------------------------------------------------
-- HELPER FUNCTIONS — read the caller's own family/role without
-- re-triggering RLS recursion (SECURITY DEFINER + stable).
-- ---------------------------------------------------------------------
create or replace function current_family_id() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from profiles where id = auth.uid();
$$;

create or replace function current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_role_name() = 'parent', false);
$$;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Everyone (parent or child) can SELECT everything within their own
-- family. Only parents get direct write access. Children write nothing
-- directly — they act only through the RPC functions further below.
-- ---------------------------------------------------------------------
alter table families enable row level security;
alter table profiles enable row level security;
alter table task_catalog enable row level security;
alter table tasks enable row level security;
alter table rewards enable row level security;
alter table redemptions enable row level security;
alter table quran_goals enable row level security;
alter table school_events enable row level security;
alter table homework enable row level security;
alter table calendar_events enable row level security;

create policy "read own family" on families for select using (id = current_family_id());
create policy "parent update family" on families for update using (is_parent() and id = current_family_id());

create policy "read family profiles" on profiles for select using (family_id = current_family_id());
create policy "parent insert profiles" on profiles for insert with check (is_parent() and family_id = current_family_id());
create policy "parent update profiles" on profiles for update using (is_parent() and family_id = current_family_id());
create policy "parent delete profiles" on profiles for delete using (is_parent() and family_id = current_family_id());
-- A child may only ever insert/see their own row via the signup flow;
-- profile creation itself happens through the setup RPC below.

create policy "read family catalog" on task_catalog for select using (family_id = current_family_id());
create policy "parent write catalog" on task_catalog for insert with check (is_parent() and family_id = current_family_id());
create policy "parent update catalog" on task_catalog for update using (is_parent() and family_id = current_family_id());
create policy "parent delete catalog" on task_catalog for delete using (is_parent() and family_id = current_family_id());

create policy "read family tasks" on tasks for select using (family_id = current_family_id());
create policy "parent write tasks" on tasks for insert with check (is_parent() and family_id = current_family_id());
create policy "parent update tasks" on tasks for update using (is_parent() and family_id = current_family_id());
create policy "parent delete tasks" on tasks for delete using (is_parent() and family_id = current_family_id());

create policy "read family rewards" on rewards for select using (family_id = current_family_id());
create policy "parent write rewards" on rewards for insert with check (is_parent() and family_id = current_family_id());
create policy "parent update rewards" on rewards for update using (is_parent() and family_id = current_family_id());
create policy "parent delete rewards" on rewards for delete using (is_parent() and family_id = current_family_id());

create policy "read family redemptions" on redemptions for select using (family_id = current_family_id());
create policy "parent write redemptions" on redemptions for insert with check (is_parent() and family_id = current_family_id());
create policy "parent update redemptions" on redemptions for update using (is_parent() and family_id = current_family_id());
create policy "parent delete redemptions" on redemptions for delete using (is_parent() and family_id = current_family_id());

create policy "read family quran goals" on quran_goals for select using (family_id = current_family_id());
create policy "parent write quran goals" on quran_goals for insert with check (is_parent() and family_id = current_family_id());
create policy "parent update quran goals" on quran_goals for update using (is_parent() and family_id = current_family_id());
create policy "parent delete quran goals" on quran_goals for delete using (is_parent() and family_id = current_family_id());

create policy "read family school events" on school_events for select using (family_id = current_family_id());
create policy "parent write school events" on school_events for insert with check (is_parent() and family_id = current_family_id());
create policy "parent update school events" on school_events for update using (is_parent() and family_id = current_family_id());
create policy "parent delete school events" on school_events for delete using (is_parent() and family_id = current_family_id());

create policy "read family homework" on homework for select using (family_id = current_family_id());
create policy "parent write homework" on homework for insert with check (is_parent() and family_id = current_family_id());
create policy "parent update homework" on homework for update using (is_parent() and family_id = current_family_id());
create policy "parent delete homework" on homework for delete using (is_parent() and family_id = current_family_id());

create policy "read family calendar" on calendar_events for select using (family_id = current_family_id());
create policy "parent write calendar" on calendar_events for insert with check (is_parent() and family_id = current_family_id());
create policy "parent update calendar" on calendar_events for update using (is_parent() and family_id = current_family_id());
create policy "parent delete calendar" on calendar_events for delete using (is_parent() and family_id = current_family_id());

-- Indexes on the remaining foreign keys the app filters/joins on
-- (id_profiles_family, idx_tasks_family_date, idx_tasks_owner_date and
-- idx_redemptions_family are declared earlier, alongside their tables).
create index if not exists idx_calendar_events_family on calendar_events(family_id);
create index if not exists idx_homework_family on homework(family_id);
create index if not exists idx_homework_owner on homework(owner_id);
create index if not exists idx_quran_goals_family on quran_goals(family_id);
create index if not exists idx_redemptions_owner on redemptions(owner_id);
create index if not exists idx_redemptions_reward on redemptions(reward_id);
create index if not exists idx_rewards_family on rewards(family_id);
create index if not exists idx_school_events_family on school_events(family_id);
create index if not exists idx_school_events_owner on school_events(owner_id);

-- ---------------------------------------------------------------------
-- RPC FUNCTIONS — the ONLY way a child account can change data.
-- Each one is SECURITY DEFINER (runs with elevated rights) but starts
-- by checking auth.uid() ownership, so a child can never act on anyone
-- else's row or touch a value they shouldn't.
-- ---------------------------------------------------------------------

-- A child (or parent) marks their own task done/undone. Tasks that
-- need approval flip to 'pending' instead of awarding points — only
-- decide_task_approval() (parent-only) can award those points.
create or replace function complete_task(p_task_id uuid, p_mark boolean)
returns tasks language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task_id and family_id = current_family_id();
  if t is null then raise exception 'Task not found'; end if;
  if not is_parent() and t.owner_id <> auth.uid() then
    raise exception 'You can only complete your own tasks';
  end if;

  if p_mark then
    if t.needs_approval then
      update tasks set done = true, approval_status = 'pending' where id = p_task_id returning * into t;
    else
      update tasks set done = true, approval_status = 'none' where id = p_task_id returning * into t;
      update profiles set points = points + t.points where id = t.owner_id;
    end if;
  else
    if t.done and (not t.needs_approval or t.approval_status = 'approved') then
      update profiles set points = greatest(0, points - t.points) where id = t.owner_id;
    end if;
    update tasks set done = false, approval_status = 'none' where id = p_task_id returning * into t;
  end if;
  return t;
end;
$$;
grant execute on function complete_task(uuid, boolean) to authenticated;

-- Parent approves or rejects a pending task; only this function can
-- award points for a needs_approval task.
create or replace function decide_task_approval(p_task_id uuid, p_approve boolean)
returns tasks language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  if not is_parent() then raise exception 'Parents only'; end if;
  select * into t from tasks where id = p_task_id and family_id = current_family_id();
  if t is null then raise exception 'Task not found'; end if;

  if p_approve then
    update tasks set approval_status = 'approved' where id = p_task_id returning * into t;
    update profiles set points = points + t.points where id = t.owner_id;
  else
    update tasks set approval_status = 'rejected', done = false where id = p_task_id returning * into t;
  end if;
  return t;
end;
$$;
grant execute on function decide_task_approval(uuid, boolean) to authenticated;

-- Child logs their own Qur'an reading for today (creates the row if the
-- daily generator hasn't run yet) and marks it done once pages > 0.
create or replace function log_quran_reading(p_date date, p_pages int, p_minutes int, p_notes text)
returns tasks language plpgsql security definer set search_path = public as $$
declare t tasks; me profiles; fam families; was_done boolean;
begin
  select * into me from profiles where id = auth.uid();
  select * into fam from families where id = me.family_id;
  select * into t from tasks where owner_id = auth.uid() and catalog_key = 'quran' and date = p_date;

  if t is null then
    insert into tasks(family_id, owner_id, catalog_key, category, name, icon, date, points, done, needs_approval, approval_status, family_required, notes, pages_read, minutes_spent)
    values (me.family_id, me.id, 'quran', 'FAITH', 'Quran reading', '📖', p_date,
            coalesce((fam.task_points->>'quran')::int, 10), false, false, 'none', true, p_notes, p_pages, p_minutes)
    returning * into t;
  end if;

  was_done := t.done;
  update tasks set pages_read = p_pages, minutes_spent = p_minutes, notes = p_notes, done = (p_pages > 0)
  where id = t.id returning * into t;

  if t.done and not was_done then
    update profiles set points = points + t.points where id = t.owner_id;
  elsif not t.done and was_done then
    update profiles set points = greatest(0, points - t.points) where id = t.owner_id;
  end if;
  return t;
end;
$$;
grant execute on function log_quran_reading(date, int, int, text) to authenticated;

-- Child requests a reward. Cheap, no-approval rewards are fulfilled
-- immediately (points deducted now); rewards that require approval sit
-- as 'pending' until a parent calls decide_redemption().
create or replace function request_reward(p_reward_id uuid)
returns redemptions language plpgsql security definer set search_path = public as $$
declare r rewards; me profiles; red redemptions;
begin
  select * into me from profiles where id = auth.uid();
  select * into r from rewards where id = p_reward_id and family_id = me.family_id and active = true;
  if r is null then raise exception 'Reward not found'; end if;
  if me.points < r.cost then raise exception 'Not enough points'; end if;

  if r.requires_approval then
    insert into redemptions(family_id, owner_id, reward_id, reward_title, icon, cost, requires_approval, status)
    values (me.family_id, me.id, r.id, r.title, r.icon, r.cost, true, 'pending')
    returning * into red;
  else
    update profiles set points = points - r.cost where id = me.id;
    insert into redemptions(family_id, owner_id, reward_id, reward_title, icon, cost, requires_approval, status, decided_at)
    values (me.family_id, me.id, r.id, r.title, r.icon, r.cost, false, 'fulfilled', now())
    returning * into red;
  end if;
  return red;
end;
$$;
grant execute on function request_reward(uuid) to authenticated;

-- Parent approves or denies a pending reward request.
create or replace function decide_redemption(p_redemption_id uuid, p_approve boolean)
returns redemptions language plpgsql security definer set search_path = public as $$
declare red redemptions; child profiles;
begin
  if not is_parent() then raise exception 'Parents only'; end if;
  select * into red from redemptions where id = p_redemption_id and family_id = current_family_id();
  if red is null then raise exception 'Request not found'; end if;
  if red.status <> 'pending' then raise exception 'Already decided'; end if;

  select * into child from profiles where id = red.owner_id;
  if p_approve then
    if child.points < red.cost then raise exception 'Child no longer has enough points'; end if;
    update profiles set points = points - red.cost where id = child.id;
    update redemptions set status = 'fulfilled', decided_at = now() where id = p_redemption_id returning * into red;
  else
    update redemptions set status = 'denied', decided_at = now() where id = p_redemption_id returning * into red;
  end if;
  return red;
end;
$$;
grant execute on function decide_redemption(uuid, boolean) to authenticated;

-- Generates today's recurring tasks for one child from the family's
-- task_catalog, if they don't already exist. Safe to call from either
-- app on load — it no-ops once today's rows exist.
create or replace function ensure_today_tasks(p_child_id uuid)
returns setof tasks language plpgsql security definer set search_path = public as $$
declare fam_id uuid; today date := current_date; dow int := extract(dow from current_date)::int; c record;
begin
  select family_id into fam_id from profiles where id = p_child_id;
  if fam_id is null then return; end if;
  if not is_parent() and auth.uid() <> p_child_id then
    raise exception 'Not allowed';
  end if;

  for c in
    select * from task_catalog
    where family_id = fam_id and active = true
      and dow = any(weekdays)
      and (child_ids is null or array_length(child_ids,1) is null or p_child_id = any(child_ids))
  loop
    insert into tasks(family_id, owner_id, catalog_key, category, name, icon, date, points, needs_approval, family_required)
    values (fam_id, p_child_id, c.key, c.category, c.name, c.icon, today, c.points, c.needs_approval, c.family_required)
    on conflict (owner_id, catalog_key, date) do nothing;
  end loop;

  return query select * from tasks where owner_id = p_child_id and date = today;
end;
$$;
grant execute on function ensure_today_tasks(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- FAMILY SETUP — called once from the Parent App's onboarding screen
-- after Ahmed/Haneefa sign up (Supabase Auth). Creates the family row,
-- the two parent profiles, and seeds a starter task catalog + rewards.
-- Children's logins are created separately (see README) with
-- supabase.auth.signUp(), then their profile row via add_child_profile().
-- ---------------------------------------------------------------------
create or replace function setup_family(p_family_name text, p_parent_name text, p_parent_subtitle text, p_color text, p_emoji text)
returns families language plpgsql security definer set search_path = public as $$
declare fam families; existing uuid;
begin
  select family_id into existing from profiles where id = auth.uid();
  if existing is not null then raise exception 'This account already belongs to a family'; end if;

  insert into families(name) values (p_family_name) returning * into fam;
  insert into profiles(id, family_id, role, name, subtitle, color, emoji, points)
  values (auth.uid(), fam.id, 'parent', p_parent_name, p_parent_subtitle, p_color, p_emoji, 0);

  -- starter reward shop
  insert into rewards(family_id, title, icon, cost, requires_approval) values
    (fam.id, '30 min screen time', '🎮', 30, false),
    (fam.id, 'Favorite food for dinner', '🍕', 50, false),
    (fam.id, 'Football activity trip', '⚽', 60, false),
    (fam.id, '3D printed toy / model', '🖨️', 200, true),
    (fam.id, 'Special outing', '🎡', 250, true),
    (fam.id, 'Fishing trip', '🎣', 300, true),
    (fam.id, 'Family picnic', '🧺', 220, true);

  -- starter task catalog (Faith daily; others on sensible weekdays)
  insert into task_catalog(family_id, key, category, name, icon, points, needs_approval, family_required, weekdays) values
    (fam.id, 'fajr', 'FAITH', 'Fajr prayer', '🌅', 5, false, true, '{0,1,2,3,4,5,6}'),
    (fam.id, 'dhuhr', 'FAITH', 'Dhuhr prayer', '☀️', 5, false, true, '{0,1,2,3,4,5,6}'),
    (fam.id, 'asr', 'FAITH', 'Asr prayer', '🌤️', 5, false, true, '{0,1,2,3,4,5,6}'),
    (fam.id, 'maghrib', 'FAITH', 'Maghrib prayer', '🌇', 5, false, true, '{0,1,2,3,4,5,6}'),
    (fam.id, 'isha', 'FAITH', 'Isha prayer', '🌙', 5, false, true, '{0,1,2,3,4,5,6}'),
    (fam.id, 'quran', 'FAITH', 'Quran reading', '📖', 10, false, true, '{0,1,2,3,4,5,6}'),
    (fam.id, 'homework', 'LEARNING', 'Homework', '📝', 15, true, true, '{1,2,3,4,5}'),
    (fam.id, 'reading', 'LEARNING', 'Reading', '📚', 10, false, false, '{0,1,2,3,4,5,6}'),
    (fam.id, 'schoolprep', 'LEARNING', 'School preparation', '🎒', 5, false, false, '{0,1,2,3,4}'),
    (fam.id, 'bedroom', 'RESPONSIBILITY', 'Clean bedroom', '🛏️', 10, true, true, '{3,6}'),
    (fam.id, 'toys', 'RESPONSIBILITY', 'Put toys away', '🧸', 5, false, false, '{0,1,2,3,4,5,6}'),
    (fam.id, 'helpparents', 'RESPONSIBILITY', 'Help parents', '🤝', 10, true, true, '{0,2,4}'),
    (fam.id, 'bag', 'RESPONSIBILITY', 'Prepare school bag', '🎒', 5, false, false, '{0,1,2,3,4}'),
    (fam.id, 'organize', 'RESPONSIBILITY', 'Keep personal items organized', '🗂️', 5, false, false, '{1,3,5}'),
    (fam.id, 'football', 'ACTIVITIES', 'Football', '⚽', 10, false, false, '{2,6}'),
    (fam.id, 'exercise', 'ACTIVITIES', 'Exercise', '🏃', 10, false, false, '{1,3,5}'),
    (fam.id, 'outdoor', 'ACTIVITIES', 'Outdoor activity', '🌳', 10, false, false, '{0}'),
    (fam.id, 'familyactivity', 'ACTIVITIES', 'Family activity', '👨‍👩‍👧‍👦', 15, false, false, '{6}'),
    (fam.id, 'fishing', 'ACTIVITIES', 'Fishing', '🎣', 15, false, false, '{0}');

  return fam;
end;
$$;
grant execute on function setup_family(text, text, text, text, text) to authenticated;

-- A signed-in parent adds another parent OR a child to the family. For a
-- child, call this right after the child's own auth.signUp() completes
-- (the child's uid is passed in — see README for the exact client flow).
create or replace function add_family_member(p_new_user_id uuid, p_role text, p_name text, p_subtitle text, p_color text, p_emoji text)
returns profiles language plpgsql security definer set search_path = public as $$
declare fam_id uuid; prof profiles;
begin
  if not is_parent() then raise exception 'Parents only'; end if;
  if p_role not in ('parent','child') then raise exception 'Invalid role'; end if;
  fam_id := current_family_id();

  insert into profiles(id, family_id, role, name, subtitle, color, emoji, points)
  values (p_new_user_id, fam_id, p_role, p_name, p_subtitle, p_color, p_emoji, 0)
  on conflict (id) do update set name = excluded.name, subtitle = excluded.subtitle, color = excluded.color, emoji = excluded.emoji
  returning * into prof;

  if p_role = 'child' then
    insert into quran_goals(family_id, child_id, target_pages, target_minutes)
    values (fam_id, p_new_user_id, 3, 15)
    on conflict (child_id) do nothing;
  end if;
  return prof;
end;
$$;
grant execute on function add_family_member(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- REALTIME — let both apps subscribe to live changes so the Kids App
-- updates the moment a parent approves something, and vice versa.
-- Wrapped so re-running this file doesn't error if already added.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table profiles;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table tasks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table redemptions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table rewards;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table families;
  exception when duplicate_object then null;
  end;
end $$;

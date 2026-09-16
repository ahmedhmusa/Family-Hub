# Family Hub — Parent App + Kids App (Supabase edition)

Two separate apps sharing one Supabase backend, so they stay in sync:

- **`parent-app/`** — Ahmed & Haneefa sign in with email + password. Full control: create/edit/delete tasks and rewards, approve completions and reward requests, set prayer times & points, Qur'an goals, the school timetable, and special events/holidays. Nothing here is editable from the Kids App.
- **`kids-app/`** — Adhaa and Aleef pick their avatar, enter a short PIN, and get a bright, tap-friendly view of *their own* day: tasks to complete, prayers & Qur'an (deliberately calmer styling), today's classes, and a rewards shop. They can complete tasks and request rewards — they can never edit points, the catalog, or approve anything.
- **`supabase/schema.sql`** — the whole backend: tables, row-level security, and the database functions that enforce all of the above server-side (not just in the app's UI).

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Once it's ready, open **SQL Editor → New query**, paste the entire contents of `supabase/schema.sql`, and run it. This creates every table, security policy, and function.
3. Go to **Authentication → Providers → Email** and, for a smooth family setup, turn **off** "Confirm email" (so accounts are usable immediately after sign-up). You can turn it back on later if you'd like.
4. Go to **Project Settings → API** and copy the **Project URL** and **anon public key** — you'll paste these into both apps.

## 1a. Host both apps on GitHub Pages (free, static, no server needed)

Since both apps are plain HTML/CSS/JS that talk directly to Supabase, GitHub Pages is a perfect fit — one repo, one Pages site, both apps live at their own sub-path.

1. Create a new repository on GitHub (e.g. `family-hub`), public or private — Pages works with either on a Pro/Team/Enterprise account; on a free personal account it needs to be **public**.
2. Push this project to it:
   ```bash
   cd supabase-app
   git init
   git add .
   git commit -m "Family Hub — Parent + Kids apps"
   git branch -M main
   git remote add origin https://github.com/<your-username>/family-hub.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages** → under "Build and deployment", set **Source: Deploy from a branch**, **Branch: `main` / `root`** → Save.
4. After a minute or two, your apps are live at:
   - Parent App: `https://<your-username>.github.io/family-hub/parent-app/`
   - Kids App: `https://<your-username>.github.io/family-hub/kids-app/`
5. In your Supabase project, go to **Authentication → URL Configuration** and add both URLs above to **Redirect URLs** (and set one as the **Site URL**). This matters if you ever turn email confirmation back on, since confirmation links redirect to whatever's allow-listed there.

That's it — no build step, no server to run or pay for. Push a change to `main` and Pages redeploys automatically within a minute.

## 2. Open the Parent App

Open `parent-app/index.html` locally, or visit your GitHub Pages URL from step 1a above — either works the same way.

1. **Connect to Supabase** — paste the Project URL and anon key.
2. **Set up your family** — Ahmed signs up first with his own email/password; this creates the family and seeds a starter task catalog and reward shop.
3. Go to **Family → + Add child login** to create Adhaa's and Aleef's logins. Pick a simple login email for each (e.g. `adhaa@yourfamily.com`) and a PIN of at least 6 digits — this PIN is what they'll type on the tablet running the Kids App.
4. To add Haneefa as a second parent: she can sign up the same way Ahmed did on her own device, but `setup_family` only runs for the *first* parent. For now, add her from the **Family** page the same way as a child but with role `parent` — the `add_family_member` database function already supports this; a "+ Add parent" button can be wired to it the same way "+ Add child login" is, if you'd like that in the UI (see the code in `parent-app/js/app.js`, `openAddChildModal`, as a template).
5. Use **Routine** to set prayer times/points, Qur'an goals, the weekly timetable, and any exams/holidays.

## 3. Set up the Kids App device (tablet)

Open `kids-app/index.html` locally, or visit your Kids App GitHub Pages URL on the family tablet.

1. Fill in the same Supabase URL/anon key.
2. Enter Adhaa's and Aleef's names, login emails (exactly what you set in step 2.3), and an emoji each.
3. Save — you'll land on "Who's ready for today?" Tap a name, enter the PIN, and you're in.

From then on, reopening the app goes straight to the avatar picker — no typing required day-to-day.

## Why two apps instead of one with a PIN lock?

The original single-device app used a parent PIN to gate editing. This version uses **real accounts and server-side permissions (Postgres row-level security)** instead — a child's login is cryptographically incapable of changing points, the task catalog, or approving anything, no matter what the client-side code does. See `supabase/schema.sql` for the exact rules; the short version:

- Everyone in a family can **read** everything in that family.
- Only a `role = 'parent'` login can **write** directly to tasks, the catalog, rewards, the timetable, etc.
- A child can only change data by calling specific database functions (`complete_task`, `log_quran_reading`, `request_reward`) that check ownership and enforce the rules themselves — there's no path for a child account to give themselves points.

## Real-time sync

Both apps subscribe to Supabase Realtime, so when a parent approves a task or reward, the Kids App updates automatically — no refresh needed — and vice versa.

## What wasn't carried over from the single-device version

To keep this focused, the Smart Home panel and confetti "family weekly reward" celebration animation weren't rebuilt here — the data model (`families.family_goal`) still supports the weekly reward concept and it's shown in Settings, just without the animated unlock moment. Both would be straightforward to add back using the same patterns already in the code.

## A note on testing

I built and syntax-checked both apps thoroughly, and ran them end-to-end against an in-memory mock of the schema's exact RLS/RPC behavior (auth, isolated child sign-up, task completion, approvals, reward redemption) — everything passed with zero runtime errors. I don't have network access to reach supabase.com from where I built this, though, so the SQL itself hasn't run against a live Postgres instance. It's been carefully written and reviewed, but please run it in your own project's SQL editor as step 1 above, and let me know if anything errors — I'm glad to help fix it.

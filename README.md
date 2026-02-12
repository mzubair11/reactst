# React Supabase Auth App

## Setup

1. Install dependencies:
   npm install
2. Copy env template and fill Supabase values:
   copy .env.example .env
3. In Supabase Dashboard:
   - Enable Email auth in Authentication settings.
   - Configure your Site URL and redirect URLs (for local dev add `http://localhost:5173`).
4. Create a `profiles` table for roles:
   ```sql
   create table if not exists public.profiles (
     id uuid primary key references auth.users(id) on delete cascade,
     email text unique,
     role text not null default 'user' check (role in ('user', 'admin')),
     created_at timestamptz not null default now()
   );
   ```
5. Apply RLS and role policies:
   - Run `supabase/rls.sql` in Supabase SQL Editor.
6. Start app:
   npm run dev

## Notes
- The app uses Supabase email/password authentication (signup + signin).
- Admin UI is visible only when `profiles.role = 'admin'`; all other users are treated as `user`.
- Database policies enforce admin-only writes to `products` and `categories`, so non-admin users cannot bypass UI restrictions.
- Promote a user to admin in Supabase:
  ```sql
  update public.profiles set role = 'admin' where email = 'admin@example.com';
  ```
- After login, the app opens a sample mobile-first ecommerce flow with Home, Shop, Product, Cart, and Profile pages.
- Sample data is stored in `src/data/categories.json`, `src/data/orders.json`, and `src/data/banners.json`.

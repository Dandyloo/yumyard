# Yum Yard OS

Tablet-first POS and owner admin system for Yum Yard, Abura, Cape Coast.

## Stack

- Vite
- Vanilla JavaScript
- Supabase PostgreSQL
- Supabase Auth / database RPC
- Cloudflare Pages

## Local setup

```bash
npm install
npm run dev
```

## Database

Database SQL is versioned under `supabase/`.

1. Apply `supabase/migrations/0001_yumyard_foundation.sql`
2. Apply `supabase/migrations/0002_authenticate_worker.sql`
3. Run `supabase/seed.sql` for development data

Never commit `.env` or production PINs.
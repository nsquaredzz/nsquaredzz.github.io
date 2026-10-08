# nsquaredzz-stats

The visitor counter behind [nsquaredzz.github.io](https://nsquaredzz.github.io). The site is static and lives on GitHub Pages, so the counting happens here: a Cloudflare Worker with a D1 (SQLite) database.

```
POST /hit      the site reports a page view and gets the public numbers back
GET  /public   the public numbers, without recording anything
GET  /stats    history, pages, referrers, countries. Needs "Authorization: Bearer <admin token>"
```

## What is counted, and what is not kept

- A **person** is a hash of a secret salt, the date, the IP address and the browser string. The date is part of the hash, so the same person has a different hash every day and cannot be followed from one day to the next.
- The IP address is never written anywhere. No cookie is set and nothing is stored in the visitor's browser.
- The hashes for a day are deleted one day later by a daily cron. After that only counts remain: people per day, views per page, visits per referring site and per country.
- So "visitors today" is people, and the all-time number is **visits**: one person on one day counts once.
- Bots, link previews and prefetches are ignored. One visitor can add at most 300 views a day.
- Days follow the clock in India, like the rest of the site.

## Run and test locally

No Cloudflare account is needed for this part.

```bash
npm install
npm test                         # 14 end-to-end tests against a local worker and database
cp .dev.vars.example .dev.vars   # throwaway local secrets
npm run dev                      # http://localhost:8787
```

To see the site talk to the local worker, start the site with the address in an environment variable:

```bash
VITE_STATS_API=http://localhost:8787 npm run dev
```

## Deploy

Once, after `npx wrangler login`:

```bash
npx wrangler d1 create nsquaredzz-stats      # put the printed database_id in wrangler.toml
npm run migrate                              # creates the tables
npx wrangler secret put SALT                 # a long random string
npx wrangler secret put ADMIN_TOKEN          # another one; this opens /stats/ on the site
npm run deploy
```

Then set `statsApi` in the site's `src/content.json` to the worker's address and deploy the site. After that, `npm run deploy` here is all a change needs.

## Files

```
src/index.ts              the worker
migrations/0001_init.sql  the five tables
test/api.test.mjs         the tests
wrangler.toml             name, database binding, the daily cron, allowed origins
```

The site side is `src/visits.ts` (reporting), `src/status.ts` (the two numbers in the corner), the `stats` command, and the private dashboard at `/stats/` (`src/stats.ts`).

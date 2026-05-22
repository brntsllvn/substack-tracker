# substack-tracker

Vercel app that scrapes the Substack Finance leaderboard daily and visualizes rank over time.

## Working with this codebase

"clean commit push" means: pay all technical debt, DRY, clean, performant, smooth-scalable architecture, and readable code with sound abstractions. Then commit and push via git.

## Architecture

- **Scraper**: Vercel Cron (`api/scrape.js`) runs at 06:00 UTC daily
- **Storage**: JSON files committed to `brntsllvn/substack-tracker` GitHub repo via GitHub Contents API. Vercel is connected to this repo via git integration and auto-deploys on every push.
- **Frontend**: `index.html` fetches `data/index.json` then individual `data/YYYY-MM-DD.json` files directly as static assets

No database, no Blob store, no npm dependencies. The only Vercel function is the scraper.

## Non-obvious decisions

### Why Vercel Cron instead of GitHub Actions?

Substack blocks GitHub Actions IP ranges with 403 responses. Vercel serverless function IPs are not blocked. This was discovered after getting consistent 403s from GitHub Actions workflows.

### How the Substack API was found

Substack's leaderboard pages are client-rendered. The internal API was found by fetching the reader JS bundle (`reader2.js`) and grepping for "leaderboard". The endpoint is:

```
GET https://substack.com/api/v1/category/leaderboard/153/{trending|paid}?page={n}
```

Finance category ID = 153. "Rising" in the UI maps to `trending` in the API. Returns 25 items per page; 4 pages for top 100.

### Storage: GitHub repo as a database

Each day's data is committed as `data/YYYY-MM-DD.json` to `brntsllvn/substack-tracker`. An index file at `data/index.json` lists all dates. The scraper checks if today's file already exists before scraping (idempotent).

This gives free, redundant, versioned storage with no infrastructure to manage.

## Environment variables (set in Vercel dashboard)

- `GITHUB_PAT`: Fine-grained PAT with Contents read+write on `brntsllvn/substack-tracker`
- `CRON_SECRET`: Optional bearer token to protect the scrape endpoint from unauthorized triggers

## Testing the scraper

```bash
curl -X POST https://substack-tracker-bay.vercel.app/api/scrape \
  -H "Authorization: Bearer $CRON_SECRET"
```

Or trigger via Vercel dashboard: Deployments > Functions > scrape > Test.

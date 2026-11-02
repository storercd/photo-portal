# photo-portal

Static photo site. Cloudflare Pages serves `site/`; photos and the collection JSON files live in Cloudflare R2; filtering happens in the browser.

```
site/   static site (index.html, app.js, style.css, config.js, vendor/photoswipe)
sync/   sync.py: select photos by collection, resize + upload to R2, build collection JSON
```

## Setup (done; account `405605de0b5c781d4617017d91f13c6c`, free tier)

- **R2 bucket** `photo-portal`, public via the custom domain `https://photos.chrisstorerphoto.com` (zone `chrisstorerphoto.com`). `PHOTO_BASE_URL` in `site/config.js` points at it.
- **CORS** on the bucket: `sync/r2-cors.json` (GET/HEAD from `http://localhost:8123`, `:8000`, `:8788`, `https://*.pages.dev`, `https://chrisstorerphoto.com`). Re-apply with `npx wrangler r2 bucket cors set photo-portal --file sync/r2-cors.json`.
- **R2 API token** (Object Read & Write, scoped to the bucket) is in a git-ignored `.env` at the repo root:
  ```
  R2_ACCOUNT_ID=...  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...  R2_BUCKET=photo-portal
  ```
  Load it before syncing: `set -a; . ../.env; set +a`.
- **Cloudflare Pages** project `photo-portal` serves `site/` at https://photo-portal-apr.pages.dev (no build step). Redeploy after site changes:
  ```
  npx wrangler login            # once; if npm cache is root-owned add --cache /tmp/npm-cache
  rsync -a --exclude local site/ /tmp/deploy/      # never deploy the git-ignored site/local preview photos
  npx wrangler pages deploy /tmp/deploy --project-name photo-portal --branch main --commit-dirty=true
  ```
  Photo data lives in R2, so syncing photos never needs a redeploy.

## Collections

A collection is a JSON file in `sync/collections/` and becomes one page (`?c=<slug>`); the site's home page lists them. Photos are only uploaded if some collection selects them.

```json
{
  "title": "EHS Volleyball",
  "min_rating": 3,
  "exclude": ["*-composite-*"],
  "rules": [
    {"start": "2026-08-15", "end": "2026-11-15", "keywords": ["Team: Everett High School"], "session": "Fall season"},
    {"files": ["20261003_*"]}
  ]
}
```

- Rules are ORed; conditions inside a rule (`start`/`end`, `keywords` (any of), `files` globs, `min_rating`) are ANDed.
- `min_rating` at the top is the default for rules; `session` labels matching photos (otherwise the first matching session keyword is used, see `session_keywords` below).
- `"download": true` also uploads each original as a full-quality download (shown as an Original button in the viewer's ⓘ panel). Originals are large (about 11 MB each here), so enable it only for collections you want to offer; R2 free tier is 10 GB.
- `"project": "EHS Volleyball 2026"` is shorthand for the keyword `Project: EHS Volleyball 2026`. `Project:`, `Pass:` and session keywords are not published as filter keywords.
- `session_keywords` (top level, optional) lists the keyword prefixes that label a photo's session, first match wins, e.g. `"session_keywords": ["Performance:", "Theme:"]` for Sounds of Africa. `Session:` is always recognised first. If omitted, the default is `Session:`, `Event:`, `Performance:`, `Theme:`. A prefix not listed (e.g. `Theme:` in a volleyball collection) becomes an ordinary keyword and must be in `include_keywords` or `exclude_keywords`.
- **Every keyword must be accounted for.** `include_keywords` (published as filter keywords) and `exclude_keywords` (ignored, never published) are top-level lists of keywords, case-insensitive, where `*` matches any text, e.g. `"include_keywords": ["Team: *", "Sport: *"], "exclude_keywords": ["Task: *"]`. Before anything is uploaded, the sync checks every photo the collection selects and aborts, listing each offender, if it has a keyword that matches neither list. session keywords, `Project:`, `Pass:` and any rule `keywords` are always accounted for.
- Keywords are your existing photo keywords, e.g. `Team: ...`, `Sport: ...`, `Session: ...`. Published collection JSON uses `session` and `keywords`; the site still reads the older `event`/`tags` fields until a collection is re-synced.

## Local preview

```
export PHOTO_SOURCE=~/working/camera/edits
cd sync
python sync.py my-collection --dry-run     # list matches
python sync.py my-collection --local       # build into site/local (git-ignored)
python3 -m http.server -d ../site 8123     # open http://localhost:8123/?local
```

## Syncing to R2

```
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python sync.py my-collection other-collection     # or --all
```

Safe to re-run or interrupt (Ctrl+C); already-uploaded files are skipped, and edited photos get a new content-hashed URL. Photos shared by several collections are stored once. Each run prints progress every 10 photos.

How it stays fast: existing R2 keys are listed once up front (no per-file requests), file hashes are cached in the git-ignored `sync/.hash-cache.json` (by size and modified time), the XMP scan is shared across collections, and the sizes of a photo upload in parallel. Files that disappear or are replaced mid-run (e.g. while re-exporting) are skipped and picked up on the next run. The collection JSON is only written at the end of a run, so the live site shows new photos once a run completes. Old collection entries are not removed automatically.

### Cleaning up R2

```
python sync.py --prune --dry-run    # report what would be deleted
python sync.py --prune              # delete it
```

Prune removes collections on R2 that have no file in `sync/collections/` (delete the local JSON to retire a collection), then deletes any photo file that no remaining collection references, such as old hashes left by re-exports. Run it after a sync finishes, never during one. It does not need `PHOTO_SOURCE`.

## Linting

Python style is enforced with [ruff](https://docs.astral.sh/ruff/) (`ruff.toml`; same line length as `photo-workflow`):

```
pip install ruff
ruff check .      # lint (add --fix for safe fixes)
ruff format .     # format
```

JavaScript and CSS in `site/` (not the vendored library) use [Biome](https://biomejs.dev), one tool for linting and formatting (`biome.json`):

```
npm install        # once
npm run lint       # check
npm run fix        # apply safe fixes and format
```

## Metadata

Rating, keywords and capture date come from embedded XMP (or a sidecar `.xmp`) and EXIF; the date comes from the filename's `YYYYMMDD` prefix first (exports may lose EXIF), then EXIF, then file modified time.

## Image sizes

Each photo gets `thumb` (600 px, grid), `med` (1200 px) and `web` (2000 px) JPEGs (quality 85); the viewer uses `med` on small or low-density screens and `web` otherwise. The viewer's Download button saves the `web` version. The optional `full` is the untouched original (including its metadata, e.g. any GPS). Resized copies carry no EXIF/XMP.

## Viewer

Clicking a photo opens [PhotoSwipe](https://photoswipe.com) 5.4.4 (MIT, vendored in `site/vendor/photoswipe/`), for desktop and phones alike: swipe or arrow keys to move, pinch/double-tap to zoom, X / Esc / swipe-down to close, and the phone's Back button closes the viewer and returns to the thumbnails. The ⓘ button (or `i`) opens a panel with title, session, date, rating, and Download (2000 px) and Share buttons. Share uses the phone's share sheet (including "Save Image" on iOS) when the browser supports sharing files. Downloads are fetched by the page and saved as a blob, since cross-origin `download` links don't work with the R2 domain.

## Private collections

Password-protected collections live in a second, non-public R2 bucket (`photo-portal-private`) and are served only by the Pages Function `functions/private/c/[slug]/[[path]].js` (R2 binding `PRIVATE_BUCKET`). The home page footer links to `private.html`; entering a password posts to `functions/private/login.js` (Turnstile-checked), which sets an HttpOnly signed cookie for the matching collection and the page opens `./?p=<slug>`. A password maps straight to one collection, so no list of private collections is ever shown.

- **Making a collection private:** add `"private": true` to its file in `sync/collections/` (slug = file name, lowercase letters/digits/`-`) and run `python sync.py <slug>`. It uploads to the private bucket under `<slug>/` and is never added to `collections.json`. The sync credentials need write access to the private bucket: either one token covering both buckets, or `R2_PRIVATE_ACCESS_KEY_ID` / `R2_PRIVATE_SECRET_ACCESS_KEY` (and optionally `R2_PRIVATE_BUCKET`, default `photo-portal-private`) in `.env`. A collection that was public stays on the public bucket until `python sync.py --prune` removes it; `--prune` also cleans unreferenced files in private folders. `--local` writes private collections to `site/local/private/<slug>/`.
- **Bucket layout:** every object is under `<slug>/`, and the collection file is `<slug>/collection.json` (photo keys inside it are relative to `<slug>/`).
- **Secrets** (`npx wrangler pages secret put NAME --project-name photo-portal`): `PRIVATE_COOKIE_SECRET` (any long random string; rotating it logs everyone out) and `PRIVATE_PASSWORDS` (JSON mapping slug to password hash). `TURNSTILE_SECRET` is shared with the contact form.
- **Add or change a password:** `node scripts/hash-password.mjs <slug>` prints `{"<slug>":"pbkdf2$..."}`; merge the entries for all private collections into one JSON object and store it as `PRIVATE_PASSWORDS`. Cookies last 7 days.
- **Local test:** `npx wrangler pages dev site --r2 PRIVATE_BUCKET=photo-portal-private -b TURNSTILE_SECRET=1x0000000000000000000000000000000AA -b PRIVATE_COOKIE_SECRET=x -b 'PRIVATE_PASSWORDS={...}'` (the Turnstile test secret accepts any token; use the matching test site key `1x00000000000000000000AA` in `private.html` for the browser).

## Contact form

`site/about.html` posts to `functions/api/contact.js` (a Pages Function), which checks Cloudflare Turnstile and emails the message through [Resend](https://resend.com).

- Secrets (from the repo root): `npx wrangler pages secret put RESEND_API_KEY --project-name photo-portal`, likewise `TURNSTILE_SECRET` and `CONTACT_TO` (the inbox that receives messages).
- Optional `CONTACT_FROM`: defaults to Resend's `onboarding@resend.dev`, which can only email the Resend account's own address. The domain `chrisstorerphoto.com` is verified in Resend, so `CONTACT_FROM` is `Photo Portal <contact@chrisstorerphoto.com>`.
- `data-sitekey` in `about.html` is the public key of the Turnstile widget for `chrisstorerphoto.com`; its secret is `TURNSTILE_SECRET`. For local testing on `localhost`, add `localhost` to the widget's hostnames or temporarily use Cloudflare's test key `1x00000000000000000000AA` with secret `1x0000000000000000000000000000000AA`.
- Deploy from the repo root so `functions/` is picked up: `npx wrangler pages deploy /tmp/deploy --project-name photo-portal` only uploads functions found in the current directory, so run it from here.
- Try it locally (a plain static server has no `/api/contact`): `set -a; . ./.env; set +a; npx wrangler pages dev site -b RESEND_API_KEY="$RESEND_API_KEY" -b TURNSTILE_SECRET="$TURNSTILE_SECRET" -b CONTACT_TO="$CONTACT_TO"`, then open http://localhost:8788/about.

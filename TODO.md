# TODO

## Tagging (for the pages I want to host)
- [ ] Decide which collections to host first (EHS Volleyball, college volleyball, ...).
- [ ] Define a consistent keyword scheme (existing `Key: Value` style: `Event:`, `Team:`, `Sport:`, `League:`, `Location:`).
- [ ] Tag only the photos those collections need (about 78% of edits have no keywords); until then use date ranges or filename rules in `sync/collections/`.
- [ ] Later, larger task: fix tagging across the whole library and re-export.
- SOAFEST 4.0 is already well tagged and works as a collection today.

## Hosting
- [x] Cloudflare account, R2 bucket + CORS, Pages deploy, test upload (`soafest-sample`, 45 photos).
- [x] R2 bucket on `photos.chrisstorerphoto.com`.
- [ ] Add `chrisstorerphoto.com` as a custom domain on the Pages project.
- [ ] Optionally connect the GitHub repo to Pages for auto-deploys (output dir `site`).
- [x] EHS Cheer 2026 and EHS Volleyball 2026 synced and deployed (re-run sync as the re-export adds photos).
- [x] Test collections deleted; `python sync.py --prune` cleans R2 (run after the final sync to clear old hashes).
- [ ] Possibly strip EXIF/GPS if originals are ever offered; decide on naming minors and the copyright line before going public.
- [ ] Hide list for internal tags beyond `Pass:`.
- [ ] Cache the folder scan (it still reads every file's XMP each run).

## Site
- [x] PhotoSwipe viewer (swipe, zoom, X, Back button, info panel, download/share). Phone testing in progress.
- [ ] Multiple collections landing page polish; share links.

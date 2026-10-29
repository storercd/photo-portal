#!/usr/bin/env python3
"""Build/sync photo collections to Cloudflare R2, or to a local preview folder.

A collection is a JSON file in sync/collections/ (see README). Each one selects
photos from the source folder by date range, keywords, filename pattern and
rating, and becomes its own page on the site.

Rating, keywords and capture date come from XMP (embedded or sidecar .xmp) and
EXIF. A keyword like "event:Round 1" or a rule's "event" field labels the event.

Usage:
    python sync.py ehs-volleyball --dry-run      # list what would be included
    python sync.py ehs-volleyball --local        # preview in site/local
    python sync.py ehs-volleyball sounds-of-africa   # upload to R2
    python sync.py --all
    python sync.py --prune --dry-run             # report R2 cleanup; drop --dry-run to delete
Source folder: --source, or $PHOTO_SOURCE.
"""

import argparse
import fnmatch
import hashlib
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from datetime import datetime
from functools import cache, partial
from pathlib import Path

from PIL import ExifTags, Image, ImageOps

HERE = Path(__file__).parent
COLLECTIONS_DIR = HERE / "collections"
LOCAL_DIR = HERE.parent / "site" / "local"
EXTS = {".jpg", ".jpeg", ".png"}
SIZES = {"thumb": 600, "med": 1200, "web": 2000}  # long edge in px
NS = {
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "xmp": "http://ns.adobe.com/xap/1.0/",
    "dc": "http://purl.org/dc/elements/1.1/",
}
# Keywords that drive selection/events or are internal; never published as tags.
HIDDEN_PREFIXES = ("event:", "project:", "pass:")
XMP_RE = re.compile(rb"<x:xmpmeta.*?</x:xmpmeta>", re.S)
XMP_SCAN_BYTES = 1 << 20  # XMP lives near the start of the file
HASH_CACHE = HERE / ".hash-cache.json"


@cache  # one scan per file even with several collections
def read_xmp(path):
    """Return (rating, keywords) from the sidecar .xmp if present, else embedded XMP."""
    sidecar = path.with_suffix(".xmp")
    if sidecar.exists():
        data = sidecar.read_bytes()
    else:
        with open(path, "rb") as f:
            data = f.read(XMP_SCAN_BYTES)
    m = XMP_RE.search(data)
    if not m:
        return 0, []
    try:
        root = ET.fromstring(m.group(0))
    except ET.ParseError:
        return 0, []
    rating, keywords = 0, []
    for desc in root.iter(f"{{{NS['rdf']}}}Description"):
        r = desc.get(f"{{{NS['xmp']}}}Rating")
        if r is None:
            el = desc.find("xmp:Rating", NS)
            r = el.text if el is not None else None
        if r:
            with suppress(ValueError):
                rating = max(rating, int(float(r)))
        for li in desc.findall("dc:subject/rdf:Bag/rdf:li", NS):
            if li.text:
                keywords.append(li.text.strip())
    return max(rating, 0), sorted(set(keywords))  # -1 (rejected) clamps to 0


def photo_date(img, path):
    """Filename date (YYYYMMDD prefix) first, since exports may lose EXIF; then EXIF, then mtime."""
    m = re.match(r"(\d{4})(\d{2})(\d{2})", path.name)
    if m:
        with suppress(ValueError):
            return datetime(*map(int, m.groups()))
    if img is None:
        with Image.open(path) as im:
            return photo_date(im, path)
    exif = img.getexif().get_ifd(ExifTags.IFD.Exif)
    raw = exif.get(ExifTags.Base.DateTimeOriginal)
    if raw:
        try:
            return datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
        except ValueError:
            pass
    return datetime.fromtimestamp(path.stat().st_mtime)


def load_collection(slug):
    path = COLLECTIONS_DIR / f"{slug}.json"
    if not path.exists():
        sys.exit(f"No collection file {path}")
    c = json.loads(path.read_text())
    c["slug"] = slug
    c.setdefault("title", slug)
    return c


def match(collection, name, date, rating, keywords):
    """Return the matching rule, or None. A rule's conditions are ANDed; rules are ORed."""
    if any(fnmatch.fnmatch(name, g) for g in collection.get("exclude", [])):
        return None
    d = date.strftime("%Y-%m-%d")
    for rule in collection["rules"]:
        if rating < rule.get("min_rating", collection.get("min_rating", 0)):
            continue
        if "start" in rule and d < rule["start"]:
            continue
        if "end" in rule and d > rule["end"]:
            continue
        wanted = set(rule.get("tags", []))
        if "project" in rule:
            wanted.add(f"Project: {rule['project']}")
        if wanted and not wanted & set(keywords):
            continue
        if "files" in rule and not any(fnmatch.fnmatch(name, g) for g in rule["files"]):
            continue
        return rule
    return None


def event_name(rule, keywords):
    if rule.get("event"):
        return rule["event"]
    for k in keywords:
        if k.lower().startswith("event:"):
            return k.split(":", 1)[1].strip()
    return ""


def resized(img, long_edge):
    img = img.copy()
    img.thumbnail((long_edge, long_edge))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=85, optimize=True)
    return buf.getvalue()


_hash_cache = json.loads(HASH_CACHE.read_text()) if HASH_CACHE.exists() else {}


def save_hash_cache():
    HASH_CACHE.write_text(json.dumps(_hash_cache))


def file_hash(path):
    """SHA-256 prefix, cached by size and mtime so unchanged files aren't re-read."""
    st = path.stat()
    hit = _hash_cache.get(path.name)
    if hit and hit[0] == st.st_size and hit[1] == st.st_mtime_ns:
        return hit[2]
    digest = _file_hash(path)
    _hash_cache[path.name] = [st.st_size, st.st_mtime_ns, digest]
    return digest


def _file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


class LocalStore:
    def __init__(self, root):
        self.root = root

    def exists(self, key):
        return (self.root / key).exists()

    def load_keys(self):
        pass

    def get(self, key):
        path = self.root / key
        return path.read_bytes() if path.exists() else None

    def put(self, key, body, content_type, cache_control, disposition=None):
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)


class R2Store:
    def __init__(self):
        import boto3

        for var in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
            if not os.environ.get(var):
                sys.exit(f"Missing environment variable {var} (see README)")
        self.bucket = os.environ["R2_BUCKET"]
        self.s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )

    def load_keys(self):
        """List existing photo keys once instead of one HEAD request per file."""
        self.keys, self.sizes = set(), {}
        for page in self.s3.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix="photos/"
        ):
            for o in page.get("Contents", []):
                self.keys.add(o["Key"])
                self.sizes[o["Key"]] = o["Size"]
        print(f"{len(self.keys)} files already in R2")

    def exists(self, key):
        return key in self.keys

    def delete(self, keys):
        for i in range(0, len(keys), 1000):
            batch = keys[i : i + 1000]
            self.s3.delete_objects(
                Bucket=self.bucket, Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True}
            )
            self.keys.difference_update(batch)

    def get(self, key):
        from botocore.exceptions import ClientError

        try:
            return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except ClientError:
            return None

    def put(self, key, body, content_type, cache_control, disposition=None):
        extra = {"ContentDisposition": disposition} if disposition else {}
        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            CacheControl=cache_control,
            **extra,
        )
        if key.startswith("photos/"):
            self.keys.add(key)


CACHE_CONTROL = "public, max-age=31536000, immutable"


def upload(store, path, img, item):
    kind, key = item
    if kind == "full":
        # Original bytes, served as a download (metadata is kept as-is).
        mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        store.put(
            key, path.read_bytes(), mime, CACHE_CONTROL, f'attachment; filename="{path.name}"'
        )
    else:
        store.put(key, resized(img, SIZES[kind]), "image/jpeg", CACHE_CONTROL)


def build_collection(coll, files, store, dry_run):
    photos, written = [], 0
    total = 0
    if not dry_run:
        for p in files:  # cheap metadata-only pass so progress can show a total
            try:
                rating, keywords = read_xmp(p)
                if match(coll, p.name, photo_date(None, p), rating, keywords) is not None:
                    total += 1
            except FileNotFoundError:
                pass
        print(f"  {total} photos match this collection", flush=True)
    for p in files:
        try:
            rating, keywords = read_xmp(p)
            date = photo_date(None, p)
        except FileNotFoundError:  # file replaced mid-run by a re-export
            continue
        rule = match(coll, p.name, date, rating, keywords)
        if rule is None:
            continue
        with Image.open(p) as raw:
            event = event_name(rule, keywords)
            # The hash in the key means edited photos get new URLs (no stale caches).
            pid = f"{p.stem}-{file_hash(p)}"
            keys = {k: f"photos/{k}/{pid}.jpg" for k in SIZES}
            if coll.get("download"):
                keys["full"] = f"photos/full/{pid}{p.suffix.lower()}"
            img = ImageOps.exif_transpose(raw)
            width, height = img.size
            if dry_run:
                print(f"  {p.name}  {date:%Y-%m-%d} rating={rating} event={event or '-'}")
            else:
                todo = [(k, v) for k, v in keys.items() if not store.exists(v)]
                if todo:
                    img.load()  # decode once; threads share the pixels
                    with ThreadPoolExecutor(len(todo)) as pool:
                        list(pool.map(partial(upload, store, p, img), todo))
                    written += len(todo)
                done = len(photos) + 1
                if done % 10 == 0:
                    print(f"  ... {done}/{total} photos processed ({done * 100 // max(total, 1)}%), {written} files uploaded", flush=True)
        photos.append(
            {
                "id": pid,
                "title": p.stem,
                "event": event,
                "tags": [k for k in keywords if not k.lower().startswith(HIDDEN_PREFIXES)],
                "rating": rating,
                "date": date.strftime("%Y-%m-%d"),
                "width": width,
                "height": height,
                "thumb": keys["thumb"],
                "med": keys["med"],
                "web": keys["web"],
                **({"full": keys["full"]} if "full" in keys else {}),
            }
        )
    photos.sort(key=lambda x: x["title"])  # filenames sort chronologically
    return photos, written


def prune(store, dry_run):
    """Remove collections that no longer have a local file, then photos nothing references.

    Run it when no sync is in progress: a running sync uploads photos before the
    collection JSON that references them is written.
    """
    store.load_keys()
    index = json.loads(store.get("collections.json") or '{"collections": []}')
    local = {p.stem for p in COLLECTIONS_DIR.glob("*.json")}
    keep = [c for c in index["collections"] if c["slug"] in local]
    for c in index["collections"]:
        if c["slug"] not in local:
            print(f"removing collection {c['slug']}")
    referenced = set()
    for c in keep:
        data = json.loads(store.get(f"collections/{c['slug']}.json") or '{"photos": []}')
        for photo in data["photos"]:
            referenced.update(photo[k] for k in ("thumb", "med", "web", "full") if photo.get(k))
    stale = sorted(k for k in store.keys if k not in referenced)
    size = sum(store.sizes[k] for k in stale)
    print(f"{len(stale)} unreferenced photo files ({size / 1e6:.1f} MB) of {len(store.keys)}")
    if dry_run:
        print("dry run: nothing deleted")
        return
    store.delete(stale)
    for c in index["collections"]:
        if c["slug"] not in local:
            store.delete([f"collections/{c['slug']}.json"])
    index["collections"] = keep
    store.put(
        "collections.json",
        json.dumps(index, indent=1).encode(),
        "application/json",
        "public, max-age=60",
    )
    print("done")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("collections", nargs="*", help="collection slugs (files in sync/collections)")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--source", type=Path, default=os.environ.get("PHOTO_SOURCE"))
    ap.add_argument("--local", action="store_true", help=f"write to {LOCAL_DIR} instead of R2")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--prune",
        action="store_true",
        help="delete R2 collections with no local file and photos no collection uses",
    )
    args = ap.parse_args()

    if args.prune:
        prune(R2Store(), args.dry_run)
        return

    slugs = sorted(p.stem for p in COLLECTIONS_DIR.glob("*.json")) if args.all else args.collections
    if not slugs:
        ap.error("give collection slugs or --all")
    if not args.source:
        ap.error("set --source or $PHOTO_SOURCE")
    source = Path(args.source).expanduser()
    files = sorted(p for p in source.iterdir() if p.suffix.lower() in EXTS)
    if not files:
        sys.exit(f"No images found in {source}")

    store = None
    if not args.dry_run:
        store = LocalStore(LOCAL_DIR) if args.local else R2Store()
        store.load_keys()
        index = json.loads(store.get("collections.json") or '{"collections": []}')

    for slug in slugs:
        coll = load_collection(slug)
        print(f"{coll['title']} ({slug})")
        photos, written = build_collection(coll, files, store, args.dry_run)
        print(f"  {len(photos)} photos" + ("" if args.dry_run else f", {written} files written"))
        if args.dry_run:
            continue
        store.put(
            f"collections/{slug}.json",
            json.dumps({"title": coll["title"], "photos": photos}, indent=1).encode(),
            "application/json",
            "public, max-age=60",
        )
        entry = {
            "slug": slug,
            "title": coll["title"],
            "description": coll.get("description", ""),
            "count": len(photos),
            "cover": photos[0]["thumb"] if photos else None,
        }
        index["collections"] = [c for c in index["collections"] if c["slug"] != slug] + [entry]

    if store:
        save_hash_cache()
        index["collections"].sort(key=lambda c: c["title"])
        store.put(
            "collections.json",
            json.dumps(index, indent=1).encode(),
            "application/json",
            "public, max-age=60",
        )
        if args.local:
            print("\nPreview: python3 -m http.server -d site  ->  http://localhost:8000/?local")


if __name__ == "__main__":
    main()

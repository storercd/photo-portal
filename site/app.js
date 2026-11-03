import PhotoSwipeLightbox from "./vendor/photoswipe/photoswipe-lightbox.esm.min.js";

const params = new URLSearchParams(location.search);
// Private collections are served by the cookie-checked /private/c/<slug> function.
const seg = location.pathname.split("/").map(decodeURIComponent);
// /galleries/private/<slug> (or legacy ?p=<slug>) opens a private collection.
const priv = (seg[2] === "private" ? seg[3] : params.get("p")) || null;
// /galleries/<slug> opens a public collection; /galleries lists them.
const slug = priv || seg[2] || params.get("c");
const base = priv
  ? `/private/c/${encodeURIComponent(priv)}`
  : params.has("local")
    ? "/local"
    : window.PHOTO_BASE_URL || "/local";
const keep = params.has("local") ? "?local" : "";
const filters = document.querySelectorAll("header select, header input");
const list = document.getElementById("collections");
document.getElementById("title").href = `/galleries${keep}`;
const grid = document.getElementById("grid");
const sessionSel = document.getElementById("session");
const keywordSel = document.getElementById("keyword");
const ratingSel = document.getElementById("rating");
const search = document.getElementById("search");
const bar = document.getElementById("bar");
const toggle = document.getElementById("filter-toggle");
const count = document.getElementById("filter-count");
const wrap = document.getElementById("filters-wrap");
const panel = document.getElementById("filters");
const mobile = matchMedia("(max-width: 600px)");
let open = false;
let openY = 0;

// On phones the filter bar scrolls away; once it has, a sticky "Filters" button
// brings the controls back as an overlay without moving the page.
function syncBar() {
  const away = mobile.matches && wrap.getBoundingClientRect().bottom < bar.offsetHeight;
  toggle.hidden = !away;
  const floating = away && open;
  if (floating && !panel.classList.contains("float")) {
    wrap.style.height = `${panel.offsetHeight}px`;
    panel.style.setProperty("--bar-h", `${bar.offsetHeight}px`);
  } else if (!floating) {
    wrap.style.height = "";
    open &&= away;
  }
  panel.classList.toggle("float", floating);
  toggle.setAttribute("aria-expanded", floating);
}
toggle.onclick = () => {
  open = !open;
  openY = scrollY;
  syncBar();
};
addEventListener(
  "scroll",
  () => {
    if (panel.classList.contains("float") && Math.abs(scrollY - openY) > 60) open = false;
    syncBar();
  },
  { passive: true },
);
mobile.onchange = syncBar;

let photos = [];
let shown = [];
let items = [];

function render() {
  const ses = sessionSel.value;
  const keyword = keywordSel.value;
  const minRating = +ratingSel.value;
  const q = search.value.trim().toLowerCase();
  const active = [ses, keyword, minRating, q].filter(Boolean).length;
  count.textContent = active;
  count.hidden = !active;
  shown = photos.filter(
    (p) =>
      (!ses || p.session === ses) &&
      (!keyword || p.keywords.includes(keyword)) &&
      p.rating >= minRating &&
      (!q || `${p.title} ${p.session} ${p.keywords.join(" ")}`.toLowerCase().includes(q)),
  );
  grid.replaceChildren(
    ...shown.map((p, i) => {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.classList.add("pending");
      img.onload = img.onerror = () => img.classList.remove("pending");
      img.style.setProperty("--ar", p.width / p.height);
      img.src = `${base}/${p.thumb}`;
      img.alt = p.title;
      img.title = `${p.session} · ${p.date} · ${"★".repeat(p.rating)}`;
      img.onclick = () => openViewer(i);
      return img;
    }),
  );
  const useMed = innerWidth * devicePixelRatio <= 1300;
  items = shown.map((p, i) => {
    const key = useMed && p.med ? p.med : p.web;
    const scale = Math.min(1, (useMed && p.med ? 1200 : 2000) / Math.max(p.width, p.height));
    return {
      src: `${base}/${key}`,
      width: Math.round(p.width * scale),
      height: Math.round(p.height * scale),
      msrc: `${base}/${p.thumb}`,
      alt: p.title,
      element: grid.children[i],
    };
  });
  viewer.options.dataSource = items;
  const hash = new URLSearchParams();
  if (ses) hash.set("session", ses);
  if (keyword) hash.set("keyword", keyword);
  if (minRating) hash.set("rating", minRating);
  history.replaceState(null, "", location.search + (hash.size ? `#${hash}` : ""));
}

async function showCollections() {
  const { collections } = await (
    await fetch(`${base}/collections.json`, { cache: "no-cache" })
  ).json();
  for (const el of filters) el.classList.add("hide");
  toggle.classList.add("hide");
  grid.hidden = true;
  list.hidden = false;
  list.replaceChildren(
    ...collections.map((c) => {
      const a = document.createElement("a");
      a.href = `/galleries/${encodeURIComponent(c.slug)}${keep}`;
      const img = c.cover ? `<img src="${base}/${c.cover}" alt="">` : "";
      a.innerHTML = `${img}<div><strong></strong><br><small></small></div>`;
      a.querySelector("strong").textContent = c.title;
      a.querySelector("small").textContent = `${c.count} photos ${c.description}`;
      return a;
    }),
  );
}

async function showCollection() {
  const url = priv
    ? `${base}/collection.json`
    : `${base}/collections/${encodeURIComponent(slug)}.json`;
  const res = await fetch(url, { cache: "no-cache" });
  if (priv && res.status === 401) {
    location.replace("/galleries/private");
    return;
  }
  const data = await res.json();
  photos = data.photos;
  for (const p of photos) {
    // Data synced before the rename uses "event" and "tags".
    p.session ||= p.event || "NO SESSION";
    p.keywords ||= p.tags || [];
  }
  document.title = data.title;
  document.getElementById("title").textContent = data.title;
  for (const name of [...new Set(photos.map((p) => p.session).filter(Boolean))].reverse()) {
    sessionSel.add(new Option(name, name));
  }
  for (const name of [...new Set(photos.flatMap((p) => p.keywords))].sort()) {
    keywordSel.add(new Option(name, name));
  }
  const h = new URLSearchParams(location.hash.slice(1));
  sessionSel.value = h.get("session") || h.get("event") || "";
  keywordSel.value = h.get("keyword") || h.get("tag") || "";
  ratingSel.value = h.get("rating") || "0";
  render();
}

keywordSel.onchange = ratingSel.onchange = search.oninput = render;
sessionSel.onchange = () => {
  render();
  scrollTo(0, 0);
};
const pswpModule = () => import("./vendor/photoswipe/photoswipe.esm.min.js");
const viewer = new PhotoSwipeLightbox({
  dataSource: items,
  pswpModule,
  bgOpacity: 1,
  wheelToZoom: true,
});

function openViewer(i) {
  viewer.loadAndOpen(i, items);
}

async function save(url, filename, btn = {}) {
  const label = btn.textContent;
  btn.textContent = "Saving…";
  try {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } finally {
    btn.textContent = label;
  }
}

async function share(url, filename) {
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
  try {
    await navigator.share({ files: [file], title: filename });
  } catch (e) {
    if (e.name !== "AbortError") throw e;
  }
}

const canShareFiles = !!navigator.canShare?.({
  files: [new File([""], "a.jpg", { type: "image/jpeg" })],
});

viewer.on("uiRegister", () => {
  const { ui } = viewer.pswp;
  ui.registerElement({
    name: "info-button",
    order: 9,
    isButton: true,
    html: "ⓘ",
    title: "Info and download (i)",
    onClick: (_e, _el, pswp) => pswp.element.classList.toggle("pswp--info"),
  });
  const icon = (d) =>
    `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  ui.registerElement({
    name: "download-button",
    order: 7,
    isButton: true,
    html: icon('<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>'),
    title: "Download this photo",
    onClick: (_e, _el, pswp) => {
      const p = shown[pswp.currIndex];
      save(`${base}/${p.web}`, `${p.title}.jpg`);
    },
  });
  // Apple devices use the box-with-arrow share icon; everyone else the three connected dots.
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const shareApple =
    '<path d="M12 15V3m0 0L8 7m4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>';
  const shareNodes =
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4m0-11-6.8 4"/>';
  if (canShareFiles) {
    ui.registerElement({
      name: "share-button",
      order: 8,
      isButton: true,
      html: icon(apple ? shareApple : shareNodes),
      title: "Share this photo",
      onClick: (_e, _el, pswp) => {
        const p = shown[pswp.currIndex];
        share(`${base}/${p.web}`, `${p.title}.jpg`);
      },
    });
  }
  ui.registerElement({
    name: "info-panel",
    order: 9,
    appendTo: "root",
    onInit: (el, pswp) => {
      el.className = "info-panel";
      el.innerHTML = `<div><strong></strong><div class="meta"></div></div>
        <div class="actions">
          <button data-act="web">Download</button>
          <button data-act="full" hidden>Original</button>
          <button data-act="share" hidden>Share</button>
        </div>`;
      const [web, full, sharebtn] = el.querySelectorAll("button");
      const photo = () => shown[pswp.currIndex];
      pswp.on("change", () => {
        const p = photo();
        el.querySelector("strong").textContent = p.title;
        el.querySelector(".meta").textContent = [
          p.session,
          p.date,
          "★".repeat(p.rating),
          ...p.keywords,
        ]
          .filter(Boolean)
          .join(" · ");
        full.hidden = !p.full;
        sharebtn.hidden = !canShareFiles;
      });
      web.onclick = () => save(`${base}/${photo().web}`, `${photo().title}.jpg`, web);
      full.onclick = () => {
        const p = photo();
        save(`${base}/${p.full}`, `${p.title}${p.full.slice(p.full.lastIndexOf("."))}`, full);
      };
      sharebtn.onclick = () => share(`${base}/${photo().web}`, `${photo().title}.jpg`);
    },
  });
});

viewer.on("keydown", (e) => {
  if (e.originalEvent.key === "i") viewer.pswp.element.classList.toggle("pswp--info");
});

// Let the phone's Back button close the viewer and return to the thumbnails.
viewer.on("afterInit", () => history.pushState({ pswp: true }, ""));
viewer.on("close", () => {
  if (history.state?.pswp) history.back();
});
addEventListener("popstate", () => {
  if (viewer.pswp && !history.state?.pswp) viewer.pswp.close();
});

viewer.init();

(slug ? showCollection() : showCollections()).catch((e) => {
  document.body.append(`Failed to load: ${e.message}`);
});

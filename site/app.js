import PhotoSwipeLightbox from "./vendor/photoswipe/photoswipe-lightbox.esm.min.js";

const params = new URLSearchParams(location.search);
const base = params.has("local") ? "local" : window.PHOTO_BASE_URL || "local";
const slug = params.get("c");
const keep = params.has("local") ? "&local" : "";
const filters = document.querySelectorAll("header select, header input");
const list = document.getElementById("collections");
document.getElementById("title").href = keep ? "./?local" : "./";
const grid = document.getElementById("grid");
const eventSel = document.getElementById("event");
const tagSel = document.getElementById("tag");
const ratingSel = document.getElementById("rating");
const search = document.getElementById("search");

let photos = [];
let shown = [];
let items = [];

function render() {
  const ev = eventSel.value;
  const tag = tagSel.value;
  const minRating = +ratingSel.value;
  const q = search.value.trim().toLowerCase();
  shown = photos.filter(
    (p) =>
      (!ev || p.event === ev) &&
      (!tag || p.tags.includes(tag)) &&
      p.rating >= minRating &&
      (!q || `${p.title} ${p.event} ${p.tags.join(" ")}`.toLowerCase().includes(q)),
  );
  grid.replaceChildren(
    ...shown.map((p, i) => {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.style.setProperty("--ar", p.width / p.height);
      img.src = `${base}/${p.thumb}`;
      img.alt = p.title;
      img.title = `${p.event} · ${p.date} · ${"★".repeat(p.rating)}`;
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
  if (ev) hash.set("event", ev);
  if (tag) hash.set("tag", tag);
  if (minRating) hash.set("rating", minRating);
  history.replaceState(null, "", location.search + (hash.size ? `#${hash}` : ""));
}

async function showCollections() {
  const { collections } = await (
    await fetch(`${base}/collections.json`, { cache: "no-cache" })
  ).json();
  for (const el of filters) el.classList.add("hide");
  grid.hidden = true;
  list.hidden = false;
  list.replaceChildren(
    ...collections.map((c) => {
      const a = document.createElement("a");
      a.href = `?c=${encodeURIComponent(c.slug)}${keep}`;
      const img = c.cover ? `<img src="${base}/${c.cover}" alt="">` : "";
      a.innerHTML = `${img}<div><strong></strong><br><small></small></div>`;
      a.querySelector("strong").textContent = c.title;
      a.querySelector("small").textContent = `${c.count} photos ${c.description}`;
      return a;
    }),
  );
}

async function showCollection() {
  const data = await (
    await fetch(`${base}/collections/${encodeURIComponent(slug)}.json`, { cache: "no-cache" })
  ).json();
  photos = data.photos;
  for (const p of photos) p.event ||= "NO EVENT";
  document.title = data.title;
  document.getElementById("title").textContent = data.title;
  for (const name of [...new Set(photos.map((p) => p.event).filter(Boolean))].reverse()) {
    eventSel.add(new Option(name, name));
  }
  for (const name of [...new Set(photos.flatMap((p) => p.tags))].sort()) {
    tagSel.add(new Option(name, name));
  }
  const h = new URLSearchParams(location.hash.slice(1));
  eventSel.value = h.get("event") || "";
  tagSel.value = h.get("tag") || "";
  ratingSel.value = h.get("rating") || "0";
  render();
}

eventSel.onchange = tagSel.onchange = ratingSel.onchange = search.oninput = render;
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

async function save(url, filename, btn) {
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
        el.querySelector(".meta").textContent = [p.event, p.date, "★".repeat(p.rating), ...p.tags]
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

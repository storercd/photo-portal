import PhotoSwipeLightbox from "./vendor/photoswipe/photoswipe-lightbox.esm.min.js";

const params = new URLSearchParams(location.search);
const keep = params.has("local") ? "?local" : "";
const base = params.has("local") ? "/local" : window.PHOTO_BASE_URL || "/local";
// /portfolio lists the sections; /portfolio/<slug> shows one.
const slug = location.pathname.split("/").map(decodeURIComponent)[2] || "";
const list = document.getElementById("collections");
const grid = document.getElementById("grid");
const heading = document.getElementById("heading");

document.getElementById("title").href = `/portfolio${keep}`;

function showSections(sections) {
  list.hidden = false;
  list.replaceChildren(
    ...sections.map((s) => {
      const a = document.createElement("a");
      a.href = `/portfolio/${encodeURIComponent(s.slug)}${keep}`;
      a.innerHTML = '<img alt=""><div><strong></strong></div>';
      a.querySelector("img").src = `${base}/${s.cover}`;
      a.querySelector("strong").textContent = s.title;
      return a;
    }),
  );
}

function showSection(section) {
  document.title = `${section.title} · Portfolio`;
  heading.textContent = section.title;
  heading.hidden = false;
  grid.hidden = false;
  const photos = section.photos;
  grid.replaceChildren(
    ...photos.map((p, i) => {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.classList.add("pending");
      img.onload = img.onerror = () => img.classList.remove("pending");
      img.style.setProperty("--ar", p.width / p.height);
      img.src = `${base}/${p.thumb}`;
      img.alt = "";
      img.onclick = () => viewer.loadAndOpen(i, items);
      return img;
    }),
  );
  const items = photos.map((p, i) => {
    const scale = Math.min(1, 2000 / Math.max(p.width, p.height));
    return {
      src: `${base}/${p.web}`,
      width: Math.round(p.width * scale),
      height: Math.round(p.height * scale),
      msrc: `${base}/${p.thumb}`,
      alt: "",
      element: grid.children[i],
    };
  });
  const viewer = new PhotoSwipeLightbox({
    dataSource: items,
    pswpModule: () => import("./vendor/photoswipe/photoswipe.esm.min.js"),
    bgOpacity: 1,
    wheelToZoom: true,
  });
  viewer.init();
}

try {
  const res = await fetch(`${base}/portfolio.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(res.status);
  const { sections } = await res.json();
  const section = slug && sections.find((s) => s.slug === slug);
  if (section) showSection(section);
  else showSections(sections);
} catch {
  heading.textContent = "Portfolio unavailable";
  heading.hidden = false;
}

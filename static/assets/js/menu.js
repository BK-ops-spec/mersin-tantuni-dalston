import { add, count, getCart, subtotal, lines } from "./cart.js";
import { el, fmt, qs, qsa, toast, debounce } from "./site.js";

let MENU = null;
let activeFilter = "all";
let searchTerm = "";

const TAG_LABELS = {
  vegan: "Vegan",
  vegetarian: "Veg",
  spicy: "Spicy",
  age: "18+",
};

function tagNode(tag) {
  return el("span", `tag tag-${tag}`, TAG_LABELS[tag] || tag);
}

function addButton(item) {
  if (!item.orderable) {
    return el("span", "add-btn ask", "Ask us");
  }
  const button = el("button", "add-btn");
  button.type = "button";
  button.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.4"/></svg>';
  button.appendChild(document.createTextNode("Add"));
  button.addEventListener("click", () => {
    add(item.id, 1);
    toast(`${item.name} added to your order`);
  });
  return button;
}

function renderItem(item) {
  const row = el("div", "menu-item");
  row.dataset.id = item.id;

  const name = el("h3", "menu-item-name");
  name.appendChild(document.createTextNode(item.name));
  if (item.tags.length) {
    const tags = el("span", "tags");
    item.tags.forEach((tag) => tags.appendChild(tagNode(tag)));
    name.appendChild(tags);
  }

  const price = el(
    "span",
    "menu-item-price",
    item.price === null ? item.priceLabel || "Market price" : fmt(item.price),
  );

  const desc = el("p", "menu-item-desc", item.description);
  const actions = el("div", "menu-item-actions");
  actions.appendChild(addButton(item));

  row.append(name, price, desc, actions);
  return row;
}

function renderSection(category, items) {
  const section = el("section", "menu-section");
  section.id = `cat-${category.id}`;
  section.dataset.category = category.id;

  const head = el("div", "menu-section-head");
  const intro = el("div", "menu-section-intro");

  if (category.image) {
    const media = el("div", "cat-img");
    const img = new Image();
    img.src = `/assets/img/${category.image}.webp`;
    img.alt = category.name;
    img.loading = "lazy";
    media.appendChild(img);
    intro.appendChild(media);
  } else {
    const media = el("div", "cat-img no-img");
    media.appendChild(el("span", "cat-monogram", "MT"));
    intro.appendChild(media);
  }

  const copy = el("div");
  copy.appendChild(el("span", "eyebrow", category.eyebrow));
  copy.appendChild(el("h2", "", category.name));
  if (category.note) copy.appendChild(el("p", "", category.note));
  intro.appendChild(copy);
  head.appendChild(intro);

  const grid = el("div", "menu-items");
  items.forEach((item) => grid.appendChild(renderItem(item)));
  head.appendChild(grid);
  section.appendChild(head);
  return section;
}

function matches(item) {
  if (activeFilter !== "all" && !item.tags.includes(activeFilter)) return false;
  if (!searchTerm) return true;
  const haystack = `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
  return haystack.includes(searchTerm);
}

function applyFilters() {
  qsa(".menu-section").forEach((section) => {
    const items = qsa(".menu-item", section);
    let visible = 0;
    items.forEach((row) => {
      const id = row.dataset.id;
      const item = MENU.items.find((entry) => entry.id === id);
      const show = item ? matches(item) : true;
      row.hidden = !show;
      if (show) visible += 1;
    });
    section.hidden = visible === 0;
  });
}

function buildCategoryNav() {
  const wrap = qs("#menu-cats");
  if (!wrap) return;
  const all = el("button", "cat-chip active", "All");
  all.type = "button";
  all.addEventListener("click", () => {
    qsa(".cat-chip").forEach((chip) => chip.classList.remove("active"));
    all.classList.add("active");
    window.scrollTo({ top: qs("#menu-start").offsetTop - 130, behavior: "smooth" });
  });
  wrap.appendChild(all);

  MENU.categories.forEach((category) => {
    const button = el("button", "cat-chip", category.name);
    button.type = "button";
    button.addEventListener("click", () => {
      qsa(".cat-chip").forEach((chip) => chip.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(`cat-${category.id}`)?.scrollIntoView({ behavior: "smooth" });
    });
    wrap.appendChild(button);
  });
}

function updateCartBar() {
  const bar = qs("#cart-bar");
  if (!bar || !MENU) return;
  const total = count();
  if (!total) {
    bar.classList.remove("is-visible");
    return;
  }
  bar.classList.add("is-visible");
  qs("#cart-count", bar).textContent = String(total);
  qs("#cart-total", bar).textContent = fmt(subtotal(MENU));
  const lineCount = lines(MENU).length;
  qs("#cart-label", bar).textContent =
    lineCount === 1 ? "1 dish in your order" : `${lineCount} dishes in your order`;
}

function render() {
  const mount = qs("#menu-sections");
  if (!mount || !MENU) return;
  mount.innerHTML = "";

  MENU.categories.forEach((category) => {
    const items = MENU.items.filter((item) => item.category === category.id);
    if (items.length) mount.appendChild(renderSection(category, items));
  });

  buildCategoryNav();
  applyFilters();
  updateCartBar();
}

function initControls() {
  const search = qs("#menu-search");
  if (search) {
    search.addEventListener(
      "input",
      debounce(() => {
        searchTerm = search.value.trim().toLowerCase();
        applyFilters();
      }, 140),
    );
  }

  qsa("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      qsa("[data-filter]").forEach((chip) => chip.classList.remove("active"));
      button.classList.add("active");
      applyFilters();
    });
  });
}

async function boot() {
  initControls();
  window.addEventListener("mt:cart", updateCartBar);
  try {
    const response = await fetch("/assets/menu.json");
    if (!response.ok) throw new Error("Menu unavailable");
    MENU = await response.json();
    render();
  } catch (error) {
    const mount = qs("#menu-sections");
    if (mount) {
      mount.innerHTML =
        '<div class="admin-empty">The menu could not be loaded. Please refresh or call us on 020 7923 3797.</div>';
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

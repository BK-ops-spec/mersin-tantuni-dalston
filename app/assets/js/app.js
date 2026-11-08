/* Mersin ordering app — installable PWA. */

const CART_KEY = "mt_app_cart_v1";
const CUSTOMER_KEY = "mt_app_customer_v1";
const TYPE_KEY = "mt_app_order_type";
const MENU_CACHE = "mt_app_menu_v1";
const DISMISS_KEY = "mt_app_install_dismissed";

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const fmt = (value) => money.format(Number(value) || 0);

const state = {
  menu: null,
  type: localStorage.getItem(TYPE_KEY) === "delivery" ? "delivery" : "collection",
  cat: "popular",
  search: "",
  view: "menu",
  submittingOrder: false,
  submittingRes: false,
  deferredPrompt: null,
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const TAG_LABELS = { vegan: "Vegan", vegetarian: "Veg", spicy: "Spicy", age: "18+" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

let toastTimer;
function toast(message) {
  const node = $("#app-toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("is-visible"), 2400);
}

function debounce(fn, wait = 160) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ---------------- Cart ---------------- */
function readCart() {
  try {
    const value = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeCart(cart) {
  const clean = {};
  Object.entries(cart).forEach(([id, qty]) => {
    const n = Number(qty);
    if (Number.isFinite(n) && n > 0) clean[id] = Math.min(20, Math.round(n));
  });
  localStorage.setItem(CART_KEY, JSON.stringify(clean));
  renderBadge();
  renderCart();
}

function cartCount() {
  return Object.values(readCart()).reduce((sum, qty) => sum + Number(qty || 0), 0);
}

function cartLines() {
  if (!state.menu) return [];
  const map = new Map(state.menu.items.map((item) => [item.id, item]));
  return Object.entries(readCart())
    .map(([id, qty]) => ({ item: map.get(id), qty }))
    .filter((line) => line.item);
}

function cartSubtotal() {
  return cartLines().reduce((sum, line) => sum + line.item.price * line.qty, 0);
}

function cartTotals() {
  const sub = cartSubtotal();
  let fee = 0;
  if (state.type === "delivery" && sub > 0) {
    fee = sub >= state.menu.restaurant.freeDeliveryOver ? 0 : state.menu.restaurant.deliveryFee;
  }
  return {
    subtotal: sub,
    fee,
    total: sub + fee,
    deliveryMin: state.menu.restaurant.deliveryMin,
    freeDeliveryOver: state.menu.restaurant.freeDeliveryOver,
  };
}

function addToCart(id) {
  const cart = readCart();
  cart[id] = Math.min(20, (Number(cart[id]) || 0) + 1);
  writeCart(cart);
}

function setQty(id, qty) {
  const cart = readCart();
  if (qty <= 0) delete cart[id];
  else cart[id] = Math.min(20, qty);
  writeCart(cart);
}

function removeLine(id) {
  const cart = readCart();
  delete cart[id];
  writeCart(cart);
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  renderBadge();
  renderCart();
}

function hasCollectionOnly() {
  return cartLines().some((line) => line.item.collectionOnly);
}

/* ---------------- Customer ---------------- */
function getCustomer() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCustomer(customer) {
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
}

/* ---------------- Views ---------------- */
function switchView(view) {
  state.view = view;
  $$(".view").forEach((section) => {
    section.classList.toggle("is-active", section.dataset.view === view);
  });
  $$(".app-tabbar [data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  window.scrollTo({ top: 0, behavior: "auto" });
  if (view === "cart") renderCart();
  if (view === "reserve") ensureReservationForm();
}

function renderBadge() {
  const badge = $("#tab-badge");
  if (!badge) return;
  const count = cartCount();
  badge.textContent = String(count);
  badge.classList.toggle("is-on", count > 0);
}

/* ---------------- Menu ---------------- */
function matchesSearch(item) {
  if (!state.search) return true;
  return `${item.name} ${item.description} ${item.tags.join(" ")}`
    .toLowerCase()
    .includes(state.search);
}

function visibleItems() {
  if (!state.menu) return [];
  if (state.search) return state.menu.items.filter(matchesSearch);
  if (state.cat === "all") return state.menu.items;
  if (state.cat === "popular") return state.menu.items.filter((item) => item.featured);
  return state.menu.items.filter((item) => item.category === state.cat);
}

function tagsNode(item) {
  if (!item.tags.length) return null;
  const wrap = el("span", "app-tags");
  item.tags.forEach((tag) =>
    wrap.appendChild(el("span", `app-tag app-tag-${tag}`, TAG_LABELS[tag] || tag)),
  );
  return wrap;
}

function menuItemRow(item, showCategory) {
  const row = el("article", "app-item");

  const media = el("div", "app-item-img");
  if (item.image) {
    const img = new Image();
    img.src = `assets/img/${item.image}.webp`;
    img.alt = "";
    img.loading = "lazy";
    media.appendChild(img);
  } else {
    media.classList.add("no-img");
    media.appendChild(el("span", "", "M"));
  }
  row.appendChild(media);

  const body = el("div", "app-item-body");
  if (showCategory) {
    body.appendChild(el("span", "app-item-cat", state.menu.categories.find((c) => c.id === item.category)?.eyebrow || ""));
  }

  const top = el("div", "app-item-top");
  const name = el("h3", "app-item-name");
  name.appendChild(document.createTextNode(item.name));
  const tags = tagsNode(item);
  if (tags) name.appendChild(tags);
  top.appendChild(name);
  top.appendChild(
    el("span", "app-price", item.price === null ? item.priceLabel || "Market" : fmt(item.price)),
  );
  body.appendChild(top);

  body.appendChild(el("p", "app-item-desc", item.description));

  const foot = el("div", "app-item-foot");
  if (item.collectionOnly) foot.appendChild(el("span", "app-collection-note", "Collection only"));
  if (!item.orderable) {
    foot.appendChild(el("span", "app-add app-add-ask", "Ask us"));
  } else {
    const button = el("button", "app-add", "+");
    button.type = "button";
    button.setAttribute("aria-label", `Add ${item.name}`);
    button.addEventListener("click", () => {
      addToCart(item.id);
      toast(`${item.name} added`);
    });
    foot.appendChild(button);
  }
  body.appendChild(foot);
  row.appendChild(body);
  return row;
}

function renderChips() {
  const wrap = $("#app-chips");
  if (!wrap || !state.menu) return;
  wrap.innerHTML = "";
  const chips = [
    { id: "popular", name: "Popular" },
    { id: "all", name: "All" },
    ...state.menu.categories.map((category) => ({ id: category.id, name: category.name })),
  ];
  chips.forEach((chip) => {
    const button = el("button", `app-chip${chip.id === state.cat ? " active" : ""}`, chip.name);
    button.type = "button";
    button.addEventListener("click", () => {
      state.cat = chip.id;
      $$("#app-chips .app-chip").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      renderMenu();
    });
    wrap.appendChild(button);
  });
}

function renderMenu() {
  const list = $("#app-menu-list");
  if (!list || !state.menu) return;
  list.innerHTML = "";
  const items = visibleItems();

  if (!items.length) {
    const empty = el("div", "app-empty");
    empty.appendChild(el("strong", "", "Nothing matches that."));
    empty.appendChild(el("span", "", "Try another word or pick a section above."));
    list.appendChild(empty);
    return;
  }

  const showCategory = state.cat === "all" || Boolean(state.search);
  let currentCategory = null;
  items.forEach((item) => {
    if (showCategory && item.category !== currentCategory) {
      currentCategory = item.category;
      const category = state.menu.categories.find((entry) => entry.id === currentCategory);
      const label = el("div", "app-section-label");
      label.appendChild(el("span", "", category?.eyebrow || ""));
      label.appendChild(el("strong", "", category?.name || ""));
      list.appendChild(label);
    }
    list.appendChild(menuItemRow(item, false));
  });
}

/* ---------------- Type / totals ---------------- */
function paymentOptions(type) {
  return type === "delivery"
    ? [
        ["pay_on_delivery", "Pay on delivery (cash or card)"],
        ["card_on_delivery", "Card on delivery"],
      ]
    : [
        ["pay_on_collection", "Pay on collection (cash or card)"],
        ["card_on_collection", "Card on collection"],
      ];
}

function updatePayment() {
  const select = $("#app-payment");
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  paymentOptions(state.type).forEach(([value, text]) => select.appendChild(new Option(text, value)));
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function setType(type) {
  state.type = type === "delivery" ? "delivery" : "collection";
  localStorage.setItem(TYPE_KEY, state.type);
  $$("[data-app-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.appType === state.type);
  });
  $$("[data-delivery-field]").forEach((field) => {
    field.hidden = state.type !== "delivery";
    field.querySelectorAll("input").forEach((input) => {
      input.required = state.type === "delivery";
    });
  });
  updatePayment();
  renderCart();
}

/* ---------------- Cart view ---------------- */
function renderCart() {
  if (!state.menu) return;
  renderBadge();
  const list = $("#app-cart-lines");
  const totalsWrap = $("#app-cart-totals");
  const warning = $("#app-cart-warning");
  const submit = $("#app-order-submit");
  if (!list || !totalsWrap || !warning || !submit) return;

  const lines = cartLines();
  list.innerHTML = "";

  if (!lines.length) {
    const empty = el("div", "app-empty app-empty-cart");
    empty.appendChild(el("strong", "", "Your order is empty."));
    empty.appendChild(el("span", "", "Add a few dishes from the menu to begin."));
    const button = el("button", "app-btn", "Browse the menu");
    button.type = "button";
    button.addEventListener("click", () => switchView("menu"));
    empty.appendChild(button);
    list.appendChild(empty);
  } else {
    lines.forEach(({ item, qty }) => {
      const line = el("div", "app-cart-line");
      const copy = el("div", "app-cart-copy");
      copy.appendChild(el("strong", "", item.name));
      if (item.collectionOnly) copy.appendChild(el("small", "", "18+ · collection only"));
      copy.appendChild(el("span", "", fmt(item.price * qty)));
      line.appendChild(copy);

      const controls = el("div", "app-qty");
      const minus = el("button", "", "−");
      minus.type = "button";
      minus.addEventListener("click", () => setQty(item.id, qty - 1));
      const value = el("span", "", String(qty));
      const plus = el("button", "", "+");
      plus.type = "button";
      plus.addEventListener("click", () => setQty(item.id, qty + 1));
      const remove = el("button", "app-remove", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${item.name}`);
      remove.addEventListener("click", () => removeLine(item.id));
      controls.append(minus, value, plus, remove);
      line.appendChild(controls);
      list.appendChild(line);
    });
  }

  const t = cartTotals();
  totalsWrap.innerHTML = `
    <div class="app-total-row"><span>Subtotal</span><strong>${fmt(t.subtotal)}</strong></div>
    <div class="app-total-row"><span>${state.type === "delivery" ? "Delivery" : "Collection"}</span><strong>${
      state.type === "delivery" ? (t.fee ? fmt(t.fee) : "Free") : "Free"
    }</strong></div>
    <div class="app-total-row grand"><span>Total</span><strong>${fmt(t.total)}</strong></div>
    <p class="app-fine">${
      state.type === "delivery"
        ? `Delivery minimum ${fmt(t.deliveryMin)} · free over ${fmt(t.freeDeliveryOver)}`
        : "Collect from 11 Stoke Newington Road, N16 8BH."
    }</p>
  `;

  let message = "";
  if (state.type === "delivery" && lines.length && t.subtotal < t.deliveryMin) {
    message = `Delivery starts at ${fmt(t.deliveryMin)}. Add ${fmt(t.deliveryMin - t.subtotal)} more, or switch to collection.`;
  } else if (state.type === "delivery" && hasCollectionOnly()) {
    message = "Beer, wine and rakı are collection only. Remove the 18+ items to order delivery.";
  }
  warning.textContent = message;
  warning.classList.toggle("is-visible", Boolean(message));

  submit.disabled = !lines.length || Boolean(message) || state.submittingOrder;
}

/* ---------------- Order form ---------------- */
function setFormError(id, message) {
  const box = $(id);
  if (!box) return;
  box.textContent = message || "";
  box.classList.toggle("is-visible", Boolean(message));
}

function readOrderForm() {
  return {
    name: $("#app-name").value.trim(),
    phone: $("#app-phone").value.trim(),
    email: $("#app-email").value.trim(),
    address: $("#app-address").value.trim(),
    postcode: $("#app-postcode").value.trim().toUpperCase(),
    timing: $("#app-timing").value,
    scheduledAt: $("#app-scheduled-at").value,
    notes: $("#app-notes").value.trim(),
    payment: $("#app-payment").value,
  };
}

function validateOrder(values) {
  const t = cartTotals();
  if (!cartLines().length) return "Your order is empty.";
  if (values.name.length < 2) return "Please enter your name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) return "Please enter a valid email address.";
  if (values.phone.replace(/\D/g, "").length < 7) return "Please enter a valid phone number.";
  if (state.type === "delivery") {
    if (values.address.length < 5) return "Please enter your delivery address.";
    if (values.postcode.length < 4) return "Please enter your postcode.";
    if (t.subtotal < t.deliveryMin) return `Delivery starts at ${fmt(t.deliveryMin)}.`;
    if (hasCollectionOnly()) return "Alcohol is collection only. Remove 18+ items or switch to collection.";
  }
  if (values.timing === "scheduled") {
    if (!values.scheduledAt) return "Please choose a time for your order.";
    if (new Date(values.scheduledAt).getTime() < Date.now()) return "Please choose a future time.";
  }
  return "";
}

async function submitOrder(event) {
  event.preventDefault();
  if (state.submittingOrder) return;
  setFormError("#app-order-error", "");

  const values = readOrderForm();
  const problem = validateOrder(values);
  if (problem) {
    setFormError("#app-order-error", problem);
    return;
  }

  const payload = {
    order_type: state.type,
    name: values.name,
    email: values.email,
    phone: values.phone,
    address: state.type === "delivery" ? values.address : "",
    postcode: state.type === "delivery" ? values.postcode : "",
    items: cartLines().map(({ item, qty }) => ({ id: item.id, qty })),
    notes: values.notes,
    requested_time:
      values.timing === "scheduled" ? new Date(values.scheduledAt).toISOString() : "asap",
    payment_method: values.payment,
  };

  state.submittingOrder = true;
  const button = $("#app-order-submit");
  const original = button.textContent;
  button.textContent = "Sending…";
  button.disabled = true;

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "We could not send your order. Please call 020 7923 3797.");
    }

    saveCustomer({
      name: values.name,
      email: values.email,
      phone: values.phone,
      address: values.address,
      postcode: values.postcode,
    });

    showOrderConfirmation(data, payload);
    clearCart();
  } catch (error) {
    setFormError("#app-order-error", error.message);
  } finally {
    state.submittingOrder = false;
    button.textContent = original;
    button.disabled = false;
    renderCart();
  }
}

function showOrderConfirmation(data, payload) {
  const panel = $("#app-order-panel");
  const box = $("#app-order-confirmation");
  if (!panel || !box) return;
  panel.hidden = true;

  const requested =
    payload.requested_time === "asap"
      ? "As soon as possible"
      : new Date(payload.requested_time).toLocaleString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });

  box.innerHTML = `
    <div class="app-confirm-seal">✓</div>
    <span class="app-eyebrow">Request received</span>
    <h2>Thank you, ${escapeHtml(payload.name.split(" ")[0])}.</h2>
    <div class="app-ref">${escapeHtml(data.reference)}</div>
    <p>Your ${payload.order_type} request is with the restaurant. We will call you on ${escapeHtml(
      payload.phone,
    )} to confirm.</p>
    <div class="app-summary">
      <div><span>Order</span><strong>${payload.order_type === "delivery" ? "Delivery" : "Collection"}</strong></div>
      <div><span>Requested</span><strong>${escapeHtml(requested)}</strong></div>
      <div><span>Total</span><strong>${fmt(data.total)}</strong></div>
      <div><span>Status</span><strong>Awaiting confirmation</strong></div>
    </div>
    <div class="app-confirm-actions">
      <a class="app-btn" href="tel:+442079233797">Call the restaurant</a>
      <button class="app-btn app-btn-outline" type="button" data-go-menu>Back to the menu</button>
    </div>
  `;
  box.hidden = false;
  box.classList.add("is-visible");
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- Reservation ---------------- */
function pad(n) {
  return String(n).padStart(2, "0");
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildTimeSlots() {
  const select = $("#app-res-time");
  const dateInput = $("#app-res-date");
  if (!select || !dateInput) return;
  const now = new Date();
  const isToday = dateInput.value === isoDate(now);
  const current = now.getHours() * 60 + now.getMinutes();
  select.innerHTML = "";
  for (let minutes = 12 * 60; minutes <= 23 * 60; minutes += 30) {
    if (isToday && minutes <= current + 30) continue;
    const value = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    select.appendChild(new Option(value, value));
  }
  if (!select.options.length) select.appendChild(new Option("No times left today", ""));
}

let reservationReady = false;
function ensureReservationForm() {
  if (reservationReady || !state.menu) return;
  reservationReady = true;

  const date = $("#app-res-date");
  const now = new Date();
  const max = new Date(now);
  max.setFullYear(max.getFullYear() + 1);
  date.min = isoDate(now);
  date.max = isoDate(max);
  date.value = isoDate(now);
  date.addEventListener("change", buildTimeSlots);

  const party = $("#app-res-party");
  for (let size = 1; size <= 20; size += 1) {
    party.appendChild(new Option(size === 1 ? "1 guest" : `${size} guests`, String(size)));
  }
  party.appendChild(new Option("More than 20 (we will call)", "21"));
  party.value = "2";

  buildTimeSlots();

  const customer = getCustomer();
  if (customer.name) $("#app-res-name").value = customer.name;
  if (customer.email) $("#app-res-email").value = customer.email;
  if (customer.phone) $("#app-res-phone").value = customer.phone;

  $("#app-res-form").addEventListener("submit", submitReservation);
}

async function submitReservation(event) {
  event.preventDefault();
  if (state.submittingRes) return;
  setFormError("#app-res-error", "");

  const values = {
    name: $("#app-res-name").value.trim(),
    email: $("#app-res-email").value.trim(),
    phone: $("#app-res-phone").value.trim(),
    date: $("#app-res-date").value,
    time: $("#app-res-time").value,
    party: Number($("#app-res-party").value || 0),
    notes: $("#app-res-notes").value.trim(),
    occasion: "",
  };

  let problem = "";
  if (values.name.length < 2) problem = "Please enter your name.";
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) problem = "Please enter a valid email address.";
  else if (values.phone.replace(/\D/g, "").length < 7) problem = "Please enter a valid phone number.";
  else if (!values.time) problem = "Please choose a time.";
  else if (!values.party) problem = "Please choose your party size.";
  else {
    const chosen = new Date(`${values.date}T${values.time}:00`);
    if (Number.isNaN(chosen.getTime()) || chosen.getTime() < Date.now()) {
      problem = "Please choose a future date and time.";
    }
  }

  if (problem) {
    setFormError("#app-res-error", problem);
    return;
  }

  state.submittingRes = true;
  const button = $("#app-res-submit");
  const original = button.textContent;
  button.textContent = "Sending…";
  button.disabled = true;

  try {
    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "We could not send your request. Please call 020 7923 3797.");
    }
    saveCustomer({ name: values.name, email: values.email, phone: values.phone });
    showReservationConfirmation(data, values);
  } catch (error) {
    setFormError("#app-res-error", error.message);
  } finally {
    state.submittingRes = false;
    button.textContent = original;
    button.disabled = false;
  }
}

function showReservationConfirmation(data, values) {
  const panel = $("#app-res-panel");
  const box = $("#app-res-confirmation");
  if (!panel || !box) return;
  panel.hidden = true;

  const date = new Date(`${values.date}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  box.innerHTML = `
    <div class="app-confirm-seal">✓</div>
    <span class="app-eyebrow">Request received</span>
    <h2>Thank you, ${escapeHtml(values.name.split(" ")[0])}.</h2>
    <div class="app-ref">${escapeHtml(data.reference)}</div>
    <p>We will confirm your table by phone or email shortly.</p>
    <div class="app-summary">
      <div><span>Date</span><strong>${escapeHtml(date)}</strong></div>
      <div><span>Time</span><strong>${escapeHtml(values.time)}</strong></div>
      <div><span>Party</span><strong>${values.party === 21 ? "More than 20" : `${values.party} ${values.party === 1 ? "guest" : "guests"}`}</strong></div>
      <div><span>Status</span><strong>Awaiting confirmation</strong></div>
    </div>
    <div class="app-confirm-actions">
      <a class="app-btn" href="tel:+442079233797">Call the restaurant</a>
      <button class="app-btn app-btn-outline" type="button" data-go-menu>Back to the menu</button>
    </div>
  `;
  box.hidden = false;
  box.classList.add("is-visible");
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- Install ---------------- */
function standalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function showInstallHelp() {
  const dialog = $("#install-help");
  if (dialog?.showModal) dialog.showModal();
}

async function install() {
  if (state.deferredPrompt) {
    state.deferredPrompt.prompt();
    const choice = await state.deferredPrompt.userChoice;
    if (choice.outcome === "accepted") toast("Installing Mersin");
    state.deferredPrompt = null;
    return;
  }
  showInstallHelp();
}

function setupInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredPrompt = event;
    $("#install-btn").hidden = false;
    if (localStorage.getItem(DISMISS_KEY) !== "1" && !standalone()) {
      $("#install-banner").hidden = false;
    }
  });

  window.addEventListener("appinstalled", () => {
    $("#install-banner").hidden = true;
    $("#install-btn").hidden = true;
    toast("Mersin installed");
  });

  $("#install-btn")?.addEventListener("click", install);
  $("#install-info-btn")?.addEventListener("click", install);
  $("#install-banner-btn")?.addEventListener("click", install);
  $("#install-banner-close")?.addEventListener("click", () => {
    $("#install-banner").hidden = true;
    localStorage.setItem(DISMISS_KEY, "1");
  });

  $$("#install-help .app-dialog-close").forEach((button) =>
    button.addEventListener("click", () => $("#install-help").close()),
  );
  $("#install-help")?.addEventListener("click", (event) => {
    if (event.target.id === "install-help") event.target.close();
  });

  if (standalone()) $("#install-banner").hidden = true;
}

/* ---------------- Boot ---------------- */
function applyLaunchQuery() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type");
  if (type === "collection" || type === "delivery") {
    state.type = type;
    localStorage.setItem(TYPE_KEY, type);
  }
  const view = params.get("view");
  if (view === "reserve" || view === "cart" || view === "menu") state.view = view;
}

async function loadMenu() {
  try {
    const response = await fetch("assets/menu.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Menu unavailable");
    const menu = await response.json();
    localStorage.setItem(MENU_CACHE, JSON.stringify(menu));
    return menu;
  } catch {
    try {
      const cached = JSON.parse(localStorage.getItem(MENU_CACHE) || "null");
      if (cached) return cached;
    } catch {
      /* ignore */
    }
    return null;
  }
}

function setupOrderForm() {
  const customer = getCustomer();
  if (customer.name) $("#app-name").value = customer.name;
  if (customer.email) $("#app-email").value = customer.email;
  if (customer.phone) $("#app-phone").value = customer.phone;
  if (customer.address) $("#app-address").value = customer.address;
  if (customer.postcode) $("#app-postcode").value = customer.postcode;

  const now = new Date();
  const min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
  $("#app-scheduled-at").min = min;

  $("#app-timing").addEventListener("change", (event) => {
    const wrap = $("#app-schedule-field");
    const scheduled = event.target.value === "scheduled";
    wrap.hidden = !scheduled;
    $("#app-scheduled-at").required = scheduled;
  });

  $("#app-order-form").addEventListener("submit", submitOrder);
}

function setupNav() {
  $$(".app-tabbar [data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $$("[data-app-type]").forEach((button) => {
    button.addEventListener("click", () => setType(button.dataset.appType));
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-go-menu]")) {
      $("#app-order-confirmation").hidden = true;
      $("#app-order-panel").hidden = false;
      $("#app-res-confirmation").hidden = true;
      $("#app-res-panel").hidden = false;
      switchView("menu");
    }
  });

  $("#clear-data-btn")?.addEventListener("click", () => {
    localStorage.removeItem(CUSTOMER_KEY);
    localStorage.removeItem(CART_KEY);
    [
      "#app-name",
      "#app-phone",
      "#app-email",
      "#app-address",
      "#app-postcode",
      "#app-res-name",
      "#app-res-phone",
      "#app-res-email",
      "#app-notes",
      "#app-res-notes",
    ].forEach((selector) => {
      const input = $(selector);
      if (input) input.value = "";
    });
    renderBadge();
    renderCart();
    toast("Saved details cleared");
  });
}

function setupSearch() {
  $("#app-search")?.addEventListener(
    "input",
    debounce((event) => {
      state.search = event.target.value.trim().toLowerCase();
      renderMenu();
    }, 140),
  );
}

async function boot() {
  applyLaunchQuery();
  setupNav();
  setupInstall();
  setupSearch();
  setupOrderForm();

  state.menu = await loadMenu();
  if (!state.menu) {
    $("#app-menu-list").innerHTML =
      '<div class="app-empty"><strong>The menu could not load.</strong><span>Check your connection, or call 020 7923 3797.</span></div>';
    return;
  }

  setType(state.type);
  renderChips();
  renderMenu();
  renderBadge();

  if (state.view !== "menu") switchView(state.view);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

boot();

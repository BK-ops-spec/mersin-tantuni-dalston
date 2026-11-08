import {
  add,
  clear,
  getCart,
  getCustomer,
  getOrderType,
  hasCollectionOnly,
  lines,
  remove,
  saveCustomer,
  setOrderType,
  setQty,
  totals,
} from "./cart.js";
import { debounce, el, fmt, qs, qsa, toast } from "./site.js";

let MENU = null;
let activeCat = "popular";
let searchTerm = "";
let submitting = false;

const TAG_LABELS = { vegan: "Vegan", vegetarian: "Veg", spicy: "Spicy", age: "18+" };
const CATEGORY_NAMES = new Map();

function tagsNode(item) {
  if (!item.tags.length) return null;
  const wrap = el("span", "tags");
  item.tags.forEach((tag) => wrap.appendChild(el("span", `tag tag-${tag}`, TAG_LABELS[tag] || tag)));
  return wrap;
}

function itemImage(item, className) {
  const box = el("div", className);
  if (item.image) {
    const img = new Image();
    img.src = `/assets/img/${item.image}.webp`;
    img.alt = "";
    img.loading = "lazy";
    box.appendChild(img);
  } else {
    box.classList.add("no-img");
    box.appendChild(el("span", "cat-monogram", "MT"));
  }
  return box;
}

function addButton(item) {
  if (!item.orderable) return el("span", "add-btn ask", "Ask us");
  const button = el("button", "add-btn");
  button.type = "button";
  button.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.4"/></svg>';
  button.appendChild(document.createTextNode("Add"));
  button.addEventListener("click", () => {
    add(item.id, 1);
    toast(`${item.name} added`);
  });
  return button;
}

function orderRow(item, showCategory) {
  const row = el("div", "order-item");
  row.appendChild(itemImage(item, "order-item-img"));

  const copy = el("div", "order-item-copy");
  if (showCategory) {
    copy.appendChild(el("span", "order-item-cat", CATEGORY_NAMES.get(item.category) || ""));
  }
  const name = el("h3", "order-item-name");
  name.appendChild(document.createTextNode(item.name));
  const tags = tagsNode(item);
  if (tags) name.appendChild(tags);
  copy.appendChild(name);
  copy.appendChild(el("p", "order-item-desc", item.description));
  row.appendChild(copy);

  const right = el("div", "order-item-right");
  right.appendChild(
    el(
      "span",
      "order-item-price",
      item.price === null ? item.priceLabel || "Market price" : fmt(item.price),
    ),
  );
  right.appendChild(addButton(item));
  row.appendChild(right);
  return row;
}

function matchesSearch(item) {
  if (!searchTerm) return true;
  return `${item.name} ${item.description} ${item.tags.join(" ")}`
    .toLowerCase()
    .includes(searchTerm);
}

function visibleItems() {
  if (searchTerm) return MENU.items.filter(matchesSearch);
  if (activeCat === "all") return MENU.items;
  if (activeCat === "popular") return MENU.items.filter((item) => item.featured);
  return MENU.items.filter((item) => item.category === activeCat);
}

function renderList() {
  const list = qs("#order-list");
  if (!list) return;
  list.innerHTML = "";
  const items = visibleItems();

  if (!items.length) {
    list.appendChild(
      el("div", "admin-empty", "No dishes match that search. Try another word."),
    );
    return;
  }

  const showCategory = activeCat === "all" || searchTerm;
  items.forEach((item) => list.appendChild(orderRow(item, showCategory)));
}

function buildCats() {
  const wrap = qs("#order-cats");
  if (!wrap) return;
  wrap.innerHTML = "";

  const chips = [
    { id: "popular", name: "Popular" },
    { id: "all", name: "All" },
    ...MENU.categories.map((category) => ({ id: category.id, name: category.name })),
  ];

  chips.forEach((chip) => {
    const button = el("button", `cat-chip${chip.id === activeCat ? " active" : ""}`, chip.name);
    button.type = "button";
    button.addEventListener("click", () => {
      activeCat = chip.id;
      qsa("#order-cats .cat-chip").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      renderList();
    });
    wrap.appendChild(button);
  });
}

function currentType() {
  return getOrderType();
}

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

function updatePaymentOptions() {
  const select = qs("#payment-method");
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  paymentOptions(currentType()).forEach(([value, label]) => {
    const option = new Option(label, value);
    select.appendChild(option);
  });
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

function updateTypeUI() {
  const type = currentType();
  qsa("[data-order-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.orderType === type);
  });
  const label = qs("#summary-type");
  if (label) label.textContent = type === "delivery" ? "Delivery" : "Collection";

  qsa("[data-delivery-field]").forEach((field) => {
    field.hidden = type !== "delivery";
    field.querySelectorAll("input").forEach((input) => {
      input.required = type === "delivery";
    });
  });

  updatePaymentOptions();
  renderSummary();
}

function renderSummary() {
  if (!MENU) return;
  const type = currentType();
  const cartLines = lines(MENU);
  const list = qs("#cart-lines");
  const totalsWrap = qs("#cart-totals");
  const warning = qs("#summary-warning");
  const submit = qs("#order-submit");
  if (!list || !totalsWrap) return;

  list.innerHTML = "";
  if (!cartLines.length) {
    list.appendChild(el("div", "cart-empty", "Your order is empty. Add a dish from the menu to begin."));
  } else {
    cartLines.forEach(({ item, qty }) => {
      const line = el("div", "cart-line");
      const name = el("div", "cart-line-name");
      name.appendChild(document.createTextNode(item.name));
      if (item.collectionOnly) name.appendChild(el("small", "", "18+ · collection only"));
      const price = el("div", "cart-line-price", fmt(item.price * qty));
      const controls = el("div", "cart-line-controls");

      const qtyWrap = el("div", "qty");
      const minus = el("button", "", "−");
      minus.type = "button";
      minus.setAttribute("aria-label", `Reduce ${item.name}`);
      minus.addEventListener("click", () => setQty(item.id, qty - 1));
      const value = el("span", "", String(qty));
      const plus = el("button", "", "+");
      plus.type = "button";
      plus.setAttribute("aria-label", `Add another ${item.name}`);
      plus.addEventListener("click", () => setQty(item.id, qty + 1));
      qtyWrap.append(minus, value, plus);

      const removeBtn = el("button", "cart-line-remove", "Remove");
      removeBtn.type = "button";
      removeBtn.addEventListener("click", () => remove(item.id));

      controls.append(qtyWrap, removeBtn);
      line.append(name, price, controls);
      list.appendChild(line);
    });
  }

  const t = totals(MENU, type);
  totalsWrap.innerHTML = `
    <div class="total-row"><span>Subtotal</span><strong>${fmt(t.subtotal)}</strong></div>
    <div class="total-row"><span>${type === "delivery" ? "Delivery" : "Collection"}</span><strong>${
      type === "delivery" ? (t.fee ? fmt(t.fee) : "Free") : "Free"
    }</strong></div>
    <div class="total-row grand"><span>Total</span><strong>${fmt(t.total)}</strong></div>
    <div class="summary-note">${
      type === "delivery"
        ? `Delivery minimum ${fmt(t.deliveryMin)} · Free delivery over ${fmt(t.freeDeliveryOver)}`
        : "Collection from 11 Stoke Newington Road, N16 8BH."
    }</div>
  `;

  let message = "";
  if (type === "delivery" && cartLines.length && t.subtotal < t.deliveryMin) {
    message = `Delivery orders start at ${fmt(t.deliveryMin)}. Add ${fmt(
      t.deliveryMin - t.subtotal,
    )} more, or switch to collection.`;
  } else if (type === "delivery" && hasCollectionOnly(MENU)) {
    message = "Beer, wine and rakı are collection only. Remove the 18+ items to order delivery.";
  }

  if (warning) {
    warning.textContent = message;
    warning.classList.toggle("is-visible", Boolean(message));
  }

  if (submit) {
    submit.disabled = !cartLines.length || Boolean(message) || submitting;
  }
}

function setError(message) {
  const box = qs("#order-error");
  if (!box) return;
  box.textContent = message || "";
  box.classList.toggle("is-visible", Boolean(message));
}

function validate(values, t) {
  if (!lines(MENU).length) return "Your order is empty.";
  if (!values.name || values.name.trim().length < 2) return "Please enter your name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) return "Please enter a valid email address.";
  const phoneDigits = values.phone.replace(/\D/g, "");
  if (phoneDigits.length < 7) return "Please enter a valid phone number.";

  const type = currentType();
  if (type === "delivery") {
    if (!values.address || values.address.trim().length < 5) return "Please enter your delivery address.";
    if (!values.postcode || values.postcode.trim().length < 4) return "Please enter your postcode.";
    if (t.subtotal < t.deliveryMin) return `Delivery orders start at ${fmt(t.deliveryMin)}.`;
    if (hasCollectionOnly(MENU)) return "Alcohol is collection only. Please remove 18+ items or switch to collection.";
  }

  if (values.requestedMode === "scheduled") {
    if (!values.scheduledAt) return "Please choose a time for your order.";
    if (new Date(values.scheduledAt).getTime() < Date.now()) return "Please choose a future time.";
  }

  return "";
}

async function submitOrder(event) {
  event.preventDefault();
  if (submitting || !MENU) return;
  setError("");

  const type = currentType();
  const t = totals(MENU, type);
  const values = {
    name: qs("#order-name").value.trim(),
    email: qs("#order-email").value.trim(),
    phone: qs("#order-phone").value.trim(),
    address: qs("#order-address").value.trim(),
    postcode: qs("#order-postcode").value.trim().toUpperCase(),
    requestedMode: qs("#requested-mode").value,
    scheduledAt: qs("#scheduled-at").value,
    payment: qs("#payment-method").value,
    notes: qs("#order-notes").value.trim(),
  };

  const problem = validate(values, t);
  if (problem) {
    setError(problem);
    return;
  }

  const payload = {
    order_type: type,
    name: values.name,
    email: values.email,
    phone: values.phone,
    address: type === "delivery" ? values.address : "",
    postcode: type === "delivery" ? values.postcode : "",
    items: lines(MENU).map(({ item, qty }) => ({ id: item.id, qty })),
    notes: values.notes,
    requested_time:
      values.requestedMode === "scheduled" ? new Date(values.scheduledAt).toISOString() : "asap",
    payment_method: values.payment,
  };

  submitting = true;
  const submit = qs("#order-submit");
  const original = submit.textContent;
  submit.textContent = "Sending…";
  submit.disabled = true;

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

    showConfirmation(data, payload);
    clear();
  } catch (error) {
    setError(error.message);
  } finally {
    submitting = false;
    submit.textContent = original;
    submit.disabled = false;
    renderSummary();
  }
}

function showConfirmation(data, payload) {
  const layout = qs("#order-layout");
  const box = qs("#order-confirmation");
  if (!layout || !box) return;
  layout.hidden = true;

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
    <div class="seal" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5L20 6.5" stroke="currentColor" stroke-width="1.4"/></svg>
    </div>
    <span class="eyebrow center">Request received</span>
    <h2>Thank you, ${escapeHtml(payload.name.split(" ")[0])}.</h2>
    <div class="ref">${escapeHtml(data.reference)}</div>
    <p>Your ${payload.order_type} order request has reached the restaurant. We will call you on ${escapeHtml(
      payload.phone,
    )} to confirm the time and payment. Please keep your reference handy.</p>
    <div class="summary">
      <div><span>Order</span><strong>${payload.order_type === "delivery" ? "Delivery" : "Collection"}</strong></div>
      <div><span>Requested</span><strong>${escapeHtml(requested)}</strong></div>
      <div><span>Total</span><strong>${fmt(data.total)}</strong></div>
      <div><span>Status</span><strong>Awaiting confirmation</strong></div>
    </div>
    <div class="actions">
      <a class="btn" href="tel:+442079233797">Call the restaurant</a>
      <a class="btn btn-outline" href="/app/">Order in the app</a>
    </div>
  `;
  box.classList.add("is-visible");
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function initForm() {
  const form = qs("#order-form");
  if (!form) return;

  const customer = getCustomer();
  if (customer.name) qs("#order-name").value = customer.name;
  if (customer.email) qs("#order-email").value = customer.email;
  if (customer.phone) qs("#order-phone").value = customer.phone;
  if (customer.address) qs("#order-address").value = customer.address;
  if (customer.postcode) qs("#order-postcode").value = customer.postcode;

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
  const scheduled = qs("#scheduled-at");
  if (scheduled) scheduled.min = min;

  const mode = qs("#requested-mode");
  mode.addEventListener("change", () => {
    const wrap = qs("[data-schedule-field]");
    if (wrap) {
      wrap.hidden = mode.value !== "scheduled";
      const input = wrap.querySelector("input");
      if (input) input.required = mode.value === "scheduled";
    }
  });

  form.addEventListener("submit", submitOrder);

  qsa("[data-order-type]").forEach((button) => {
    button.addEventListener("click", () => {
      setOrderType(button.dataset.orderType);
      updateTypeUI();
    });
  });
}

async function boot() {
  initForm();
  window.addEventListener("mt:cart", renderSummary);

  try {
    const response = await fetch("/assets/menu.json");
    if (!response.ok) throw new Error("Menu unavailable");
    MENU = await response.json();
    MENU.categories.forEach((category) => CATEGORY_NAMES.set(category.id, category.name));

    const search = qs("#order-search");
    if (search) {
      search.addEventListener(
        "input",
        debounce(() => {
          searchTerm = search.value.trim().toLowerCase();
          renderList();
        }, 140),
      );
    }

    buildCats();
    renderList();
    updateTypeUI();
    updatePaymentOptions();
    renderSummary();
  } catch (error) {
    const list = qs("#order-list");
    if (list) {
      list.innerHTML =
        '<div class="admin-empty">The menu could not be loaded. Please call 020 7923 3797 to order.</div>';
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

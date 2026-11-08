import { el, fmt, qs, qsa, toast } from "./site.js";

const TOKEN_KEY = "mt_admin_token";
const RES_STATUSES = ["pending", "confirmed", "seated", "cancelled"];
const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
];

const state = {
  token: sessionStorage.getItem(TOKEN_KEY) || "",
  data: null,
  tab: "reservations",
  timer: null,
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function label(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusSelect(options, value, id, kind) {
  const select = el("select", "status-select");
  select.dataset.id = id;
  select.dataset.kind = kind;
  options.forEach((option) => {
    const node = new Option(label(option), option);
    if (option === value) {
      node.selected = true;
      node.setAttribute("selected", "");
    }
    select.appendChild(node);
  });
  select.value = value;
  return select;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    logout();
    throw new Error("Your session has expired. Please sign in again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Something went wrong.");
  }
  return data;
}

function showLogin() {
  qs("#admin-login").hidden = false;
  qs("#admin-dashboard").hidden = true;
  stopTimer();
  const input = qs("#admin-token");
  if (input) {
    input.value = "";
    input.focus();
  }
}

function showDashboard() {
  qs("#admin-login").hidden = true;
  qs("#admin-dashboard").hidden = false;
  startTimer();
}

function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  state.token = "";
  state.data = null;
  showLogin();
}

function stats() {
  const data = state.data;
  if (!data) return;
  const s = data.stats;
  const cards = [
    ["Reservations pending", s.reservations_pending],
    ["Reservations today", s.reservations_today],
    ["Orders pending", s.orders_pending],
    ["Orders today", s.orders_today],
    ["Revenue today", fmt(s.revenue_today)],
  ];
  qs("#admin-stats").innerHTML = cards
    .map(
      ([title, value]) =>
        `<div class="stat-card"><span>${escapeHtml(title)}</span><b>${escapeHtml(
          value,
        )}</b></div>`,
    )
    .join("");
}

function reservationCard(item) {
  return `
    <article class="admin-card">
      <div class="admin-card-head">
        <div>
          <span class="admin-ref">${escapeHtml(item.reference)}</span>
          <h3>${escapeHtml(item.name)}</h3>
        </div>
        ${statusSelect(RES_STATUSES, item.status, item.id, "reservations").outerHTML}
      </div>
      <div class="admin-meta">
        <div><span>When</span><b>${escapeHtml(item.date)} · ${escapeHtml(item.time)}</b></div>
        <div><span>Party</span><b>${escapeHtml(item.party)}</b></div>
        <div><span>Phone</span><b><a href="tel:${escapeHtml(item.phone)}">${escapeHtml(
          item.phone,
        )}</a></b></div>
        <div><span>Email</span><b><a href="mailto:${escapeHtml(item.email)}">${escapeHtml(
          item.email,
        )}</a></b></div>
        <div><span>Occasion</span><b>${escapeHtml(label(item.occasion) || "—")}</b></div>
        <div><span>Requested</span><b>${escapeHtml(when(item.created_at))}</b></div>
      </div>
      ${item.notes ? `<p class="admin-notes">${escapeHtml(item.notes)}</p>` : ""}
    </article>
  `;
}

function orderCard(item) {
  const dishes = (item.items || [])
    .map(
      (line) =>
        `<li><span>${escapeHtml(line.qty)} × ${escapeHtml(line.name)}</span><strong>${fmt(
          line.price * line.qty,
        )}</strong></li>`,
    )
    .join("");

  return `
    <article class="admin-card">
      <div class="admin-card-head">
        <div>
          <span class="admin-ref">${escapeHtml(item.reference)}</span>
          <h3>${escapeHtml(item.name)} <em>${escapeHtml(label(item.order_type))}</em></h3>
        </div>
        ${statusSelect(ORDER_STATUSES, item.status, item.id, "orders").outerHTML}
      </div>
      <div class="admin-meta">
        <div><span>Requested</span><b>${escapeHtml(
          item.requested_time === "asap" ? "As soon as possible" : when(item.requested_time),
        )}</b></div>
        <div><span>Phone</span><b><a href="tel:${escapeHtml(item.phone)}">${escapeHtml(
          item.phone,
        )}</a></b></div>
        <div><span>Email</span><b><a href="mailto:${escapeHtml(item.email)}">${escapeHtml(
          item.email,
        )}</a></b></div>
        <div><span>Payment</span><b>${escapeHtml(label(item.payment_method))}</b></div>
        <div><span>Placed</span><b>${escapeHtml(when(item.created_at))}</b></div>
        <div><span>Total</span><b>${fmt(item.total)}</b></div>
      </div>
      ${
        item.order_type === "delivery" && item.address
          ? `<p class="admin-notes">${escapeHtml(item.address)}, ${escapeHtml(item.postcode)}</p>`
          : ""
      }
      <ul class="admin-order-items">${dishes}</ul>
      <div class="admin-order-total">
        <span>Subtotal ${fmt(item.subtotal)} · ${
          item.fee ? `Delivery ${fmt(item.fee)}` : "No delivery fee"
        }</span>
        <strong>${fmt(item.total)}</strong>
      </div>
      ${item.notes ? `<p class="admin-notes">${escapeHtml(item.notes)}</p>` : ""}
    </article>
  `;
}

function render() {
  if (!state.data) return;
  stats();

  const reservations = qs("#admin-reservations");
  const orders = qs("#admin-orders");
  if (reservations) {
    reservations.innerHTML = state.data.reservations.length
      ? state.data.reservations.map(reservationCard).join("")
      : '<div class="admin-empty">No reservation requests yet.</div>';
  }
  if (orders) {
    orders.innerHTML = state.data.orders.length
      ? state.data.orders.map(orderCard).join("")
      : '<div class="admin-empty">No order requests yet.</div>';
  }

  qsa("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === state.tab);
  });
  qsa("[data-admin-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== state.tab;
  });
  const updated = qs("#admin-updated");
  if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
}

function bindStatus() {
  qs("#admin-dashboard").addEventListener("change", async (event) => {
    const select = event.target.closest(".status-select");
    if (!select) return;
    select.disabled = true;
    try {
      await request(`/api/admin/${select.dataset.kind}/${select.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: select.value }),
      });
      const list =
        select.dataset.kind === "reservations" ? state.data.reservations : state.data.orders;
      const record = list.find((entry) => String(entry.id) === String(select.dataset.id));
      if (record) record.status = select.value;
      toast("Status updated");
      await load(false);
    } catch (error) {
      toast(error.message);
      await load(false);
    } finally {
      select.disabled = false;
    }
  });
}

async function load(announce = true) {
  try {
    state.data = await request("/api/admin/data");
    showDashboard();
    render();
    if (announce) toast("Dashboard refreshed");
  } catch (error) {
    toast(error.message);
  }
}

function startTimer() {
  stopTimer();
  state.timer = setInterval(() => {
    if (state.token && !document.hidden) load(false);
  }, 45000);
}

function stopTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function init() {
  const form = qs("#admin-login-form");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = qs("#admin-token");
      const error = qs("#admin-login-error");
      const token = input.value.trim();
      if (!token) {
        error.textContent = "Enter the admin token printed by the server.";
        error.classList.add("is-visible");
        return;
      }
      state.token = token;
      sessionStorage.setItem(TOKEN_KEY, token);
      error.classList.remove("is-visible");
      await load(false);
      if (!state.data) {
        sessionStorage.removeItem(TOKEN_KEY);
        state.token = "";
        error.textContent = "That token was not accepted.";
        error.classList.add("is-visible");
      }
    });
  }

  qsa("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.adminTab;
      render();
    });
  });

  const refresh = qs("#admin-refresh");
  if (refresh) refresh.addEventListener("click", () => load());

  const out = qs("#admin-logout");
  if (out) out.addEventListener("click", logout);

  bindStatus();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.token) load(false);
  });

  if (state.token) {
    load(false);
  } else {
    showLogin();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

import { getCustomer, saveCustomer } from "./cart.js";
import { el, qs, qsa } from "./site.js";

const OCCASIONS = [
  ["", "Just a meal"],
  ["birthday", "Birthday"],
  ["anniversary", "Anniversary"],
  ["family", "Family gathering"],
  ["business", "Business meal"],
  ["celebration", "Celebration"],
  ["other", "Something else"],
];

let submitting = false;

function pad(n) {
  return String(n).padStart(2, "0");
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeSlots() {
  const slots = [];
  for (let minutes = 12 * 60; minutes <= 23 * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    slots.push(`${pad(hour)}:${pad(minute)}`);
  }
  return slots;
}

function buildTimeOptions() {
  const select = qs("#res-time");
  if (!select) return;
  const dateInput = qs("#res-date");
  const chosenDate = dateInput?.value;
  const now = new Date();
  const isToday = chosenDate === isoDate(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const previous = select.value;
  select.innerHTML = "";

  timeSlots().forEach((slot) => {
    const [hour, minute] = slot.split(":").map(Number);
    const slotMinutes = hour * 60 + minute;
    if (isToday && slotMinutes <= currentMinutes + 30) return;
    select.appendChild(new Option(slot, slot));
  });

  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  } else if (select.options.length) {
    select.selectedIndex = Math.min(2, select.options.length - 1);
  }

  if (!select.options.length) {
    select.appendChild(new Option("No times left today", ""));
  }
}

function setupDate() {
  const input = qs("#res-date");
  if (!input) return;
  const now = new Date();
  const max = new Date(now);
  max.setFullYear(max.getFullYear() + 1);
  input.min = isoDate(now);
  input.max = isoDate(max);
  if (!input.value) input.value = isoDate(now);
  input.addEventListener("change", buildTimeOptions);
}

function setupOccasions() {
  const select = qs("#res-occasion");
  if (!select) return;
  OCCASIONS.forEach(([value, label]) => select.appendChild(new Option(label, value)));
}

function setupParty() {
  const select = qs("#res-party");
  if (!select) return;
  for (let size = 1; size <= 20; size += 1) {
    select.appendChild(new Option(size === 1 ? "1 guest" : `${size} guests`, String(size)));
  }
  select.appendChild(new Option("More than 20 (we will call)", "21"));
  select.value = "2";
}

function formatSummaryDate(value) {
  if (!value) return "Choose a date";
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function updateSummary() {
  const date = qs("#res-date")?.value;
  const time = qs("#res-time")?.value;
  const party = qs("#res-party")?.value;
  const summary = qs("#res-summary");
  if (!summary) return;

  const size = Number(party || 0);
  summary.innerHTML = `
    <div class="summary-row"><span>Date</span><strong>${formatSummaryDate(date)}</strong></div>
    <div class="summary-row"><span>Time</span><strong>${time || "Choose a time"}</strong></div>
    <div class="summary-row"><span>Party</span><strong>${
      size === 21 ? "More than 20" : `${size} ${size === 1 ? "guest" : "guests"}`
    }</strong></div>
  `;
}

function setError(message) {
  const box = qs("#res-error");
  if (!box) return;
  box.textContent = message || "";
  box.classList.toggle("is-visible", Boolean(message));
}

function readForm() {
  return {
    name: qs("#res-name").value.trim(),
    email: qs("#res-email").value.trim(),
    phone: qs("#res-phone").value.trim(),
    date: qs("#res-date").value,
    time: qs("#res-time").value,
    party: Number(qs("#res-party").value || 0),
    occasion: qs("#res-occasion").value,
    notes: qs("#res-notes").value.trim(),
  };
}

function validate(values) {
  if (values.name.length < 2) return "Please enter your name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) return "Please enter a valid email address.";
  if (values.phone.replace(/\D/g, "").length < 7) return "Please enter a valid phone number.";
  if (!values.date) return "Please choose a date.";
  if (!values.time) return "Please choose a time.";
  if (!values.party || values.party < 1) return "Please choose your party size.";

  const chosen = new Date(`${values.date}T${values.time}:00`);
  if (Number.isNaN(chosen.getTime()) || chosen.getTime() < Date.now()) {
    return "Please choose a future date and time.";
  }
  return "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

async function submit(event) {
  event.preventDefault();
  if (submitting) return;
  setError("");

  const values = readForm();
  const problem = validate(values);
  if (problem) {
    setError(problem);
    return;
  }

  submitting = true;
  const button = qs("#res-submit");
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

    saveCustomer({
      name: values.name,
      email: values.email,
      phone: values.phone,
    });
    showConfirmation(data, values);
  } catch (error) {
    setError(error.message);
  } finally {
    submitting = false;
    button.textContent = original;
    button.disabled = false;
  }
}

function showConfirmation(data, values) {
  const layout = qs("#res-layout");
  const box = qs("#res-confirmation");
  if (!layout || !box) return;
  layout.hidden = true;

  const size = values.party;
  box.innerHTML = `
    <div class="seal" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5L20 6.5" stroke="currentColor" stroke-width="1.4"/></svg>
    </div>
    <span class="eyebrow center">Request received</span>
    <h2>Thank you, ${escapeHtml(values.name.split(" ")[0])}.</h2>
    <div class="ref">${escapeHtml(data.reference)}</div>
    <p>Your table request is with the restaurant. We will confirm by phone or email shortly. If your plans change, please call us on 020 7923 3797.</p>
    <div class="summary">
      <div><span>Date</span><strong>${escapeHtml(formatSummaryDate(values.date))}</strong></div>
      <div><span>Time</span><strong>${escapeHtml(values.time)}</strong></div>
      <div><span>Party</span><strong>${size === 21 ? "More than 20" : `${size} ${size === 1 ? "guest" : "guests"}`}</strong></div>
      <div><span>Status</span><strong>Awaiting confirmation</strong></div>
    </div>
    <div class="actions">
      <a class="btn" href="tel:+442079233797">Call the restaurant</a>
      <a class="btn btn-outline" href="/menu">Browse the menu</a>
    </div>
  `;
  box.classList.add("is-visible");
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function boot() {
  setupDate();
  setupParty();
  setupOccasions();
  buildTimeOptions();

  const form = qs("#reservation-form");
  if (form) form.addEventListener("submit", submit);

  qsa("#res-date, #res-time, #res-party").forEach((input) =>
    input.addEventListener("change", updateSummary),
  );

  const customer = getCustomer();
  if (customer.name) qs("#res-name").value = customer.name;
  if (customer.email) qs("#res-email").value = customer.email;
  if (customer.phone) qs("#res-phone").value = customer.phone;

  updateSummary();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

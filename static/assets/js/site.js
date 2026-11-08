/* Shared site behaviour: header, mobile nav, reveals, toasts, install help. */

export const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

export const fmt = (value) => money.format(Number(value) || 0);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

export function debounce(fn, wait = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function toast(message) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = el("div", "toast");
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove("is-visible"), 2600);
}

/* ---------- Header ---------- */
function initHeader() {
  const header = qs(".site-header");
  if (!header) return;

  const setState = () => {
    if (header.dataset.header === "solid") {
      header.classList.add("is-solid");
      return;
    }
    header.classList.toggle("is-scrolled", window.scrollY > 28);
  };

  setState();
  window.addEventListener("scroll", setState, { passive: true });

  const toggle = qs(".nav-toggle");
  if (!toggle) return;

  const close = () => {
    document.body.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("menu-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  qsa(".mobile-menu a, .mobile-menu .btn").forEach((link) =>
    link.addEventListener("click", close),
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

/* ---------- Reveal ---------- */
function initReveal() {
  const items = qsa(".reveal");
  if (!items.length) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );

  items.forEach((item) => observer.observe(item));
}

/* ---------- Install ---------- */
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  qsa("[data-install]").forEach((button) => {
    button.removeAttribute("disabled");
    button.dataset.ready = "true";
  });
});

function installDialog() {
  let dialog = document.querySelector("#install-dialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "install-dialog";
  dialog.className = "install-dialog";
  dialog.innerHTML = `
    <div class="install-dialog-inner">
      <button class="install-close" type="button" aria-label="Close">×</button>
      <span class="eyebrow">Mersin in your pocket</span>
      <h2>Install the Mersin app</h2>
      <p>Add the ordering app to your home screen. It works like a native app and is available on both iPhone and Android.</p>
      <div class="install-options">
        <div class="install-option">
          <span class="install-os">iPhone &amp; iPad</span>
          <ol>
            <li>Open this page in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> button.</li>
            <li>Choose <strong>Add to Home Screen</strong>.</li>
          </ol>
        </div>
        <div class="install-option">
          <span class="install-os">Android</span>
          <ol>
            <li>Open this page in <strong>Chrome</strong>.</li>
            <li>Tap the <strong>three-dot menu</strong>.</li>
            <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          </ol>
        </div>
      </div>
      <div class="install-actions">
        <a class="btn" href="/app/">Open the app <span aria-hidden="true">→</span></a>
        <button class="btn btn-outline install-close" type="button">Not now</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  dialog.querySelectorAll(".install-close").forEach((button) =>
    button.addEventListener("click", () => dialog.close()),
  );
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}

export async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      toast("Mersin app installed");
    }
    deferredPrompt = null;
    return;
  }
  installDialog().showModal();
}

function initInstallButtons() {
  qsa("[data-install]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      installApp();
    });
  });
}

/* ---------- Boot ---------- */
function boot() {
  initHeader();
  initReveal();
  initInstallButtons();
  qsa("[data-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

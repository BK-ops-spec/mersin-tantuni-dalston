/* Website cart shared by the menu and order pages. */

const KEY = "mt_site_cart_v1";
const TYPE_KEY = "mt_site_order_type";
const CUSTOMER_KEY = "mt_site_customer";

function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function write(cart) {
  const cleaned = {};
  Object.entries(cart).forEach(([id, qty]) => {
    const n = Number(qty);
    if (Number.isFinite(n) && n > 0) cleaned[id] = Math.min(20, Math.round(n));
  });
  localStorage.setItem(KEY, JSON.stringify(cleaned));
  window.dispatchEvent(new CustomEvent("mt:cart"));
}

function emit() {
  window.dispatchEvent(new CustomEvent("mt:cart"));
}

export function getCart() {
  return read();
}

export function add(id, qty = 1) {
  const cart = read();
  cart[id] = Math.min(20, (Number(cart[id]) || 0) + Number(qty || 1));
  write(cart);
}

export function setQty(id, qty) {
  const cart = read();
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    delete cart[id];
  } else {
    cart[id] = Math.min(20, Math.round(n));
  }
  write(cart);
}

export function remove(id) {
  const cart = read();
  delete cart[id];
  write(cart);
}

export function clear() {
  localStorage.removeItem(KEY);
  emit();
}

export function count() {
  return Object.values(read()).reduce((sum, qty) => sum + Number(qty || 0), 0);
}

export function lines(menu) {
  const cart = read();
  const items = new Map(menu.items.map((item) => [item.id, item]));
  return Object.entries(cart)
    .map(([id, qty]) => ({ item: items.get(id), qty }))
    .filter((line) => line.item);
}

export function subtotal(menu) {
  return lines(menu).reduce((sum, line) => sum + line.item.price * line.qty, 0);
}

export function totals(menu, type) {
  const sub = subtotal(menu);
  const { restaurant } = menu;
  let fee = 0;
  if (type === "delivery" && sub > 0) {
    fee = sub >= restaurant.freeDeliveryOver ? 0 : restaurant.deliveryFee;
  }
  return {
    subtotal: sub,
    fee,
    total: sub + fee,
    freeDeliveryOver: restaurant.freeDeliveryOver,
    deliveryMin: restaurant.deliveryMin,
  };
}

export function hasCollectionOnly(menu) {
  return lines(menu).some((line) => line.item.collectionOnly);
}

export function getOrderType() {
  return localStorage.getItem(TYPE_KEY) === "delivery" ? "delivery" : "collection";
}

export function setOrderType(type) {
  localStorage.setItem(TYPE_KEY, type === "delivery" ? "delivery" : "collection");
}

export function saveCustomer(customer) {
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
}

export function getCustomer() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_KEY) || "{}");
  } catch {
    return {};
  }
}

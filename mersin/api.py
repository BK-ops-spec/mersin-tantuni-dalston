"""JSON API for reservations, orders and the restaurant dashboard."""

from __future__ import annotations

import hmac
import json
import re
import time
from collections import defaultdict
from datetime import date, datetime, time as clock, timedelta
from typing import Any
from urllib.parse import urlsplit

from . import db
from .config import (
    ALLOWED_ORDER_STATUSES,
    ALLOWED_RESERVATION_STATUSES,
    MAX_BODY_BYTES,
    MENU_PATH,
    RATE_LIMIT,
    RATE_WINDOW_SECONDS,
    admin_token,
)

MENU: dict[str, Any] = json.loads(MENU_PATH.read_text(encoding="utf-8"))
RESTAURANT = MENU["restaurant"]
ITEMS = {item["id"]: item for item in MENU["items"]}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
ATTEMPTS: dict[str, list[float]] = defaultdict(list)


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def rate_limit(ip: str) -> None:
    now = time.time()
    window = [stamp for stamp in ATTEMPTS[ip] if now - stamp < RATE_WINDOW_SECONDS]
    if len(window) >= RATE_LIMIT:
        raise ApiError(429, "Too many requests. Please wait a moment or call the restaurant.")
    window.append(now)
    ATTEMPTS[ip] = window


def read_json(handler: Any) -> dict[str, Any]:
    content_type = (handler.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if content_type != "application/json":
        raise ApiError(415, "Please send JSON.")
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as exc:
        raise ApiError(400, "Invalid request.") from exc
    if length <= 0:
        raise ApiError(400, "Empty request.")
    if length > MAX_BODY_BYTES:
        raise ApiError(413, "That request is too large.")
    try:
        payload = json.loads(handler.rfile.read(length).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(400, "Invalid JSON.") from exc
    if not isinstance(payload, dict):
        raise ApiError(400, "Invalid request.")
    return payload


def text_field(data: dict[str, Any], key: str, label: str, minimum: int = 0, maximum: int = 200) -> str:
    value = data.get(key, "")
    if not isinstance(value, str):
        raise ApiError(400, f"{label} is invalid.")
    value = value.replace("\x00", "").strip()
    if len(value) < minimum:
        raise ApiError(400, f"Please enter {label.lower()}.")
    if len(value) > maximum:
        raise ApiError(400, f"{label} is too long.")
    return value


def check_contact(data: dict[str, Any]) -> tuple[str, str, str]:
    name = text_field(data, "name", "your name", 2, 80)
    email = text_field(data, "email", "your email", 5, 160).lower()
    phone = text_field(data, "phone", "your phone", 7, 32)
    if not EMAIL_RE.match(email):
        raise ApiError(400, "Please enter a valid email address.")
    if not 7 <= sum(char.isdigit() for char in phone) <= 20:
        raise ApiError(400, "Please enter a valid phone number.")
    return name, email, phone


def reservation_payload(data: dict[str, Any]) -> dict[str, Any]:
    name, email, phone = check_contact(data)

    date_value = text_field(data, "date", "a date", 10, 10)
    try:
        chosen_date = date.fromisoformat(date_value)
    except ValueError as exc:
        raise ApiError(400, "Please choose a valid date.") from exc

    today = db.now_local().date()
    if chosen_date < today:
        raise ApiError(400, "Please choose a future date.")
    if chosen_date > today + timedelta(days=365):
        raise ApiError(400, "Please choose a date within the next year.")

    time_value = text_field(data, "time", "a time", 5, 5)
    match = TIME_RE.match(time_value)
    if not match:
        raise ApiError(400, "Please choose a valid time.")
    hour, minute = int(match.group(1)), int(match.group(2))
    if not (12 * 60 <= hour * 60 + minute <= 23 * 60 + 30):
        raise ApiError(400, "Bookings run between 12:00 and 23:30.")

    chosen = datetime.combine(chosen_date, clock(hour, minute), tzinfo=db.LONDON)
    if chosen < db.now_local() - timedelta(minutes=5):
        raise ApiError(400, "Please choose a future date and time.")

    try:
        party = int(data.get("party", 0))
    except (TypeError, ValueError) as exc:
        raise ApiError(400, "Please choose a party size.") from exc
    if not 1 <= party <= 21:
        raise ApiError(400, "Please choose a party size between 1 and 20, or call us for more.")

    return {
        "name": name,
        "email": email,
        "phone": phone,
        "date": date_value,
        "time": time_value,
        "party": party,
        "occasion": text_field(data, "occasion", "occasion", 0, 40),
        "notes": text_field(data, "notes", "notes", 0, 500),
    }


def order_payload(data: dict[str, Any]) -> dict[str, Any]:
    order_type = data.get("order_type")
    if order_type not in {"collection", "delivery"}:
        raise ApiError(400, "Choose collection or delivery.")

    name, email, phone = check_contact(data)

    raw_items = data.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise ApiError(400, "Your order is empty.")
    if len(raw_items) > 40:
        raise ApiError(400, "That is too many items. Please call us for a large order.")

    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    subtotal = 0.0

    for entry in raw_items:
        if not isinstance(entry, dict):
            raise ApiError(400, "One of the items is invalid.")
        item_id = entry.get("id")
        if not isinstance(item_id, str) or item_id not in ITEMS:
            raise ApiError(400, "One of the dishes is no longer on the menu.")
        if item_id in seen:
            raise ApiError(400, "Please combine duplicate dishes.")
        seen.add(item_id)

        try:
            qty = int(entry.get("qty", 0))
        except (TypeError, ValueError) as exc:
            raise ApiError(400, "One of the quantities is invalid.") from exc
        if not 1 <= qty <= 20:
            raise ApiError(400, "Quantities must be between 1 and 20.")

        item = ITEMS[item_id]
        if not item.get("orderable") or item.get("price") is None:
            raise ApiError(400, f"{item['name']} is not available to order online.")
        if order_type == "delivery" and item.get("collectionOnly"):
            raise ApiError(400, f"{item['name']} is collection only.")

        subtotal += float(item["price"]) * qty
        items.append(
            {"id": item_id, "name": item["name"], "qty": qty, "price": float(item["price"])}
        )

    subtotal = round(subtotal, 2)
    address = ""
    postcode = ""
    fee = 0.0

    if order_type == "delivery":
        address = text_field(data, "address", "your delivery address", 5, 200)
        postcode = text_field(data, "postcode", "your postcode", 4, 12).upper()
        if subtotal < float(RESTAURANT["deliveryMin"]):
            raise ApiError(
                400,
                f"Delivery orders start at £{float(RESTAURANT['deliveryMin']):.2f}.",
            )
        if subtotal < float(RESTAURANT["freeDeliveryOver"]):
            fee = float(RESTAURANT["deliveryFee"])
    else:
        address = ""
        postcode = ""

    payment = data.get("payment_method")
    allowed_payments = {
        "collection": {"pay_on_collection", "card_on_collection"},
        "delivery": {"pay_on_delivery", "card_on_delivery"},
    }[order_type]
    if payment not in allowed_payments:
        raise ApiError(400, "Please choose a payment method.")

    requested = data.get("requested_time", "asap")
    if requested != "asap":
        if not isinstance(requested, str):
            raise ApiError(400, "Please choose a valid time.")
        try:
            requested_at = datetime.fromisoformat(requested.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ApiError(400, "Please choose a valid time.") from exc
        if requested_at.tzinfo is None:
            requested_at = requested_at.replace(tzinfo=db.LONDON)
        local = requested_at.astimezone(db.LONDON)
        now = db.now_local()
        if local < now - timedelta(minutes=5):
            raise ApiError(400, "Please choose a future time.")
        if local > now + timedelta(days=30):
            raise ApiError(400, "Please choose a time within the next 30 days.")
        if not (12 * 60 <= local.hour * 60 + local.minute <= 23 * 60 + 30):
            raise ApiError(400, "Orders run between 12:00 and 23:30.")
        requested = local.isoformat(timespec="minutes")

    total = round(subtotal + fee, 2)

    return {
        "order_type": order_type,
        "name": name,
        "email": email,
        "phone": phone,
        "address": address,
        "postcode": postcode,
        "items": items,
        "subtotal": subtotal,
        "fee": round(fee, 2),
        "total": total,
        "notes": text_field(data, "notes", "notes", 0, 500),
        "requested_time": requested,
        "payment_method": payment,
    }


def authorised(handler: Any) -> bool:
    header = handler.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    supplied = header[7:].strip()
    expected, _ = admin_token()
    return hmac.compare_digest(supplied, expected)


def admin_data() -> dict[str, Any]:
    return {
        "ok": True,
        "stats": db.stats(),
        "reservations": db.list_reservations(),
        "orders": db.list_orders(),
    }


def route(handler: Any, method: str) -> tuple[int, dict[str, Any]] | None:
    split = urlsplit(handler.path)
    path = split.path

    if path == "/data/menu.json":
        if method != "GET":
            raise ApiError(405, "Method not allowed.")
        return 200, MENU

    if not path.startswith("/api/"):
        return None

    if path == "/api/health":
        if method != "GET":
            raise ApiError(405, "Method not allowed.")
        return 200, {"ok": True, "service": "mersin-tantuni", "time": db.stamp()}

    if path == "/api/reservations":
        if method != "POST":
            raise ApiError(405, "Method not allowed.")
        rate_limit(handler.client_address[0])
        payload = reservation_payload(read_json(handler))
        code = db.create_reservation(payload)
        return 201, {
            "ok": True,
            "reference": code,
            "date": payload["date"],
            "time": payload["time"],
            "party": payload["party"],
        }

    if path == "/api/orders":
        if method != "POST":
            raise ApiError(405, "Method not allowed.")
        rate_limit(handler.client_address[0])
        payload = order_payload(read_json(handler))
        code = db.create_order(payload)
        return 201, {
            "ok": True,
            "reference": code,
            "total": payload["total"],
            "subtotal": payload["subtotal"],
            "fee": payload["fee"],
        }

    if path == "/api/admin/data":
        if method != "GET":
            raise ApiError(405, "Method not allowed.")
        if not authorised(handler):
            raise ApiError(401, "Unauthorised.")
        return 200, admin_data()

    match = re.fullmatch(r"/api/admin/(reservations|orders)/(\d+)", path)
    if match:
        if method != "PATCH":
            raise ApiError(405, "Method not allowed.")
        if not authorised(handler):
            raise ApiError(401, "Unauthorised.")

        kind, record_id = match.group(1), int(match.group(2))
        payload = read_json(handler)
        status = payload.get("status")
        allowed = (
            ALLOWED_RESERVATION_STATUSES
            if kind == "reservations"
            else ALLOWED_ORDER_STATUSES
        )
        if status not in allowed:
            raise ApiError(400, "That status is not valid.")
        if not db.update_status(kind, record_id, status):
            raise ApiError(404, "That record no longer exists.")
        return 200, {"ok": True, "status": status}

    raise ApiError(404, "Not found.")

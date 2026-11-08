"""Configuration for the Mersin Tantuni site and app."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
APP_DIR = BASE_DIR / "app"
DATA_DIR = Path(os.environ.get("MT_DATA_DIR") or "data").expanduser()
if not DATA_DIR.is_absolute():
    DATA_DIR = BASE_DIR / DATA_DIR
MENU_PATH = BASE_DIR / "shared" / "menu.json"
DB_PATH = DATA_DIR / "mersin.sqlite3"
TOKEN_PATH = DATA_DIR / "admin_token.txt"


def env_int(*names: str, default: int) -> int:
    for name in names:
        raw = os.environ.get(name, "").strip()
        if not raw:
            continue
        try:
            return int(raw)
        except ValueError:
            continue
    return default


HOST = os.environ.get("MT_HOST", "127.0.0.1")
PORT = env_int("PORT", "MT_PORT", default=8080)

MAX_BODY_BYTES = 24 * 1024
RATE_LIMIT = 24
RATE_WINDOW_SECONDS = 300

CLEAN_ROUTES = {
    "/": ("static", "index.html"),
    "/menu": ("static", "menu.html"),
    "/reservations": ("static", "reservations.html"),
    "/reserve": ("static", "reservations.html"),
    "/order": ("static", "order.html"),
    "/admin": ("static", "admin.html"),
    "/app": ("app", "index.html"),
    "/app/": ("app", "index.html"),
}

ALLOWED_RESERVATION_STATUSES = {"pending", "confirmed", "seated", "cancelled"}
ALLOWED_ORDER_STATUSES = {
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "out_for_delivery",
    "completed",
    "cancelled",
}


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def admin_token() -> tuple[str, bool]:
    """Return (token, generated). Env wins; otherwise use or create a file."""
    env = os.environ.get("MT_ADMIN_TOKEN", "").strip()
    if env:
        return env, False

    ensure_dirs()
    if TOKEN_PATH.exists():
        token = TOKEN_PATH.read_text(encoding="utf-8").strip()
        if token:
            return token, False

    token = secrets.token_urlsafe(24)
    TOKEN_PATH.write_text(token + "\n", encoding="utf-8")
    try:
        TOKEN_PATH.chmod(0o600)
    except OSError:
        pass
    return token, True

"""SQLite storage for reservations and order requests."""

from __future__ import annotations

import json
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from .config import DB_PATH, ensure_dirs

LONDON = ZoneInfo("Europe/London")
REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def now_local() -> datetime:
    return datetime.now(LONDON)


def stamp() -> str:
    return now_local().isoformat(timespec="seconds")


def reference(prefix: str) -> str:
    return f"{prefix}-" + "".join(secrets.choice(REFERENCE_ALPHABET) for _ in range(6))


def connect() -> sqlite3.Connection:
    ensure_dirs()
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


@contextmanager
def session():
    connection = connect()
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init() -> None:
    with session() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS reservations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reference TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                party INTEGER NOT NULL,
                occasion TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_reservations_date
                ON reservations(date);
            CREATE INDEX IF NOT EXISTS idx_reservations_created
                ON reservations(created_at DESC);

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reference TEXT NOT NULL UNIQUE,
                order_type TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL,
                address TEXT NOT NULL DEFAULT '',
                postcode TEXT NOT NULL DEFAULT '',
                items_json TEXT NOT NULL,
                subtotal REAL NOT NULL,
                fee REAL NOT NULL,
                total REAL NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                requested_time TEXT NOT NULL,
                payment_method TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_orders_created
                ON orders(created_at DESC);
            """
        )


def _insert_unique(connection: sqlite3.Connection, sql: str, values: tuple[Any, ...], prefix: str) -> str:
    for _ in range(8):
        code = reference(prefix)
        try:
            connection.execute(sql, (code, *values))
            connection.commit()
            return code
        except sqlite3.IntegrityError:
            continue
    raise RuntimeError("Could not generate a unique reference")


def create_reservation(data: dict[str, Any]) -> str:
    with session() as connection:
        return _insert_unique(
            connection,
            """
            INSERT INTO reservations
                (reference, name, email, phone, date, time, party, occasion, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["name"],
                data["email"],
                data["phone"],
                data["date"],
                data["time"],
                data["party"],
                data.get("occasion", ""),
                data.get("notes", ""),
                stamp(),
            ),
            "RES",
        )


def create_order(data: dict[str, Any]) -> str:
    with session() as connection:
        return _insert_unique(
            connection,
            """
            INSERT INTO orders
                (reference, order_type, name, email, phone, address, postcode,
                 items_json, subtotal, fee, total, notes, requested_time,
                 payment_method, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["order_type"],
                data["name"],
                data["email"],
                data["phone"],
                data.get("address", ""),
                data.get("postcode", ""),
                json.dumps(data["items"], ensure_ascii=False),
                data["subtotal"],
                data["fee"],
                data["total"],
                data.get("notes", ""),
                data["requested_time"],
                data["payment_method"],
                stamp(),
            ),
            "ORD",
        )


def list_reservations(limit: int = 200) -> list[dict[str, Any]]:
    with session() as connection:
        rows = connection.execute(
            "SELECT * FROM reservations ORDER BY created_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_orders(limit: int = 200) -> list[dict[str, Any]]:
    with session() as connection:
        rows = connection.execute(
            "SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()

    orders: list[dict[str, Any]] = []
    for row in rows:
        order = dict(row)
        try:
            order["items"] = json.loads(order.pop("items_json"))
        except (ValueError, KeyError):
            order["items"] = []
        orders.append(order)
    return orders


def update_status(kind: str, record_id: int, status: str) -> bool:
    tables = {"reservations": "reservations", "orders": "orders"}
    table = tables.get(kind)
    if not table:
        return False
    with session() as connection:
        cursor = connection.execute(
            f"UPDATE {table} SET status = ? WHERE id = ?",
            (status, record_id),
        )
        connection.commit()
        return cursor.rowcount > 0


def stats() -> dict[str, Any]:
    today = now_local().date().isoformat()
    with session() as connection:
        def scalar(sql: str, params: tuple[Any, ...] = ()) -> int | float:
            row = connection.execute(sql, params).fetchone()
            return row[0] if row else 0

        return {
            "reservations_pending": scalar(
                "SELECT COUNT(*) FROM reservations WHERE status = 'pending'"
            ),
            "reservations_today": scalar(
                "SELECT COUNT(*) FROM reservations WHERE date = ?", (today,)
            ),
            "orders_pending": scalar("SELECT COUNT(*) FROM orders WHERE status = 'pending'"),
            "orders_today": scalar(
                "SELECT COUNT(*) FROM orders WHERE substr(created_at, 1, 10) = ?", (today,)
            ),
            "revenue_today": round(
                float(
                    scalar(
                        "SELECT COALESCE(SUM(total), 0) FROM orders "
                        "WHERE substr(created_at, 1, 10) = ? AND status != 'cancelled'",
                        (today,),
                    )
                ),
                2,
            ),
        }

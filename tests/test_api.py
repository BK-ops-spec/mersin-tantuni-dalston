"""Integration tests for the Mersin site, API and admin dashboard."""

from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlsplit

os.environ["MT_ADMIN_TOKEN"] = "test-token"

from mersin import api, db  # noqa: E402
from mersin.server import Handler  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

TOKEN = "test-token"


class MersinTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory()
        cls.original_db = db.DB_PATH
        db.DB_PATH = Path(cls.temp.name) / "test.sqlite3"
        db.init()

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)
        db.DB_PATH = cls.original_db
        cls.temp.cleanup()

    def request(self, path: str, method: str = "GET", payload=None, token: str | None = None):
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                body = response.read()
                ctype = response.headers.get("Content-Type", "")
                if "json" in ctype:
                    return response.status, json.loads(body)
                return response.status, body
        except urllib.error.HTTPError as error:
            body = error.read()
            error.close()
            try:
                return error.code, json.loads(body)
            except ValueError:
                return error.code, body

    def admin(self):
        status, data = self.request("/api/admin/data", token=TOKEN)
        self.assertEqual(status, 200, data)
        return data

    def test_pages_and_assets(self) -> None:
        for path in ["/", "/menu", "/order", "/reservations", "/admin", "/app/"]:
            status, body = self.request(path)
            self.assertEqual(status, 200, path)
            self.assertIn(b"<!doctype html>", body.lower(), path)

        for path in [
            "/assets/css/site.css",
            "/assets/js/site.js",
            "/assets/img/hummus.webp",
            "/app/assets/css/app.css",
            "/app/assets/js/app.js",
            "/app/manifest.webmanifest",
        ]:
            status, _ = self.request(path)
            self.assertEqual(status, 200, path)

        status, body = self.request("/app")
        self.assertEqual(status, 200)
        self.assertIn(b"<!doctype html>", body.lower())

    def test_health_and_menu(self) -> None:
        status, data = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])

        status, menu = self.request("/data/menu.json")
        self.assertEqual(status, 200)
        self.assertGreater(len(menu["items"]), 50)

    def test_reservation_flow(self) -> None:
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        status, data = self.request(
            "/api/reservations",
            method="POST",
            payload={
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": "020 7923 3797",
                "date": tomorrow,
                "time": "19:30",
                "party": 4,
                "occasion": "birthday",
                "notes": "Window table",
            },
        )
        self.assertEqual(status, 201, data)
        self.assertTrue(data["reference"].startswith("RES-"))

        dashboard = self.admin()
        record = next(
            item for item in dashboard["reservations"] if item["reference"] == data["reference"]
        )
        self.assertEqual(record["status"], "pending")
        self.assertEqual(record["party"], 4)

    def test_past_reservation_rejected(self) -> None:
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        status, data = self.request(
            "/api/reservations",
            method="POST",
            payload={
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": "020 7923 3797",
                "date": yesterday,
                "time": "19:30",
                "party": 2,
            },
        )
        self.assertEqual(status, 400)
        self.assertFalse(data["ok"])

    def test_collection_order_computes_totals(self) -> None:
        status, data = self.request(
            "/api/orders",
            method="POST",
            payload={
                "order_type": "collection",
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": "020 7923 3797",
                "items": [
                    {"id": "hummus", "qty": 2},
                    {"id": "et-tek-lavas", "qty": 1},
                ],
                "requested_time": "asap",
                "payment_method": "pay_on_collection",
            },
        )
        self.assertEqual(status, 201, data)
        self.assertAlmostEqual(data["subtotal"], 15.80, places=2)
        self.assertAlmostEqual(data["fee"], 0.0, places=2)
        self.assertTrue(data["reference"].startswith("ORD-"))

    def test_delivery_fee_and_minimum(self) -> None:
        status, data = self.request(
            "/api/orders",
            method="POST",
            payload={
                "order_type": "delivery",
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": "020 7923 3797",
                "address": "1 Test Street",
                "postcode": "N16 8BH",
                "items": [{"id": "hummus", "qty": 1}],
                "requested_time": "asap",
                "payment_method": "pay_on_delivery",
            },
        )
        self.assertEqual(status, 400)

        status, data = self.request(
            "/api/orders",
            method="POST",
            payload={
                "order_type": "delivery",
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": "020 7923 3797",
                "address": "1 Test Street",
                "postcode": "N16 8BH",
                "items": [
                    {"id": "yogurtlu-et-tantuni", "qty": 1},
                    {"id": "kunefe", "qty": 1},
                ],
                "requested_time": "asap",
                "payment_method": "card_on_delivery",
            },
        )
        self.assertEqual(status, 201, data)
        self.assertAlmostEqual(data["subtotal"], 26.00, places=2)
        self.assertAlmostEqual(data["fee"], 3.50, places=2)

    def test_alcohol_is_collection_only(self) -> None:
        status, data = self.request(
            "/api/orders",
            method="POST",
            payload={
                "order_type": "delivery",
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": "020 7923 3797",
                "address": "1 Test Street",
                "postcode": "N16 8BH",
                "items": [{"id": "doluca-red", "qty": 1}],
                "requested_time": "asap",
                "payment_method": "pay_on_delivery",
            },
        )
        self.assertEqual(status, 400)
        self.assertIn("collection only", data["error"])

    def test_admin_requires_token_and_updates_status(self) -> None:
        status, _ = self.request("/api/admin/data")
        self.assertEqual(status, 401)

        status, _ = self.request("/api/admin/data", token="wrong")
        self.assertEqual(status, 401)

        status, data = self.request(
            "/api/reservations",
            method="POST",
            payload={
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": "020 7923 3797",
                "date": (date.today() + timedelta(days=2)).isoformat(),
                "time": "18:00",
                "party": 2,
            },
        )
        self.assertEqual(status, 201, data)

        dashboard = self.admin()
        record = next(
            item for item in dashboard["reservations"] if item["reference"] == data["reference"]
        )

        status, result = self.request(
            f"/api/admin/reservations/{record['id']}",
            method="PATCH",
            payload={"status": "confirmed"},
            token=TOKEN,
        )
        self.assertEqual(status, 200, result)

        status, result = self.request(
            f"/api/admin/reservations/{record['id']}",
            method="PATCH",
            payload={"status": "nonsense"},
            token=TOKEN,
        )
        self.assertEqual(status, 400)

    def test_bad_input(self) -> None:
        status, _ = self.request("/nope")
        self.assertEqual(status, 404)

        parts = urlsplit(self.base)
        connection = http.client.HTTPConnection(parts.hostname, parts.port, timeout=5)
        try:
            connection.request("GET", "/../etc/passwd")
            response = connection.getresponse()
            response.read()
            self.assertEqual(response.status, 404)
        finally:
            connection.close()

        status, _ = self.request("/api/reservations", method="POST", payload={"name": "x"})
        self.assertEqual(status, 400)

        status, _ = self.request(
            "/api/orders",
            method="POST",
            payload={
                "order_type": "collection",
                "name": "Ada Lovelace",
                "email": "not-an-email",
                "phone": "020 7923 3797",
                "items": [{"id": "hummus", "qty": 1}],
                "requested_time": "asap",
                "payment_method": "pay_on_collection",
            },
        )
        self.assertEqual(status, 400)

    def test_menu_is_loaded(self) -> None:
        self.assertGreater(len(api.ITEMS), 50)
        self.assertIn("hummus", api.ITEMS)


if __name__ == "__main__":
    unittest.main()

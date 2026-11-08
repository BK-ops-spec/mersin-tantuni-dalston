"""Integrity checks for the shared menu and its runtime copies."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "shared" / "menu.json"
COPIES = [ROOT / "static" / "assets" / "menu.json", ROOT / "app" / "assets" / "menu.json"]


class MenuIntegrityTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.menu = json.loads(SHARED.read_text(encoding="utf-8"))
        cls.items = cls.menu["items"]
        cls.categories = {category["id"] for category in cls.menu["categories"]}

    def test_runtime_copies_match_canonical(self) -> None:
        for copy in COPIES:
            self.assertEqual(
                self.menu,
                json.loads(copy.read_text(encoding="utf-8")),
                f"{copy} is out of sync with shared/menu.json",
            )

    def test_items_have_unique_ids_and_valid_categories(self) -> None:
        ids = [item["id"] for item in self.items]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreater(len(ids), 50)

        for item in self.items:
            self.assertIn(item["category"], self.categories, item["id"])
            self.assertIsInstance(item["name"], str, item["id"])
            self.assertIsInstance(item["description"], str, item["id"])
            self.assertIsInstance(item["tags"], list, item["id"])

    def test_prices_and_orderability(self) -> None:
        restaurant = self.menu["restaurant"]
        self.assertGreater(restaurant["deliveryMin"], 0)
        self.assertGreaterEqual(restaurant["freeDeliveryOver"], restaurant["deliveryMin"])

        for item in self.items:
            if item["price"] is not None:
                self.assertIsInstance(item["price"], (int, float), item["id"])
                self.assertGreater(item["price"], 0, item["id"])
            if item["orderable"]:
                self.assertIsNotNone(item["price"], f"{item['id']} needs a price to be orderable")

        sea_bass = next(item for item in self.items if item["id"] == "sea-bass")
        self.assertFalse(sea_bass["orderable"])
        self.assertTrue(sea_bass["priceLabel"])

    def test_alcohol_is_collection_only(self) -> None:
        alcohol = [item for item in self.items if "age" in item["tags"]]
        self.assertGreater(len(alcohol), 0)
        for item in alcohol:
            self.assertTrue(item["collectionOnly"], item["id"])

    def test_images_exist_in_both_apps(self) -> None:
        images = {item["image"] for item in self.items if item.get("image")}
        images |= {
            category["image"]
            for category in self.menu["categories"]
            if category.get("image")
        }
        self.assertGreater(len(images), 20)

        for name in images:
            for base in [ROOT / "static", ROOT / "app"]:
                path = base / "assets" / "img" / f"{name}.webp"
                self.assertTrue(path.is_file(), f"Missing {path}")

    def test_restaurant_details(self) -> None:
        restaurant = self.menu["restaurant"]
        self.assertEqual(restaurant["address"], "11 Stoke Newington Road")
        self.assertEqual(restaurant["postcode"], "N16 8BH")
        self.assertEqual(restaurant["phone"], "020 7923 3797")
        self.assertIn("12:00", restaurant["hours"])
        self.assertIn("00:00", restaurant["hours"])


if __name__ == "__main__":
    unittest.main()

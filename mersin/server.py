"""Zero-dependency HTTP server for the Mersin site and app."""

from __future__ import annotations

import json
import mimetypes
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from . import api, db
from .config import APP_DIR, CLEAN_ROUTES, HOST, PORT, STATIC_DIR, admin_token

CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "manifest-src 'self'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)

TEXT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
}


def content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in TEXT_TYPES:
        return TEXT_TYPES[suffix]
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


def cache_policy(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".html", ".webmanifest"}:
        return "no-cache"
    if suffix in {".webp", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".woff2"}:
        return "public, max-age=86400"
    return "public, max-age=300"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Mersin/1.0"

    def do_GET(self) -> None:  # noqa: N802
        self.dispatch("GET")

    def do_HEAD(self) -> None:  # noqa: N802
        self.dispatch("GET", head=True)

    def do_POST(self) -> None:  # noqa: N802
        self.dispatch("POST")

    def do_PATCH(self) -> None:  # noqa: N802
        self.dispatch("PATCH")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, POST, PATCH, OPTIONS")
        self.send_header("Content-Length", "0")
        self.security_headers()
        self.end_headers()

    def dispatch(self, method: str, head: bool = False) -> None:
        try:
            routed = api.route(self, method)
        except api.ApiError as error:
            self.send_json(error.status, {"ok": False, "error": error.message}, head=head)
            return
        except Exception:  # pragma: no cover - defensive
            self.send_json(
                500,
                {"ok": False, "error": "Something went wrong. Please call 020 7923 3797."},
                head=head,
            )
            return

        if routed is not None:
            status, payload = routed
            self.send_json(status, payload, head=head)
            return

        if method != "GET":
            self.send_json(405, {"ok": False, "error": "Method not allowed."}, head=head)
            return

        path = urlsplit(self.path).path
        if path == "/app":
            self.redirect("/app/")
            return
        self.serve_static(path, head=head)

    def send_json(self, status: int, payload: dict[str, Any], head: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.security_headers()
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def redirect(self, location: str) -> None:
        self.send_response(301)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.security_headers()
        self.end_headers()

    def security_headers(self) -> None:
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"
        )

    def target_path(self, url_path: str) -> tuple[Path | None, Path | None]:
        if url_path in CLEAN_ROUTES:
            root_name, relative = CLEAN_ROUTES[url_path]
            root = STATIC_DIR if root_name == "static" else APP_DIR
            return root, root / relative

        if url_path.startswith("/app/"):
            relative = url_path[len("/app/") :] or "index.html"
            root = APP_DIR
        else:
            relative = url_path.lstrip("/") or "index.html"
            root = STATIC_DIR

        if relative.endswith("/"):
            relative += "index.html"

        return root, root / relative

    def serve_static(self, url_path: str, head: bool = False) -> None:
        root, target = self.target_path(url_path)
        if root is None or target is None:
            self.not_found(head=head)
            return

        try:
            resolved_root = root.resolve()
            resolved = target.resolve()
        except OSError:
            self.not_found(head=head)
            return

        if resolved != resolved_root and resolved_root not in resolved.parents:
            self.not_found(head=head)
            return

        if not resolved.is_file():
            self.not_found(head=head)
            return

        try:
            data = resolved.read_bytes()
        except OSError:
            self.not_found(head=head)
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type(resolved))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache_policy(resolved))
        self.security_headers()
        self.end_headers()
        if not head:
            try:
                self.wfile.write(data)
            except BrokenPipeError:
                pass

    def not_found(self, head: bool = False) -> None:
        body = (
            "<!doctype html><html lang='en-GB'><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>Not found — Mersin Tantuni</title>"
            "<style>body{margin:0;min-height:100vh;display:grid;place-content:center;"
            "background:#07130e;color:#f6f0e4;font-family:Georgia,serif;text-align:center}"
            "a{color:#e3c98f}</style>"
            "<div><p style='letter-spacing:.2em;font-size:11px;text-transform:uppercase;"
            "font-family:Arial,sans-serif;color:#c6a15b'>Mersin Tantuni Dalston</p>"
            "<h1 style='font-size:52px;font-weight:400;margin:12px 0'>Page not found.</h1>"
            "<p style='font-family:Arial,sans-serif;font-size:13px;color:#a9b3a9'>"
            "Try the <a href='/'>home page</a>, the <a href='/menu'>menu</a>, "
            "or call <a href='tel:+442079233797'>020 7923 3797</a>.</p></div>"
        ).encode("utf-8")
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.security_headers()
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(
            "%s - - [%s] %s\n"
            % (self.address_string(), self.log_date_time_string(), fmt % args)
        )


def main() -> None:
    db.init()
    token, generated = admin_token()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    base = f"http://{HOST}:{PORT}"
    if HOST in {"0.0.0.0", "::"}:
        base = f"http://localhost:{PORT}"

    print()
    print("  MERSIN TANTUNI DALSTON")
    print(f"  Site   {base}/")
    print(f"  Menu   {base}/menu")
    print(f"  Order  {base}/order")
    print(f"  App    {base}/app/")
    print(f"  Admin  {base}/admin")
    if generated:
        print(f"  Admin token (generated): {token}")
    else:
        print(f"  Admin token: data/admin_token.txt or MT_ADMIN_TOKEN")
    print()
    print("  Press Ctrl+C to stop.")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

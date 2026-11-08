# Mersin Tantuni Dalston

An original website and installable ordering app for **Mersin Tantuni Dalston**, 11 Stoke Newington Road, London N16 8BH.

Live preview: <https://mersin-tantuni-dalston.onrender.com>

The site is a static, editorial restaurant site. The app is a separate installable PWA with the full menu, collection/delivery order requests and table reservation requests. Both are served by a small zero-dependency Python server with a SQLite database and an admin dashboard.

Orders and reservations are **requests**. No payment is taken online and no card details are stored. The restaurant confirms every request by phone or email.

---

## What is included

- Luxury editorial website: home, menu, order, reservations.
- Menu with 90 dishes, 13 categories, real prices, tags and 50 dish photos.
- Collection and delivery order requests with server-side price calculation.
- Table reservation requests with date/time validation.
- Responsive design and accessible focus/skip states.
- Separate mobile-first PWA at `/app/` with install prompts, offline menu and shortcuts.
- Admin dashboard at `/admin` for reservations, orders, statuses and daily stats.
- SQLite storage, rate limiting, security headers and no third-party Python packages.
- Integration tests for the API and menu asset integrity.

---

## Quick start

Requirements: Python 3.10+ (developed on Python 3.14). There are no pip dependencies.

```bash
cd mersin-tantuni
python3 run.py
```

Open:

- Site: <http://localhost:8080/>
- App: <http://localhost:8080/app/>
- Admin: <http://localhost:8080/admin>
- Health: <http://localhost:8080/api/health>

The server creates `data/mersin.sqlite3` on first run. If `MT_ADMIN_TOKEN` is not set, it generates an admin token and prints it once, then stores it in `data/admin_token.txt` with mode `0600`.

To test on another device on the same network:

```bash
MT_HOST=0.0.0.0 python3 run.py
```

Then use `http://<your-lan-ip>:8080/`.

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MT_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` for LAN or hosted access. |
| `MT_PORT` | `8080` | HTTP port when `PORT` is not set. |
| `PORT` | unset | Hosting-provider port. Takes precedence over `MT_PORT`. |
| `MT_DATA_DIR` | `data` | Directory for the SQLite database and generated admin token. |
| `MT_ADMIN_TOKEN` | generated | Admin bearer token. Overrides `data/admin_token.txt`. |

Restaurant settings and menu data live in `shared/menu.json`. Delivery fee, free-delivery threshold, minimum order and lead time are in the `restaurant` object.

Changing `MT_ADMIN_TOKEN` invalidates existing admin sessions.

---

## Admin dashboard

1. Open `/admin`.
2. Enter the token printed by the server, or read it from `data/admin_token.txt`.
3. The token is kept in `sessionStorage` and sent as `Authorization: Bearer <token>`.

The dashboard supports:

- Daily reservation and order counts, pending counts and revenue.
- Viewing contact details, notes, items and totals.
- Updating reservation statuses: `pending`, `confirmed`, `seated`, `cancelled`.
- Updating order statuses: `pending`, `confirmed`, `preparing`, `ready`, `out_for_delivery`, `completed`, `cancelled`.
- Manual refresh, sign out and a 45-second auto-refresh while visible.

The dashboard is `noindex` and API endpoints reject missing or invalid tokens.

---

## Menu updates

`shared/menu.json` is the canonical menu. The server reads it at startup, and the browser copies are:

```text
static/assets/menu.json
app/assets/menu.json
```

After editing the canonical file, copy it to both runtimes:

```bash
cp shared/menu.json static/assets/menu.json
cp shared/menu.json app/assets/menu.json
```

Dish and category images are WebP files in both `static/assets/img/` and `app/assets/img/`. The current images are 480x384. Keep both directories in sync; the app service worker caches its own copies.

Useful item fields:

```json
{
  "id": "hummus",
  "name": "Hummus",
  "category": "cold-mezze",
  "price": 5.5,
  "priceLabel": null,
  "description": "...,",
  "tags": ["vegan"],
  "image": "hummus",
  "featured": false,
  "orderable": true,
  "collectionOnly": false
}
```

- `price: null` with a `priceLabel` is used for market-price dishes.
- `orderable: false` shows “Ask us” and cannot be added to an online order.
- `collectionOnly: true` is required for alcohol; the API rejects it on delivery orders.
- Allowed tags are `vegan`, `vegetarian`, `spicy` and `age`.

If the menu changes, run the tests. Update any test assumptions if you intentionally change the shape of the data.

---

## Tests

```bash
python3 -m unittest discover -s tests -v
```

The suite covers:

- Clean routes, static assets and the app redirect.
- Health and menu endpoints.
- Reservation validation and persistence.
- Collection/delivery totals, delivery minimum and collection-only alcohol.
- Admin authentication and status updates.
- Bad input and path traversal safety.
- Menu copy consistency, unique IDs, prices, images and restaurant details.

---

## Render preview deployment

`render.yaml` defines a free Render web service using the public repository. The free plan has an ephemeral filesystem and spins down after inactivity, so reservations, orders and the generated token file reset on restart.

For a real booking service, attach a persistent disk to a paid Render instance, mount it at `/var/data` and set `MT_DATA_DIR=/var/data`.

The service must bind to `0.0.0.0` and use Render's `PORT` variable; both are configured in `render.yaml`.

## Production deployment

The server is a normal WSGI-free HTTP process. Put it behind a TLS terminator such as Caddy or nginx. Do not expose the Python process directly to the public internet without TLS.

Caddy example:

```caddy
mersintantunidalston.co.uk {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```

The application already sends `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`. Avoid setting a second, conflicting CSP at the proxy. You may add HSTS at the TLS terminator.

Example systemd unit:

```ini
[Unit]
Description=Mersin Tantuni Dalston website and ordering app
After=network.target

[Service]
User=mersin
WorkingDirectory=/srv/mersin-tantuni
Environment=MT_HOST=127.0.0.1
Environment=MT_PORT=8080
# Environment=MT_ADMIN_TOKEN=replace-with-a-long-random-token
ExecStart=/usr/bin/python3 /srv/mersin-tantuni/run.py
Restart=always
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/srv/mersin-tantuni/data

[Install]
WantedBy=multi-user.target
```

Back up the whole `data/` directory. It contains the SQLite database and, if used, the generated admin token.

PWA installation and service workers require HTTPS in production. `http://localhost` is treated as secure for local testing.

---

## PWA and store packaging

The PWA is served from `/app/` with its own manifest, service worker, icons and offline fallback. It can be installed directly:

- **iPhone/iPad:** open `/app/` in Safari, tap Share, then Add to Home Screen.
- **Android:** open `/app/` in Chrome, open the menu, then Install app / Add to Home screen.
- **Desktop Chrome/Edge:** use the install icon in the address bar.

The manifest includes shortcuts for collection, delivery and reserving a table (`?type=collection`, `?type=delivery`, `?view=reserve`).

### Updating the app shell

The cache name is in `app/sw.js`:

```js
const VERSION = "mersin-app-v1";
```

Bump this version whenever you change `app/assets/css/app.css`, `app/assets/js/app.js`, `app/index.html`, icons or other shell files. Otherwise an installed app may keep serving the old shell from cache.

### Wrapping for the App Store / Play Store

Actual store publishing requires developer accounts and review. A PWA alone cannot be submitted to the stores. Two practical routes:

1. **PWABuilder** — <https://www.pwabuilder.com/>
   - Enter the public app URL (for example `https://mersintantunidalston.co.uk/app/`).
   - Generate an Android package (Trusted Web Activity) and an iOS package.
   - Open the generated projects in Android Studio / Xcode, sign them with your developer accounts and submit.

2. **Capacitor**
   - Create a Capacitor shell and point `webDir` at this repository's `app/` directory, or configure `server.url` to the hosted `/app/` URL.
   - Using `server.url` with the live HTTPS app keeps `/api/...` calls working without CORS changes.
   - Add the iOS/Android platforms, open them in Xcode/Android Studio, sign and submit.
   - Store review of thin web wrappers can be strict; make sure the app has a clear restaurant purpose and does not only mirror a marketing page.

For either route, the live site must be deployed with HTTPS first, and the admin/API backend must remain reachable from the wrapper.

---

## API summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | no | Health check. |
| `GET` | `/data/menu.json` | no | Menu JSON. |
| `POST` | `/api/reservations` | no | Create a reservation request. |
| `POST` | `/api/orders` | no | Create a collection/delivery request. |
| `GET` | `/api/admin/data` | Bearer | Dashboard data and stats. |
| `PATCH` | `/api/admin/reservations/{id}` | Bearer | Set reservation status. |
| `PATCH` | `/api/admin/orders/{id}` | Bearer | Set order status. |

Public write endpoints are rate limited to 24 requests per IP per 5 minutes. Request bodies are limited to 24 KB. Prices and totals are always recalculated on the server from `shared/menu.json`.

---

## Project layout

```text
mersin-tantuni/
├── app/                     Installable PWA
│   ├── assets/              App CSS, JS, menu copy, images, icons
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── offline.html
│   └── sw.js
├── static/                  Website and admin dashboard
│   ├── assets/              Site CSS, JS, menu copy, images, icons
│   ├── index.html
│   ├── menu.html
│   ├── order.html
│   ├── reservations.html
│   ├── admin.html
│   ├── robots.txt
│   └── sitemap.xml
├── shared/menu.json         Canonical menu and restaurant data
├── mersin/                  Python package
│   ├── api.py               Validation and API routing
│   ├── config.py            Paths, env vars, statuses
│   ├── db.py                SQLite schema and queries
│   └── server.py            HTTP server, routing, headers
├── tests/                   unittest suite
├── data/                    SQLite database and admin token (ignored by git)
├── run.py                   Entry point
└── README.md
```

---

## Operational notes

- Opening hours are 12:00–00:00 daily, Europe/London.
- Delivery is local; the restaurant should confirm availability and postcode by phone.
- Alcohol is collection only. The API enforces this.
- Sea bass is market price and not orderable online.
- Address: 11 Stoke Newington Road, Hackney, London N16 8BH.
- Phone: 020 7923 3797 (international +44 20 7923 3797), alternate 020 3893 3136.
- Email: info@mersintantunidalston.co.uk.

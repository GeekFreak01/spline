# Hosting Spline as a website

`spline --web :8080` serves the editor as a public website. Saving to disk,
file associations, self-update and the app window are off; visitors save
`.sp` files and fonts through their browser. Font export runs on the server
with limits (8 MB per project, 30 exports per minute per visitor, a few
builds at a time).

## Run with Docker and automatic HTTPS

Needs a server with Docker and a domain whose DNS points to it.

```bash
git clone https://github.com/GeekFreak01/spline
cd spline/deploy
cp .env.example .env        # set SPLINE_DOMAIN
cp -r site.example site     # optional site-specific files
docker compose up -d --build
```

Caddy gets a Let's Encrypt certificate on the first request. To update:

```bash
git pull && docker compose up -d --build
```

## Behind an existing nginx / Caddy

If the server already runs a web server on ports 80/443, start only the
editor container on localhost and proxy to it:

```bash
docker compose -f docker-compose.nginx.yml up -d --build   # 127.0.0.1:8095
```

An nginx site is in `nginx.conf.example` (`certbot --nginx -d your.domain`
adds HTTPS). nginx sets `X-Forwarded-For` to the visitor address, which
`--trust-proxy` uses for the per-visitor limit.

## Site-specific files (`deploy/site/`)

Not part of the repository (`.gitignore`), read on every page load:

| File | Purpose |
|---|---|
| `head.html` | Inserted into `<head>`: meta tags, analytics, ad scripts |
| `sidebar.html` | Shown at the bottom of the left panel |
| `ads.txt`, `privacy.html`, `robots.txt`, … | Served as plain files at the site root |

If `privacy.html` exists, the Help menu links to it.

## Without Docker

```bash
go build -o spline .
./spline --web :8080 --host spline.example.com --site-dir ./deploy/site --trust-proxy
```

Put it behind a reverse proxy with HTTPS (Caddy, nginx). Use `--trust-proxy`
only behind a proxy, so the per-visitor limit sees real addresses.

#!/usr/bin/env python3
"""Serve GovDash over HTTPS on all interfaces for Mac + phone LAN preview."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen
from datetime import datetime
import json
import ssl
import sys
import time

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8770
CERT = ROOT / ".local-cert.pem"
KEY = ROOT / ".local-key.pem"
R46 = ROOT / "certs" / "sectigo-r46.pem"

FISCAL_BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
FISCAL_DATASETS = {
    "debt_to_penny": "/v2/accounting/od/debt_to_penny",
    "interest_expense": "/v2/accounting/od/interest_expense",
    "mts_table_1": "/v1/accounting/mts/mts_table_1",
    "mts_table_4": "/v1/accounting/mts/mts_table_4",
}
FISCAL_PARAMS = ("sort", "page[size]", "page[number]", "fields", "filter")

_fiscal_ssl = None
LEGS_URL = (
    "https://unitedstates.github.io/congress-legislators/legislators-current.json"
)
_legs = None
_legs_at = 0


def _http_json(url, timeout=20):
    req = Request(
        url, headers={"User-Agent": "GovDash/1", "Accept": "application/json"}
    )
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _legislators():
    global _legs, _legs_at
    now = time.time()
    if _legs is not None and now - _legs_at < 6 * 3600:
        return _legs
    _legs = _http_json(LEGS_URL, timeout=30)
    _legs_at = now
    return _legs


def _current_term(person):
    terms = person.get("terms") or []
    return terms[-1] if terms else {}


def _match_members(legs, state, district):
    house = []
    senate = []
    for p in legs:
        t = _current_term(p)
        if t.get("state") != state:
            continue
        name = (p.get("name") or {}).get("official_full") or ""
        rec = {
            "name": name,
            "party": t.get("party") or "",
            "phone": t.get("phone") or "",
            "url": t.get("url") or "",
            "state": state,
            "chamber": "senate" if t.get("type") == "sen" else "house",
            "district": None if t.get("type") == "sen" else t.get("district"),
        }
        if t.get("type") == "sen":
            senate.append(rec)
        elif t.get("type") == "rep" and int(t.get("district") or 0) == int(district):
            house.append(rec)
    return house + senate


def lookup_you(zip_code):
    place = _http_json("https://api.zippopotam.us/us/" + zip_code)
    loc = (place.get("places") or [None])[0]
    if not loc:
        raise KeyError("Unknown ZIP")
    state = loc.get("state abbreviation")
    lat = loc.get("latitude")
    lng = loc.get("longitude")
    census = _http_json(
        "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
        "?x=%s&y=%s&benchmark=Public_AR_Current&vintage=Current_Current&format=json"
        % (lng, lat)
    )
    geos = ((census.get("result") or {}).get("geographies") or {})
    cd = (geos.get("119th Congressional Districts") or [{}])[0]
    raw = str(cd.get("CD119") or "")
    district = int(raw) if raw.isdigit() else 0
    members = _match_members(_legislators(), state, district)
    return {
        "zip": zip_code,
        "city": loc.get("place name"),
        "state": state,
        "stateName": loc.get("state") or state,
        "district": district,
        "atLarge": district == 0,
        "members": members,
    }


def fy_window():
    now = datetime.now()
    fy = now.year + 1 if now.month >= 10 else now.year
    return fy, "%d-10-01" % (fy - 1), now.strftime("%Y-%m-%d")


def usaspending_agencies(location, start, end):
    payload = json.dumps(
        {
            "filters": {
                "time_period": [{"start_date": start, "end_date": end}],
                "place_of_performance_locations": [location],
            },
            "limit": 8,
        }
    ).encode()
    req = Request(
        "https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/",
        data=payload,
        headers={
            "User-Agent": "GovDash/1",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=25, context=fiscal_ssl()) as r:
        data = json.loads(r.read().decode())
    out = []
    for row in data.get("results") or []:
        out.append(
            {
                "name": row.get("name") or "",
                "code": row.get("code") or "",
                "agencySlug": row.get("agency_slug") or "",
                "amount": float(row.get("amount") or 0),
            }
        )
    return out


def lookup_spend(zip_code):
    place = _http_json("https://api.zippopotam.us/us/" + zip_code)
    loc = (place.get("places") or [None])[0]
    if not loc:
        raise KeyError("Unknown ZIP")
    state = loc.get("state abbreviation")
    fy, start, end = fy_window()
    zip_agencies = usaspending_agencies(
        {"country": "USA", "zip": zip_code}, start, end
    )
    state_agencies = usaspending_agencies(
        {"country": "USA", "state": state}, start, end
    )
    return {
        "zip": zip_code,
        "city": loc.get("place name"),
        "state": state,
        "stateName": loc.get("state") or state,
        "fy": fy,
        "start": start,
        "end": end,
        "zipAgencies": zip_agencies,
        "stateAgencies": state_agencies,
    }


def fiscal_ssl():
    """Trust Sectigo R46 — missing from the macOS 12 store, required by Treasury."""
    global _fiscal_ssl
    if _fiscal_ssl is None:
        ctx = ssl.create_default_context()
        if R46.exists():
            ctx.load_verify_locations(str(R46))
        _fiscal_ssl = ctx
    return _fiscal_ssl


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.rstrip("/") == "/api/fiscal":
            self.proxy_fiscal(parsed)
            return
        if parsed.path.rstrip("/") == "/api/you":
            self.proxy_you(parsed)
            return
        if parsed.path.rstrip("/") == "/api/spend":
            self.proxy_spend(parsed)
            return
        super().do_GET()

    def proxy_fiscal(self, parsed):
        qs = parse_qs(parsed.query, keep_blank_values=False)
        dataset = (qs.get("dataset") or [""])[0]
        path = FISCAL_DATASETS.get(dataset)
        if not path:
            self.send_error(400, "bad dataset")
            return
        params = [(k, qs[k][0]) for k in FISCAL_PARAMS if k in qs and qs[k]]
        url = FISCAL_BASE + path
        if params:
            url += "?" + urlencode(params)
        req = Request(
            url,
            headers={"User-Agent": "GovDash/1", "Accept": "application/json"},
        )
        try:
            with urlopen(req, context=fiscal_ssl(), timeout=30) as r:
                body = r.read()
                status = r.status
                ctype = r.headers.get("Content-Type", "application/json")
        except HTTPError as e:
            body = e.read() or str(e).encode()
            status = e.code
            ctype = "application/json"
        except Exception as e:
            body = json.dumps({"error": str(e)}).encode()
            status = 502
            ctype = "application/json"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def proxy_you(self, parsed):
        qs = parse_qs(parsed.query, keep_blank_values=False)
        zip_code = "".join(c for c in (qs.get("zip") or [""])[0] if c.isdigit())[:5]
        if len(zip_code) != 5:
            body = json.dumps({"error": "Need a 5-digit ZIP"}).encode()
            self.send_response(400)
        else:
            try:
                payload = lookup_you(zip_code)
                body = json.dumps(payload).encode()
                self.send_response(200)
            except HTTPError as e:
                status = 404 if e.code == 404 else 502
                msg = "Unknown ZIP" if e.code == 404 else str(e)
                body = json.dumps({"error": msg}).encode()
                self.send_response(status)
            except KeyError:
                body = json.dumps({"error": "Unknown ZIP"}).encode()
                self.send_response(404)
            except Exception as e:
                body = json.dumps({"error": str(e)}).encode()
                self.send_response(502)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def proxy_spend(self, parsed):
        qs = parse_qs(parsed.query, keep_blank_values=False)
        zip_code = "".join(c for c in (qs.get("zip") or [""])[0] if c.isdigit())[:5]
        if len(zip_code) != 5:
            body = json.dumps({"error": "Need a 5-digit ZIP"}).encode()
            self.send_response(400)
        else:
            try:
                payload = lookup_spend(zip_code)
                body = json.dumps(payload).encode()
                self.send_response(200)
            except HTTPError as e:
                status = 404 if e.code == 404 else 502
                msg = "Unknown ZIP" if e.code == 404 else str(e)
                body = json.dumps({"error": msg}).encode()
                self.send_response(status)
            except KeyError:
                body = json.dumps({"error": "Unknown ZIP"}).encode()
                self.send_response(404)
            except Exception as e:
                body = json.dumps({"error": str(e)}).encode()
                self.send_response(502)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        path = (self.path or "").split("?", 1)[0].lower()
        if path.endswith(
            (
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".ico",
                ".webmanifest",
                ".svg",
            )
        ) or path.endswith("manifest.webmanifest"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def _lan_ips():
    ips = []
    try:
        import socket

        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    try:
        import subprocess

        for iface in ("en0", "en1", "en2"):
            out = subprocess.check_output(
                ["ipconfig", "getifaddr", iface], stderr=subprocess.DEVNULL, text=True
            ).strip()
            if out and out not in ips:
                ips.insert(0, out)
    except Exception:
        pass
    return ips


def main():
    mode = "https"
    argv = [a for a in sys.argv[1:] if a]
    port = DEFAULT_PORT
    if argv and argv[0] in ("--http", "http"):
        mode = "http"
        argv = argv[1:]
    if argv:
        port = int(argv[0])

    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    lan = _lan_ips()
    lan_hint = lan[0] if lan else "<this-mac-ip>"

    if mode == "https":
        if not CERT.exists() or not KEY.exists():
            print("Missing .local-cert.pem / .local-key.pem", file=sys.stderr)
            print("Generate with:", file=sys.stderr)
            print(
                '  openssl req -x509 -newkey rsa:2048 -nodes '
                '-keyout .local-key.pem -out .local-cert.pem -days 825 '
                '-subj "/CN=localhost"',
                file=sys.stderr,
            )
            sys.exit(1)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=str(CERT), keyfile=str(KEY))
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        print("GovDash HTTPS", flush=True)
        print(f"  Mac:    https://127.0.0.1:{port}/", flush=True)
        for ip in lan:
            print(f"  device: https://{ip}:{port}/", flush=True)
        if not lan:
            print(f"  device: https://{lan_hint}:{port}/", flush=True)
        print("  Self-signed: Advanced → proceed on first visit.", flush=True)
    else:
        print("GovDash HTTP", flush=True)
        print(f"  Mac:    http://127.0.0.1:{port}/", flush=True)
        for ip in lan:
            print(f"  device: http://{ip}:{port}/", flush=True)

    print(f"  Dir:    {ROOT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()

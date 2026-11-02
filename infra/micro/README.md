# Connect on one Oracle Always Free Micro + Cloudflare Pages

Peer-to-peer version: video goes directly between browsers. Costs nothing.

| Piece | Where |
|---|---|
| Frontend (static React build) | Cloudflare Pages (free, commercial use allowed) |
| Caddy (HTTPS), backend, Postgres, Redis, coturn (TURN) | Oracle `VM.Standard.E2.1.Micro` |

## Limits

- **Rooms:** meetings up to 6 people, streams up to 15 viewers at 720p
  (`MEET_MAX_PARTICIPANTS`, `STREAM_MAX_VIEWERS`). These are limits of the
  *users'* upload and CPU in a peer-to-peer mesh, not of this server. Bigger
  rooms need an SFU (LiveKit, see `../oracle/`) on a bigger machine.
- **The Micro:** 1/8 OCPU guaranteed (short bursts above), 1 GB RAM, ~50 Mbps
  to the internet. Signalling and the API are light. TURN relays only the
  ~10-15% of users whose network blocks direct connections, capped at 1 Mbps
  each and 40 at once (`../coturn/turnserver.conf`). Not yet load-tested on a
  real Micro; check `sudo docker stats` and `free -m` during the first real
  sessions.
- **Idle reclamation:** Oracle may stop Always Free instances whose CPU stays
  under 20% for 7 days. `setup-host.sh` installs a keep-alive cron that holds
  the CPU at ~25% at the lowest priority (the app always wins). If Oracle
  stops it anyway, data survives, but the site is down until you start it
  again, so also watch `https://<API_DOMAIN>/api/auth/providers` with a free
  uptime monitor (e.g. UptimeRobot). Remove the keep-alive with
  `sudo rm /etc/cron.d/connect-keepalive`.

## 1. Oracle console

1. **Security List** of the instance's subnet → Add Ingress Rules, source
   `0.0.0.0/0`:
   - TCP 80, 443, 3478
   - UDP 3478, 49152-49999
2. Note the instance's **public IP** and **private IP** (Instance → Attached
   VNICs).

## 2. API name

Either:

- **Your own domain:** an `A` record, e.g. `connect-api.example.com`, to the
  public IP. On Cloudflare DNS set it to **DNS only** (grey cloud): TURN's UDP
  can't go through Cloudflare's proxy, and Caddy needs port 80 for its
  certificate. Leave `DUCKDNS_TOKEN` empty. If the instance's IP ever
  changes, update this record and `PUBLIC_IP`.
- **DuckDNS:** create one name (e.g. `connect-api`) pointing at the public IP
  and put your token in `DUCKDNS_TOKEN`; a cron keeps it updated.

## 3. Cloudflare Pages: pick the URL first

The backend must know the frontend's URL (CORS), so decide the Pages project
name now: project `connect-acme` will live at `https://connect-acme.pages.dev`.

## 4. The Micro

```bash
# Free RAM: the remote desktop alone uses ~300 MB while connected.
sudo systemctl disable --now xrdp

git clone -b fix/security-sd-cap https://github.com/sreejithSHR/Connect-backend.git
cd Connect-backend/infra/micro
cp .env.example .env
nano .env          # API_DOMAIN, DUCKDNS_TOKEN, APP_ORIGIN, IPs, secrets
                   # (generate secrets with: openssl rand -hex 32)

sudo REMOVE_COOLIFY=1 ./setup-host.sh   # leave REMOVE_COOLIFY out if it isn't installed
sudo docker compose up -d --build       # first build: 10-20 min on 1/8 CPU
```

Check (the first start runs migrations; give it a couple of minutes):

```bash
sudo docker compose ps
curl https://<API_DOMAIN>/api/auth/providers   # {"password":true,"google":...}
free -m
```

## 5. Cloudflare Pages

dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git →
`Connect-Client`:

| Setting | Value |
|---|---|
| Project name | the one from step 3 |
| Production branch | `fix/security-sd-cap` (or `main` once merged) |
| Framework preset | Create React App |
| Build command | `npm run build` |
| Build output directory | `build` |

Environment variables (Production):

| Name | Value |
|---|---|
| `REACT_APP_API_URL` | `https://<API_DOMAIN>` |
| `REACT_APP_SOCKET_URL` | `https://<API_DOMAIN>` |
| `NODE_VERSION` | `22` |
| `CI` | `false` (otherwise lint warnings fail the build) |

Pushing to the branch redeploys. For the client's own domain: Pages project →
Custom domains, then add it to `APP_ORIGIN` and restart the backend.

## 6. Google sign-in (optional)

Google Cloud Console → APIs & Services → Credentials → OAuth client ID →
Web application. Authorized JavaScript origins: the Pages URL (and the custom
domain). Put the client ID in `GOOGLE_CLIENT_ID`, then
`sudo docker compose up -d backend`.

## Updating

```bash
cd ~/Connect-backend && git pull
cd infra/micro && sudo docker compose up -d --build backend
```

## Backups

`setup-host.sh` installs a nightly `pg_dump` to `/var/backups/connect`
(kept 14 days). That's on the same disk, so copy them off now and then, e.g.
from Windows: `scp oracle:/var/backups/connect/*.gz .`

Restore (into an empty database, e.g. on a fresh instance before the first
backend start):

```bash
gunzip -c connect-YYYY-MM-DD.sql.gz | sudo docker exec -i connect-db psql -U connect connect
```

## Troubleshooting

- **Certificate errors / Caddy restarting:** port 80 must be open in both
  firewalls and the DuckDNS name must point at this IP
  (`sudo docker compose logs caddy`).
- **CORS errors in the browser:** `APP_ORIGIN` must exactly match the page's
  URL (scheme, no trailing slash). `sudo docker compose up -d backend` after
  changing it.
- **Calls connect on Wi-Fi but not on mobile data / office networks:** TURN.
  Check UDP 3478 and 49152-49999 in the Security List, and that `PUBLIC_IP` is
  still the instance's IP (it's needed in `.env` as well as DuckDNS).
- **Out of memory:** `free -m`, `sudo docker stats`. Make sure xrdp and Coolify
  are gone.

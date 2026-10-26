# Deploying Connect on Oracle A1 + Coolify

| Runs in | What |
|---|---|
| Coolify | Postgres, Redis, backend (`Connect-backend`), frontend (`Connect-Client`) |
| This folder (`docker compose`) | LiveKit + coturn: they need the host's real UDP/TCP ports |
| Coolify's Traefik | HTTPS for all three domains; `livekit-traefik.yaml` routes the LiveKit one |

## 1. Domains (DuckDNS, free)
At duckdns.org create three names and point them at the instance's public IP:
`connect-…` (app), `connect-api-…` (backend), `connect-live-…` (LiveKit).
`setup-host.sh` keeps them updated if the IP ever changes.

## 2. Firewalls and media services (on the instance)
```bash
git clone https://github.com/sreejithSHR/Connect-backend.git && cd Connect-backend/infra/oracle
cp .env.example .env && nano .env      # secrets: openssl rand -hex 32
sudo ./setup-host.sh                    # iptables + DuckDNS cron
docker compose up -d                    # LiveKit + coturn
```
Also add the VCN Security List ingress rules listed at the top of `setup-host.sh`.

## 3. Coolify
In one project (e.g. `connect`), same environment:

1. **+ New → Database → PostgreSQL 16** → Start. Copy the **Postgres URL (internal)**.
2. **+ New → Database → Redis** → Start. Copy the **Redis URL (internal)**.
3. **+ New → Application → `Connect-backend` repo**
   - Build pack **Dockerfile**, port **5000**, domain `https://<API_DOMAIN>`
   - Health check path `/api/health`
   - Environment variables:
     ```
     NODE_ENV=production
     DATABASE_URL=<Postgres internal URL>
     REDIS_URL=<Redis internal URL>
     JWT_SECRET=<openssl rand -hex 32>
     ORIGIN=https://<APP_DOMAIN>
     TURN_URLS=turn:<LIVE_DOMAIN>:3478?transport=udp,turn:<LIVE_DOMAIN>:3478?transport=tcp
     TURN_SECRET=<same as .env>
     STREAM_MAX_VIEWERS=15
     MEET_MAX_PARTICIPANTS=6
     GOOGLE_CLIENT_ID=<step 4, optional>
     ```
   - Deploy. Migrations run automatically on start.
4. **+ New → Application → `Connect-Client` repo**
   - Build pack **Dockerfile**, port **80**, domain `https://<APP_DOMAIN>`
   - Environment variables, both ticked **Build Variable**:
     ```
     REACT_APP_API_URL=https://<API_DOMAIN>
     REACT_APP_SOCKET_URL=https://<API_DOMAIN>
     ```
5. **Servers → localhost → Proxy → Dynamic Configurations** → add `livekit.yaml`
   with the contents of `livekit-traefik.yaml` (replace `LIVE_DOMAIN`).

## 4. Google sign-in (optional)
Google Cloud Console → APIs & Services:
1. **OAuth consent screen**: External, app name, support email.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized JavaScript origins: `https://<APP_DOMAIN>` (and `http://localhost:3000`
   for local dev). No redirect URIs needed.
3. Put the client ID in the backend's `GOOGLE_CLIENT_ID` and redeploy the backend.
   The frontend picks it up from `/api/auth/providers`, no rebuild needed.

## 5. Check
```bash
curl https://<API_DOMAIN>/api/health          # {"status":"ok",...}
curl https://<LIVE_DOMAIN>/                    # OK
docker compose logs coturn | tail              # no ERROR lines
```
Then open `https://<APP_DOMAIN>`, create an account, start a meeting.

## Troubleshooting
- **Certificate errors right after deploy**: Let's Encrypt is still issuing; wait a
  minute and check the DuckDNS name resolves to the instance (`nslookup`).
- **502 on the LiveKit domain**: see the `host.docker.internal` check at the top of
  `livekit-traefik.yaml`, and that `setup-host.sh` ran (it allows 7880 from Docker).
- **Calls connect but video is black**: UDP ports missing from the Security List.

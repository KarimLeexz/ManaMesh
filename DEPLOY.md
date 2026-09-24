# Deploying to Hetzner

Runs the app behind Caddy (automatic HTTPS) with an optional coturn TURN
server for players behind strict NAT/CGNAT.

## 1. Server & domain

1. Create a Hetzner Cloud server, **at least 2 GB RAM** (4 GB is more comfortable),
   image: the **Docker CE app** (Apps tab, not plain Ubuntu — ships with Docker
   preinstalled), with your SSH key added.
2. Add 2 GB of swap on the server (cheap safety net on a small instance):
   ```bash
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ```
3. Point your domain's **A record** (and optionally AAAA) at the server's public IP.
   HTTPS (required for camera access in the browser) only works with a real domain,
   not a bare IP.

## 2. Firewall

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 49152:65535/udp
ufw --force enable
```

(Skip the `3478`/`5349`/`49152:65535` rules if you're not using coturn.)

## 3. Get the code and data onto the server

```bash
git clone <your-repo-url> manamesh
cd manamesh
```

`card_index.npz` is already committed to the repo, so `git clone` brings it along —
no manual copy needed. **Don't** deploy `card_features.pkl`; it was the old, unused
ORB database and has been removed from the repo entirely.

Create the production `.env` (it's gitignored, so this happens only on the server):

```bash
cp .env.example .env
# then edit: set DEBUG=False, leave the rest as-is unless you know you want to change it
```

## 4. Fill in your domain/IP, and get the TURN config onto the server

- `Caddyfile` (committed, not secret): `your-domain.example` → your real domain
- `turnserver.conf` and `frontend/turn-config.js` both hold the **same TURN
  password** and are both **gitignored** (same idea as `.env`) — they never go
  through git, only scp:
  ```bash
  cp turnserver.conf.example turnserver.conf              # fill in IP/domain/password
  cp frontend/turn-config.js.example frontend/turn-config.js  # same domain/password
  scp turnserver.conf root@<server-ip>:manamesh/turnserver.conf
  scp frontend/turn-config.js root@<server-ip>:manamesh/frontend/turn-config.js
  ```

If you don't want to bother with a TURN server yet, you can skip coturn entirely:
remove the `coturn` service from `docker-compose.yml` and don't create
`turn-config.js` at all. Some friends on restrictive networks (mobile data,
CGNAT) may then fail to establish a video connection — TURN fixes that. The
app falls back to STUN-only automatically if `turn-config.js` is missing.

## 5. Start everything

```bash
docker compose up -d --build
```

Caddy fetches a Let's Encrypt certificate for your domain automatically on
first request. Check logs with `docker compose logs -f`.

## 6. Updating later

```bash
git pull
docker compose up -d --build
```

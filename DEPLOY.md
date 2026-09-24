# Deploying to Hetzner

Runs the app and the video server (LiveKit) behind Caddy (automatic HTTPS). Every camera
goes up once to LiveKit, which forwards each viewer the quality they need.

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
ufw allow 7881/tcp     # video (LiveKit): fallback when UDP is blocked
ufw allow 7882/udp     # video (LiveKit): all cameras on one UDP port
ufw --force enable
```

Coming from the old coturn setup? Those rules (`3478`, `5349`, `49152:65535/udp`) aren't
needed any more: `ufw delete allow 3478/tcp` etc. LiveKit's own ports replace them; since
everyone connects to the server (not to each other), a TURN server is no longer necessary.

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

## 4. Domain and video server keys

- `Caddyfile` (committed, not secret): `manamesh.app` → your real domain
- `.env`: the video server's key and secret. The key is any name, the secret must be long
  and random (the backend signs join tickets with it, LiveKit checks them):
  ```bash
  echo "LIVEKIT_API_KEY=manamesh" >> .env
  echo "LIVEKIT_API_SECRET=$(openssl rand -base64 32 | tr -d '/+=')" >> .env
  ```
  and remove the `LIVEKIT_URL=ws://localhost:7880` line copied from `.env.example`
  (empty `LIVEKIT_URL` = the browser uses `https://<your domain>/livekit`, which Caddy
  forwards to LiveKit).

`livekit.yaml` (committed, no secrets) needs no changes: LiveKit finds the server's public
IP by itself (`use_external_ip`).

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

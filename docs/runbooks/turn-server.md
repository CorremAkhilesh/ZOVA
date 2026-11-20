# TURN for calls (Part 2): plan

Calls work peer to peer with STUN alone for most home and office networks. Some networks (strict
corporate firewalls, some mobile carriers, symmetric NAT on both sides) need a **TURN relay**: without
one, such a call rings and is answered, then stays on "Connecting…" and drops after 30 seconds.

The API is ready: set `CALLS_TURN_URLS` and `CALLS_TURN_SECRET` (and keep `CALLS_TURN_TTL_SECONDS`) in
`deploy/.env.prod`, then recreate the API container. The TURN server must use coturn's
`use-auth-secret` with the **same** secret (TURN REST API credentials, see `backend/src/calls/ice.ts`).

Nothing here has been run. Real host names, addresses and secrets go only in the git-ignored
`SERVER_STEPS.local.md`, never in this file.

## What a TURN server needs

| Port        | Protocol  | Why                                                                  |
| ----------- | --------- | -------------------------------------------------------------------- |
| 3478        | UDP + TCP | STUN and TURN (the main port)                                        |
| 5349        | TCP       | TURN over TLS (`turns:`): gets through firewalls that allow only TLS |
| 49160–49359 | UDP       | Relay range: about two ports per relayed call, so ~100 calls at once |

Bandwidth: Opus voice is about 30–50 kbit/s each way. A relayed call passes through the server both
ways, so roughly **0.2 Mbit/s per relayed call**; 50 relayed calls at once is about 10 Mbit/s. Only calls
that need the relay use it (often 10–20%).

Security settings that matter on any host: `use-auth-secret`, `no-cli`, `no-multicast-peers`,
`denied-peer-ip` for every private range (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10,
fc00::/7, fe80::/10) so the relay can never reach the host's own network or Docker, `user-quota` and
`total-quota`, `bps-capacity`, and `no-tlsv1`/`no-tlsv1_1`.

## Option A: coturn in Docker on the shared company server

- **Ports:** 3478/udp+tcp, 5349/tcp and the relay range must be open on the host firewall. coturn needs
  `network_mode: host` (Docker's port mapping of a 200-port UDP range is slow and breaks relay
  addresses), so it shares the host's network stack with the other companies' apps.
- **Nginx:** not involved for 3478/5349. TURN on 443 (the friendliest port) would need Nginx `stream`
  SNI routing in front of the existing sites: a change to the shared host Nginx, which we do not make.
- **TLS:** 5349 needs a certificate for the TURN name (for example `turn.corremadvisory.com`); getting
  it with Certbot means another site entry or a DNS challenge on the shared server.
- **Risk to other apps:** a new public UDP surface on a server that is not only ours; relay traffic and
  CPU compete with their apps; a misconfigured relay could reach internal Docker networks (the
  `denied-peer-ip` list above prevents that). Docker bypasses ufw for published ports, so the firewall
  must be checked by hand.
- **Good:** one place for everything, no extra cost.

## Option B: reuse the coturn on the separate EasyDrop VPS

- A separate server: nothing changes on the shared company server, its firewall or its Nginx.
- **Separation:** Zuvo gets its **own secret**, so either product can rotate or revoke its credentials
  without touching the other. A separate **realm** needs coturn's database mode (secrets per realm in
  its SQLite/Redis DB); with only `static-auth-secret` in the config file, both products share one realm,
  which is fine for credentials made per user and per hour.
- **Bad:** Zuvo calls depend on a server that belongs to another product (its maintenance, its outages,
  its bandwidth); its logs mix both products (coturn logs only addresses and usernames, never audio);
  a quota set for one product affects the other.

## Recommendation: B now, and a small dedicated VPS if calls grow

Option B adds no risk to the shared company server, needs no Nginx change, and the VPS already runs
coturn. Voice relay traffic is small. If calls become heavy, or EasyDrop's server changes hands, move
TURN to its own small VPS with the same settings; only `CALLS_TURN_URLS` and `CALLS_TURN_SECRET` change.

## Steps for Option B (prepared, not run)

Run on the **EasyDrop VPS** in PuTTY. Step 0 only reads; send its output before going further, because
the layout (Docker or a system package, file path, secret style) decides the exact edit.

### 0. Look (read only)

```bash
sudo docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep -i turn || true
systemctl status coturn --no-pager 2>/dev/null | head -5 || true
sudo grep -nE '^(listening-port|tls-listening-port|min-port|max-port|realm|use-auth-secret|static-auth-secret|userdb|denied-peer-ip|external-ip)' \
  /etc/turnserver.conf /etc/coturn/turnserver.conf 2>/dev/null | sed 's/static-auth-secret=.*/static-auth-secret=<hidden>/'
sudo ss -lunpt | grep -E ':(3478|5349)\b'
```

### 1. Back up the configuration

```bash
CONF=/etc/turnserver.conf   # or the path step 0 showed
sudo cp -a "$CONF" "$CONF.bak-$(date +%F-%H%M)"
sudo ls -l "$CONF"*
```

### 2. Make Zuvo's secret

```bash
openssl rand -hex 32   # copy it; it goes into the coturn DB and into Zuvo's deploy/.env.prod
```

### 3a. If coturn uses its database (`userdb=` set, or no `static-auth-secret` line)

```bash
sudo turnadmin --set-secret=<ZUVO_SECRET> --realm=zuvo.corremadvisory.com   # add -b <userdb path> if set
sudo turnadmin --show-secret --realm=zuvo.corremadvisory.com
```

### 3b. If coturn uses `static-auth-secret=` in the file

Switching it to the database keeps EasyDrop working with its current secret and adds Zuvo's:

```bash
EASYDROP_SECRET=$(sudo sed -n 's/^static-auth-secret=//p' "$CONF")
sudo turnadmin --set-secret="$EASYDROP_SECRET" --realm=<easydrop realm from step 0>
sudo turnadmin --set-secret=<ZUVO_SECRET> --realm=zuvo.corremadvisory.com
sudo sed -i 's/^static-auth-secret=/# static-auth-secret= (moved to the coturn DB) /' "$CONF"
```

### 4. Hardening lines (add only those step 0 did not show)

```bash
sudo tee -a "$CONF" > /dev/null <<'CONF'
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
user-quota=12
total-quota=200
CONF
```

### 5. Restart and check

```bash
sudo systemctl restart coturn   # or: sudo docker restart <coturn container>
sudo journalctl -u coturn -n 30 --no-pager   # or: sudo docker logs --tail 30 <container>
```

Test from a laptop at https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ with a
username/password from `GET /v1/calls/ice` (signed in as an admin): a `relay` candidate must appear.

### 6. Zuvo (shared company server), then recreate the API

```bash
sudo nano /var/www/zuvo/deploy/.env.prod
#   CALLS_TURN_URLS=turn:<turn host>:3478?transport=udp,turn:<turn host>:3478?transport=tcp,turns:<turn host>:5349
#   CALLS_TURN_SECRET=<ZUVO_SECRET>
sudo docker compose -p zuvo -f /var/www/zuvo/deploy/docker-compose.prod.yml up -d --no-deps --no-build --force-recreate api worker
```

### Undo

Restore the backup from step 1 (`sudo cp -a "$CONF.bak-<time>" "$CONF"`), restart coturn, and empty
both `CALLS_TURN_*` lines in Zuvo's env (calls fall back to STUN only).

# Hydra self-host backend starter

This folder contains a **starter backend** for running Hydra Launcher in self-host mode.

It provides:
- REST API endpoints used by the launcher for auth/profile/library/cloud-sync basics
- a minimal auth web flow page that redirects to `hydralauncher://auth`
- a WebSocket server that responds to `PING` with `PONG`
- artifact upload/download storage on local disk

## 1) Run locally

```bash
cd backend
cp .env.example .env
npm install
npm start
```

## 2) Run with Docker Compose

```bash
cd backend
docker compose up -d --build
```

## 3) Point Hydra Launcher to this backend

Set these values in the launcher environment:

```env
MAIN_VITE_API_URL=http://localhost:4000
MAIN_VITE_AUTH_URL=http://localhost:4000/auth
MAIN_VITE_WS_URL=ws://localhost:4001
MAIN_VITE_NIMBUS_API_URL=http://localhost:4000
MAIN_VITE_CHECKOUT_URL=http://localhost:4000/checkout
MAIN_VITE_SELF_HOST_CLOUD=true
RENDERER_VITE_SELF_HOST_CLOUD=true
```

## Notes

- This is a **starter implementation** intended to make self-hosting/deployment easy.
- It uses a local JSON store and local artifact files (under `/app/data` in Docker).
- Add your own authentication, database, multi-user model, and hardening before production use.

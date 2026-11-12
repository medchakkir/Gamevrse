# Deployment

Gamevrse is a single Node service (Express + Socket.IO), so it deploys as one web service.

## Render
`render.yaml` defines the service: build `npm install`, start `npm start`, health check `/healthz`. `ADMIN_TOKEN` is generated automatically; `PORT` is provided by Render.

## Any Node host
```bash
npm ci --omit=dev
NODE_ENV=production ADMIN_TOKEN=<secret> PORT=8080 npm start
```
Requires Node 20+. In production the server refuses to start without `ADMIN_TOKEN`.

## Notes
- Rooms are held in memory: restarts (and free-tier sleep) end live games.
- Run a single instance; there is no shared state between processes.
- Clients connect to the same origin, so no URL configuration is needed.

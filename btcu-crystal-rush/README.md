# BTCU — Crystal Rush

A room-code, no-login, real-time multiplayer browser game for 2–8 players.

## Gameplay
Players enter a room, wait in the lobby, then race around the arena for 60 seconds and collect crystals. Green crystals are worth 1 point; rare gold crystals are worth 3 points.

Controls:
- Desktop: WASD or arrow keys
- Mobile: on-screen directional buttons

## Local run
```bash
npm install
npm start
```
Then open `http://localhost:10000` in two browser windows/devices.

## Deploy on Render
This repository includes `render.yaml`. Create a Render Web Service from the repo. Render supports Node.js web services and WebSocket connections; the server binds to `0.0.0.0` and uses the `PORT` environment variable. Free web services are available for testing/hobby projects but can spin down after inactivity.

Build command: `npm install`
Start command: `npm start`
Health check: `/health`

## Submission checklist
- Public game URL
- Room-code join test with 2+ devices
- Mobile + desktop test
- Screenshot/video of a live match
- GitHub repository URL

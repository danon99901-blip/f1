# Deployment Guide

## Option 1: Railway (Recommended)

### Deploy Signaling Server
1. Go to [railway.app](https://railway.app)
2. Connect GitHub repo
3. Railway auto-detects Node.js
4. Set environment variable: `WS_PORT=3001`
5. Deploy!

Your server URL: `wss://your-app.railway.app`

### Deploy Client (Vercel)
1. Go to [vercel.com](https://vercel.com)
2. Import GitHub repo
3. Set environment variable: `VITE_SIGNALING_URL=wss://your-app.railway.app`
4. Deploy!

## Option 2: Your VPS

### Server
```bash
ssh your-server
git clone <repo>
cd f1
npm install
npm run build:server

# Run with PM2 (keeps running)
npm install -g pm2
pm2 start npm --name "f1-signaling" -- run start:server
pm2 save
pm2 startup
```

### Client
Deploy to Vercel or build locally:
```bash
npm run build
# Upload dist/ to any static host
```

## Option 3: All on VPS

```bash
# Build both
npm run build
npm run build:server

# Serve client with nginx
# Run server with PM2
```

## Environment Variables

### Client (.env)
```
VITE_SIGNALING_URL=wss://your-signaling-server.com
```

### Server
```
WS_PORT=3001
```

## Testing Production

1. Deploy signaling server
2. Update VITE_SIGNALING_URL in client
3. Build and deploy client
4. Open in two different browsers/devices
5. Create lobby → share code → join → race!

# Deployment Guide

## Quick Start (Railway + Vercel)

### 1. Railway (Backend - Signaling Server)

**Your current Railway URL:** `https://f1-production-c1df.up.railway.app`

Railway автоматически деплоит при push в main. Сервер уже настроен с:
- ✅ Health check endpoint: `/health`
- ✅ WebSocket support (автоматический upgrade)
- ✅ CORS настроен для всех origins

**Проверка:**
```bash
curl https://f1-production-c1df.up.railway.app/health
```
Должен вернуть: `{"status":"ok","service":"f1-signaling-server",...}`

---

### 2. Vercel (Frontend - Game Client)

**Build Settings:**
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

**Environment Variable (ОБЯЗАТЕЛЬНО!):**
```
VITE_SIGNALING_URL=wss://f1-production-c1df.up.railway.app
```
⚠️ **Важно:** используй `wss://` (не `ws://`) для production!

**Как добавить:**
1. Vercel Dashboard → твой проект → Settings → Environment Variables
2. Добавь: `VITE_SIGNALING_URL` = `wss://f1-production-c1df.up.railway.app`
3. Redeploy проект

---

## Локальная разработка

**Запустить всё вместе:**
```bash
npm run dev:all
```
Это запустит:
- Vite dev server на `http://localhost:5173`
- Signaling server на `ws://localhost:3001`

**Только клиент:**
```bash
npm run dev
```

**Только сервер:**
```bash
npm run dev:server
```

---

## Troubleshooting

### ❌ WebSocket не подключается

**Проверь в браузере (F12 → Console):**
```
[Main] SIGNALING_URL: wss://f1-production-c1df.up.railway.app
```

Если видишь `ws://localhost:3001` — значит environment variable не установлена в Vercel!

**Решение:**
1. Vercel → Settings → Environment Variables
2. Добавь `VITE_SIGNALING_URL=wss://f1-production-c1df.up.railway.app`
3. Redeploy

---

### ❌ Railway возвращает 404

**Проверь логи:**
```bash
railway logs
```

**Проверь что сервер запущен:**
```bash
curl https://f1-production-c1df.up.railway.app/health
```

Если 404 — сервер не запустился. Проверь:
- `npm run build:server` проходит без ошибок
- `railway.json` настроен правильно

---

### ❌ Vercel build fails

**Локально проверь:**
```bash
npm run typecheck  # Проверка TypeScript
npm run test:run   # Запуск тестов
npm run build      # Сборка
```

Если локально работает, но на Vercel нет — проверь Node.js версию в Vercel settings.

---

## Option 2: VPS Deployment

### Server
```bash
ssh your-server
git clone <repo>
cd f1
npm install
npm run build:server

# Run with PM2
npm install -g pm2
pm2 start npm --name "f1-signaling" -- run start:server
pm2 save
pm2 startup
```

### Client
```bash
npm run build
# Upload dist/ to any static host (Nginx, Apache, etc.)
```

---

## Testing Multiplayer

1. **Открой игру в двух браузерах** (или на двух устройствах)
2. **Первый игрок:**
   - Multiplayer → Create Lobby
   - Введи имя
   - Скопируй 6-значный код
3. **Второй игрок:**
   - Multiplayer → Join Lobby
   - Введи имя и код
4. **Хост нажимает "Start Race"**
5. **Играй!** 🏎️

---

## Current Status

✅ Lap tracking работает  
✅ Pause menu (ESC)  
✅ Results screen  
✅ Unit tests (28 passed)  
✅ Railway backend готов  
⚠️ Нужно настроить `VITE_SIGNALING_URL` в Vercel


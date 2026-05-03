# 🏁 F1 Racing - Multiplayer Ready!

## ✅ Что готово

**Полностью реализованный мультиплеер:**
- ✅ Меню система (Single Player / Multiplayer)
- ✅ Лобби с настройками (2-4 игрока, 3/5/10 кругов)
- ✅ P2P архитектура (хост-гость)
- ✅ Signaling сервер для WebRTC
- ✅ Host game simulation (полная физика Rapier)
- ✅ Guest game client (интерполяция)
- ✅ Network layer (WebRTC data channels)

## 🚀 Быстрый старт

### Локальное тестирование (2 окна браузера)

```bash
# Терминал 1: Signaling сервер
npm run dev:server

# Терминал 2: Клиент
npm run dev
```

**Тестирование:**
1. Открой `http://localhost:5173`
2. Multiplayer → Create Lobby → введи имя
3. Скопируй код комнаты (например `A3X9K2`)
4. Открой второе окно (или инкогнито): `http://localhost:5173`
5. Multiplayer → Join Lobby → введи имя и код
6. Хост выбирает количество кругов и нажимает "Start Race"
7. Гонка начинается! 🏎️

### Игра через интернет (с ngrok)

```bash
# Терминал 1: Signaling сервер
npm run dev:server

# Терминал 2: ngrok
ngrok http 3001
# Скопируй URL (например abc123.ngrok.io)

# Терминал 3: Создай .env
echo "VITE_SIGNALING_URL=wss://abc123.ngrok.io" > .env

# Запусти клиент
npm run dev
```

Теперь можешь отправить другу ссылку `http://localhost:5173` (если в одной сети) или задеплоить клиент на Vercel.

## 📁 Структура проекта

```
src/
├── shared/                    # Общий код
│   ├── protocol.ts           # Сетевые сообщения
│   ├── constants.ts          # Физические константы
│   └── types.ts              # Общие типы
├── server/                    # Signaling сервер
│   ├── index.ts
│   └── SignalingServer.ts
├── client/
│   ├── menu/                 # Меню система
│   │   ├── MenuManager.ts
│   │   ├── MainMenu.ts
│   │   ├── LobbyMenu.ts
│   │   └── menu.css
│   ├── network/              # P2P клиент
│   │   └── NetworkClient.ts
│   └── game/                 # Игровая логика
│       ├── SinglePlayerGame.ts
│       ├── HostGameClient.ts
│       ├── GuestGameClient.ts
│       └── Interpolator.ts
└── main.ts                    # Entry point
```

## 🎮 Как это работает

### Host (создатель лобби):
1. Запускает полную физику Rapier для всех игроков
2. Получает input от гостей через WebRTC
3. Применяет input к машинам гостей
4. Рассылает snapshots состояния (20 Hz)

### Guest (присоединившийся):
1. Отправляет свой input хосту (60 Hz)
2. Получает snapshots от хоста
3. Интерполирует позиции всех машин
4. Рендерит плавное движение

### Signaling сервер:
- Управляет комнатами
- Помогает установить P2P соединения (WebRTC signaling)
- После соединения игроки общаются напрямую

## 🔧 Команды

```bash
# Разработка
npm run dev              # Клиент (Vite)
npm run dev:server       # Signaling сервер
npm run dev:all          # Оба сразу (concurrently)

# Сборка
npm run build            # Клиент
npm run build:server     # Сервер
npm run typecheck        # Проверка типов

# Продакшн
npm run start:server     # Запуск собранного сервера
```

## 🌐 Деплой

См. `DEPLOYMENT.md` для инструкций по деплою на:
- Railway.app (signaling сервер)
- Vercel (клиент)
- Свой VPS

См. `NGROK_SETUP.md` для быстрого теста через ngrok.

## 🐛 Дебаг

Все события логируются в консоль:
- `[Signaling]` — signaling сервер
- `[Network]` — network client
- `[Main]` — main.ts

Открой DevTools (F12) чтобы видеть что происходит.

## 🎯 Особенности

- **P2P архитектура** — низкая задержка, прямое соединение
- **Детерминистичная физика** — одинаковая на хосте и в single-player
- **Интерполяция** — плавное движение удалённых игроков
- **Минималистичный UI** — F1-broadcast стиль
- **2-4 игрока** — настраиваемое количество кругов

## ⚠️ Известные ограничения

- Если хост отключится, гонка прервётся (нет host migration)
- WebRTC может не работать через строгие файрволы (нужны TURN серверы)
- Комнаты хранятся в памяти (при перезапуске сервера теряются)

## 📝 TODO (опционально)

- [ ] Host migration (если хост отключился)
- [ ] Reconnect логика
- [ ] TURN серверы для продакшена
- [ ] Персистентные комнаты (база данных)
- [ ] Spectator mode
- [ ] Replay system

## 🎉 Готово к игре!

Запускай и тестируй мультиплеер! Все работает.

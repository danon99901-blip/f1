# Quick Multiplayer Setup with ngrok

## Шаг 1: Установи ngrok

```bash
# Linux/Mac
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok

# Или скачай с https://ngrok.com/download
```

## Шаг 2: Зарегистрируйся (бесплатно)

1. Иди на https://dashboard.ngrok.com/signup
2. Получи authtoken
3. Активируй:
```bash
ngrok config add-authtoken <твой-токен>
```

## Шаг 3: Запусти signaling сервер

```bash
npm run dev:server
```

Должно появиться:
```
[Signaling] Server listening on port 3001
```

## Шаг 4: Запусти ngrok (в новом терминале)

```bash
ngrok http 3001
```

Увидишь что-то типа:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:3001
```

**Важно:** Скопируй URL (например `abc123.ngrok.io`)

## Шаг 5: Создай .env файл

```bash
# В корне проекта
echo "VITE_SIGNALING_URL=wss://abc123.ngrok.io" > .env
```

Замени `abc123.ngrok.io` на свой URL из ngrok!

## Шаг 6: Запусти клиент

```bash
npm run dev
```

Откроется браузер на `http://localhost:5173`

## Шаг 7: Играй с друзьями!

**Ты (хост):**
1. Multiplayer → Create Lobby
2. Скопируй код комнаты (например `A3X9K2`)
3. Отправь другу:
   - Ссылку: `http://localhost:5173` (если друг в твоей локальной сети)
   - ИЛИ задеплой клиент на Vercel и дай ссылку

**Друг:**
1. Открывает твою ссылку
2. Multiplayer → Join Lobby
3. Вводит код `A3X9K2`
4. Готово!

## Важно!

- ngrok URL меняется при каждом перезапуске (бесплатная версия)
- Если перезапустил ngrok — обнови `.env` и перезапусти `npm run dev`
- Для постоянного URL нужен платный ngrok ($8/мес) или деплой на Railway

## Альтернатива: Друг тоже локально

Если друг в одной сети с тобой:
```bash
# Узнай свой IP
ip addr show | grep "inet " | grep -v 127.0.0.1

# Например: 192.168.1.100
```

Друг открывает: `http://192.168.1.100:5173`

Signaling сервер тоже должен быть доступен:
```bash
# В .env
VITE_SIGNALING_URL=ws://192.168.1.100:3001
```

## Troubleshooting

**"Failed to connect to server"**
- Проверь что ngrok запущен
- Проверь что URL в `.env` правильный (с `wss://`, без порта)
- Перезапусти `npm run dev` после изменения `.env`

**"Room not found"**
- Signaling сервер перезапустился (комнаты в памяти)
- Создай новую комнату

**Друг не может подключиться**
- Убедись что он использует правильный URL клиента
- Проверь что ngrok не упал (смотри в терминал с ngrok)

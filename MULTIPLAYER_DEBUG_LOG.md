# Multiplayer Debug Logging - Test Instructions

## Что было добавлено

Добавлено детальное логирование во все ключевые точки синхронизации мультиплеера:

### 1. NetworkClient - Отправка данных
- **broadcastToGuests()** - Хост отправляет снапшоты гостям (логируется каждый 50-й)
- **sendToHost()** - Гость отправляет инпуты хосту (логируется каждый 50-й)

### 2. NetworkClient - Получение данных
- **channel.onmessage** - Логирует все входящие сообщения:
  - Хост получает инпуты от гостей (каждый 50-й)
  - Гость получает снапшоты от хоста (каждый 50-й)

### 3. NetworkClient - Состояние каналов
- **setupDataChannel()** - Логирует открытие/закрытие DataChannel

### 4. RacingState - Обработка на госте
- **handleHostSnapshot()** - Обработка снапшотов от хоста (уже было)
- **flushPendingSnapshots()** - Обработка буферизованных снапшотов (уже было)

### 5. RacingState - Обработка на хосте
- **handleGuestInput()** - Получение инпутов от гостя (уже было)
- **updateGuestVehicles()** - Применение инпутов к физике гостя (уже было)

## Как тестировать

### Шаг 1: Запустить игру
```bash
npm run dev
```

### Шаг 2: Открыть две вкладки браузера
- Вкладка 1 (Хост): Создать комнату
- Вкладка 2 (Гость): Присоединиться к комнате

### Шаг 3: Открыть консоль разработчика (F12) в обеих вкладках

### Шаг 4: Начать гонку и двигаться

### Шаг 5: Собрать логи

Искать следующие ключевые сообщения:

#### На хосте:
```
[Network] ✅ Data channel OPEN with <guestId>
[Network] HOST BROADCAST: Sent X snapshots
[Network] HOST RECEIVED: Input from <guestId>
[HOST_INPUT] Received input from guest
[HOST_GUEST_UPDATE] Applying input to guest
```

#### На госте:
```
[Network] ✅ Data channel OPEN with <hostId>
[Network] GUEST SEND: Sent input to host
[Network] GUEST RECEIVED: Snapshot from host
[GUEST_SNAPSHOT] Received snapshot
[GUEST_SNAPSHOT] Processing player
```

## Что проверить

### Проблема 1: Хост не видит движение гостя
Проверить на хосте:
1. ✅ DataChannel открыт?
2. ✅ Приходят ли инпуты от гостя? (`HOST RECEIVED: Input`)
3. ✅ Обрабатываются ли инпуты? (`handleGuestInput`)
4. ✅ Применяются ли инпуты к физике? (`updateGuestVehicles`)
5. ✅ Меняется ли позиция после применения инпутов?

Проверить на госте:
1. ✅ DataChannel открыт?
2. ✅ Отправляются ли инпуты? (`GUEST SEND: Sent input`)
3. ✅ Инпуты ненулевые? (throttle, steering, brake)

### Проблема 2: Гость не видит хоста
Проверить на госте:
1. ✅ DataChannel открыт?
2. ✅ Приходят ли снапшоты? (`GUEST RECEIVED: Snapshot`)
3. ✅ Обрабатываются ли снапшоты? (`handleHostSnapshot`)
4. ✅ Создается ли remote player? (`Creating remote player`)
5. ✅ Обновляется ли позиция? (`updateRemotePlayer`)

Проверить на хосте:
1. ✅ DataChannel открыт?
2. ✅ Отправляются ли снапшоты? (`HOST BROADCAST: Sent X snapshots`)
3. ✅ Снапшоты содержат данные хоста? (hostPos, hostVel)

## Возможные проблемы и решения

### DataChannel не открывается
- Проверить WebRTC соединение
- Проверить STUN серверы
- Проверить firewall

### Инпуты не отправляются
- Проверить InputService
- Проверить частоту отправки (должна быть ~20 Hz)

### Снапшоты не отправляются
- Проверить updateHostBroadcast()
- Проверить частоту отправки (должна быть ~20 Hz)

### Данные приходят, но не применяются
- Проверить порядок инициализации
- Проверить, что OpponentController создан
- Проверить, что guestVehicles созданы

### Интерполятор возвращает null
- Проверить буфер снапшотов
- Добавить fallback для отображения последней позиции

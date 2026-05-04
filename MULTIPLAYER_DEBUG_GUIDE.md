# Multiplayer Debug Guide

## Проблема
- Хост видит всё (себя и гостя)
- Гость не видит хоста
- Движение не реплицируется

## Добавленная диагностика

### 1. NetworkDiagnostics
Новый класс для отслеживания всех сетевых событий.

### 2. Расширенное логирование
- `NetworkClient.broadcastToGuests()` - показывает сколько сообщений отправлено
- `NetworkClient.sendToHost()` - показывает состояние канала
- `NetworkClient.setupDataChannel()` - логирует открытие/закрытие каналов
- `RacingState.handleHostSnapshot()` - детальное логирование обработки снапшотов

### 3. Горячая клавиша для диагностики
Нажмите **D** во время гонки для вывода сводки в консоль браузера.

## Как тестировать

### Шаг 1: Запустите сервер
```bash
npm run dev
```

### Шаг 2: Откройте два окна браузера

**Окно 1 (Хост):**
1. Откройте http://localhost:5173
2. Откройте DevTools (F12)
3. Перейдите на вкладку Console
4. Создайте комнату (Multiplayer → Create Room)
5. Скопируйте Room Code

**Окно 2 (Гость):**
1. Откройте http://localhost:5173 в новом окне/вкладке
2. Откройте DevTools (F12)
3. Перейдите на вкладку Console
4. Присоединитесь к комнате (Multiplayer → Join Room)
5. Введите Room Code

### Шаг 3: Начните гонку
1. В окне хоста нажмите "Start Race"
2. Дождитесь окончания обратного отсчёта

### Шаг 4: Проверьте логи

#### В консоли ХОСТА ищите:
```
[Network] Data channel open with <guest-id>, mode: host
[Network] broadcastToGuests: ...
[NetDiag] Host sending snapshot
```

**Ожидаемое поведение:**
- Должны быть сообщения "Host sending snapshot" каждые ~50ms
- НЕ должно быть предупреждений "No messages sent!"

#### В консоли ГОСТЯ ищите:
```
[Network] Data channel open with <host-id>, mode: guest
[NetworkService] CALLBACK onHostMessage: Received snapshot
[NetDiag] Guest received snapshot
[NetDiag] Processing snapshot
[RacingState] Creating opponent mesh for host
[NetDiag] Updating remote player
```

**Ожидаемое поведение:**
- Должны быть сообщения "Guest received snapshot"
- Должны быть сообщения "Processing snapshot"
- Должно быть сообщение "Creating opponent mesh for host" (один раз)
- Должны быть сообщения "Updating remote player"

### Шаг 5: Нажмите D для сводки
Во время гонки нажмите клавишу **D** в обоих окнах.

**Ожидаемый вывод:**
```
=== Network Diagnostics Summary ===
Total logs: XX
Snapshots sent: XX (только для хоста)
Snapshots received: XX (только для гостя)
Snapshots processed: XX (только для гостя)
Opponents created: 1 (только для гостя)
Opponents updated: XX (только для гостя)
```

## Возможные проблемы и решения

### Проблема 1: Data channel не открывается
**Симптомы:**
- Нет сообщения "Data channel open"
- Предупреждение "No data channel to host exists"

**Причина:** WebRTC соединение не установлено

**Решение:** Проверьте:
- Работает ли signaling server
- Нет ли ошибок в консоли о WebRTC
- Проходят ли ICE candidates

### Проблема 2: Snapshots отправляются, но не принимаются
**Симптомы:**
- Хост: "Host sending snapshot" есть
- Гость: "Guest received snapshot" НЕТ

**Причина:** Data channel закрыт или сообщения теряются

**Решение:**
- Проверьте состояние канала: должно быть "open"
- Проверьте размер сообщений (не превышает ли лимит)

### Проблема 3: Snapshots принимаются, но не обрабатываются
**Симптомы:**
- Гость: "Guest received snapshot" есть
- Гость: "Processing snapshot" НЕТ

**Причина:** OpponentController не инициализирован или callback не установлен

**Решение:**
- Проверьте, что `setupMultiplayerListeners()` вызван
- Проверьте, что `opponentController` создан

### Проблема 4: Opponent mesh не создаётся
**Симптомы:**
- Гость: "Processing snapshot" есть
- Гость: "Creating opponent mesh" НЕТ

**Причина:** Неправильная фильтрация по playerId

**Решение:**
- Проверьте, что `playerSnapshot.id !== this.playerId`
- Проверьте значения `this.playerId` и `playerSnapshot.id`

### Проблема 5: Opponent mesh создан, но не обновляется
**Симптомы:**
- Гость: "Creating opponent mesh" есть
- Гость: "Updating remote player" НЕТ или мало

**Причина:** Interpolator не работает или `updateRemoteVisuals()` не вызывается

**Решение:**
- Проверьте, что `updateRemoteVisuals()` вызывается в `update()`
- Проверьте, что снапшоты добавляются в interpolator

## Дополнительные команды для отладки

### Проверить состояние data channels (в консоли браузера):
```javascript
// Для хоста
window.game.networkService.getClient().dataChannels

// Для гостя
window.game.networkService.getClient().dataChannels
```

### Проверить количество opponent meshes:
```javascript
// В консоли гостя
window.game.currentState.opponentController.remoteOpponents.size
```

### Проверить позицию opponent mesh:
```javascript
// В консоли гостя
const mesh = window.game.currentState.opponentController.getRemotePlayerMesh('<host-id>');
console.log('Position:', mesh?.position);
console.log('Visible:', mesh?.visible);
```

## Следующие шаги

После сбора логов:
1. Определите, на каком этапе теряется синхронизация
2. Сравните логи хоста и гостя
3. Проверьте, что все callbacks установлены правильно
4. Убедитесь, что data channels открыты

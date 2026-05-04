# Multiplayer Synchronization Fix

## Проблема
- **Хост видел всё** (себя и гостя) ✓
- **Гость не видел хоста** ✗
- **Движение не реплицировалось** ✗

## Причина
Callbacks в `NetworkClient` устанавливались в `NetworkService`, но **не передавали сообщения в RacingState**. 

RacingState пытался перезаписать callbacks напрямую, но это происходило ПОСЛЕ того, как data channels уже были открыты, поэтому новые обработчики не срабатывали.

## Решение

### 1. Использование EventBus для передачи сообщений

**До:**
```typescript
// NetworkService - только логирование, сообщения терялись
onHostMessage: (message) => {
  console.log('Received snapshot');
  // Сообщение НЕ передавалось дальше!
}

// RacingState - пытался перезаписать callback (не работало)
client['callbacks'].onHostMessage = (message) => {
  this.handleHostSnapshot(message);
};
```

**После:**
```typescript
// NetworkService - эмитит событие в EventBus
onHostMessage: (message) => {
  console.log('Received snapshot');
  this.config.eventBus.emit('network:host-message', { message });
}

// RacingState - подписывается на событие
this.context.eventBus.on('network:host-message', this.handleNetworkHostMessage);
```

### 2. Добавлены новые события в EventBus

```typescript
export interface GameEvents {
  // ... существующие события
  'network:host-message': { message: any };
  'network:guest-message': { guestId: string; message: any };
}
```

### 3. Расширенная диагностика

#### NetworkDiagnostics
Новый класс для отслеживания всех сетевых событий:
- Snapshots sent/received/processed
- Opponents created/updated
- Горячая клавиша **D** для вывода сводки

#### Улучшенное логирование
- `NetworkClient.broadcastToGuests()` - показывает количество отправленных сообщений
- `NetworkClient.sendToHost()` - показывает состояние канала
- `NetworkClient.setupDataChannel()` - логирует открытие/закрытие/ошибки каналов
- `RacingState.handleHostSnapshot()` - детальное логирование обработки

## Изменённые файлы

1. **src/core/EventBus.ts**
   - Добавлены события `network:host-message` и `network:guest-message`

2. **src/services/NetworkService.ts**
   - `onHostMessage` теперь эмитит `network:host-message`
   - `onGuestMessage` теперь эмитит `network:guest-message`

3. **src/states/RacingState.ts**
   - Удалена перезапись callbacks
   - Добавлена подписка на события EventBus
   - Добавлены обработчики `handleNetworkHostMessage`, `handleNetworkGuestMessage`, `handleNetworkError`
   - Добавлена диагностика через NetworkDiagnostics
   - Горячая клавиша **D** для вывода диагностики

4. **src/client/network/NetworkClient.ts**
   - Улучшенное логирование в `broadcastToGuests()`
   - Улучшенное логирование в `sendToHost()`
   - Добавлен `onerror` handler для data channels

5. **src/debug/NetworkDiagnostics.ts** (новый файл)
   - Класс для отслеживания сетевых событий
   - Метод `printSummary()` для вывода статистики

## Как тестировать

### Быстрый тест
1. Запустите `npm run dev`
2. Откройте два окна браузера с DevTools (F12)
3. Создайте комнату в первом окне (хост)
4. Присоединитесь во втором окне (гость)
5. Начните гонку

### Проверка в консоли

**Хост должен видеть:**
```
[Network] Data channel open with <guest-id>, mode: host
[NetDiag] Host sending snapshot
```

**Гость должен видеть:**
```
[Network] Data channel open with <host-id>, mode: guest
[NetworkService] CALLBACK onHostMessage: Received snapshot
[NetDiag] Guest received snapshot
[NetDiag] Processing snapshot
[RacingState] Creating opponent mesh for host
[NetDiag] Updating remote player
```

### Диагностика
Нажмите **D** во время гонки для вывода сводки:
```
=== Network Diagnostics Summary ===
Snapshots sent: XX (хост)
Snapshots received: XX (гость)
Snapshots processed: XX (гость)
Opponents created: 1 (гость)
Opponents updated: XX (гость)
```

## Ожидаемый результат

✅ Хост видит себя и гостя  
✅ Гость видит себя и хоста  
✅ Движение реплицируется в обе стороны  
✅ Позиции обновляются плавно с интерполяцией  

## Дополнительная документация

См. `MULTIPLAYER_DEBUG_GUIDE.md` для подробного руководства по отладке.

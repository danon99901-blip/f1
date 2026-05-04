# Multiplayer Debug Guide

## Проблема
Игроки не видят друг друга в мультиплеере.

## Что исправлено

### 1. Исправлен расчёт позиции спавна для гостей
**Файл:** `src/states/RacingState.ts` → `getOpponentSpawnPosition()`

**Проблема:** Хост использовал индекс игрока в массиве всех игроков (включая себя), что давало неправильный offset.

**Исправление:** Теперь хост фильтрует только гостей:
```typescript
const guestPlayers = this.roomInfo?.players.filter(p => p.id !== this.playerId) ?? [];
const guestIndex = guestPlayers.findIndex(p => p.id === opponentId);
```

### 2. Добавлено детальное логирование
**Файл:** `src/game/OpponentController.ts`
- Логирование создания мешей оппонентов
- Предупреждения для неизвестных игроков
- Предупреждения когда нет данных интерполяции

## Как тестировать

### 1. Запустить
```bash
npm run dev
```

### 2. Открыть два окна браузера
- Окно 1: Хост (создать лобби)
- Окно 2: Гость (присоединиться)

### 3. Проверить консоль

**Хост должен показать:**
```
[RacingState] Game mode: multi_host
[RacingState] Host mode: Guest vehicles use physics meshes
```

**Гость должен показать:**
```
[RacingState] Game mode: multi_guest
[OpponentController] Creating remote player <id> (<name>)
[OpponentController] Remote player <id> added successfully. Total opponents: 1
```

### 4. Debug Overlay (зелёный в правом верхнем углу)
- **Snapshots Received/Processed**: должны расти
- **Opponents**: ✓ = виден, ✗ = не виден

### 5. Визуальная проверка
- [ ] Хост видит гостя справа (+1.5 по X)
- [ ] Гость видит хоста слева (-1.5 по X)
- [ ] Плавное движение
- [ ] Имена над машинами

## Если не работает

### Гость не видит хоста
Проверить в консоли гостя:
- `[OpponentController] Creating remote player` - меш создан?
- `[RacingState] Updating remote player` - снапшоты обрабатываются?
- `Snapshots Received` в overlay растёт?

### Хост не видит гостя
Проверить в консоли хоста:
- `[RacingState] Created vehicle for guest` - физика создана?
- Позиция спавна = baseX + 1.5?

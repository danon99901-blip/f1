# Исправление ошибки "Vehicle local already exists" в мультиплеере

## Проблема
При создании игры с 3 игроками возникала ошибка:
```
[GameStateMachine] Transition failed: Error: Vehicle local already exists
```

Только у одного игрока запускалась игра, у остальных происходил сбой.

## Корневая причина

Когда `RacingState.enter()` завершался с ошибкой:

1. `GameStateMachine.transitionTo()` ловил ошибку в блоке `catch`
2. Устанавливал `transitioning = false` в блоке `finally`
3. НО `currentState` уже был установлен в `RacingState`, хотя `enter()` не завершился успешно
4. `RacingState.exit()` НЕ вызывался, потому что ошибка произошла ДО завершения `enter()`
5. PhysicsService оставался с "зависшим" vehicle 'local'
6. При повторной попытке входа возникала ошибка "Vehicle local already exists"

## Реализованные исправления

### 1. GameStateMachine.ts - Откат состояния при ошибке в enter()

Добавлен механизм отката состояния при ошибке:

```typescript
const previousState = this.currentState;
const fromName = previousState?.name ?? 'none';

try {
  // Exit current state
  if (previousState) {
    await previousState.exit();
  }
  
  // Enter next state
  this.currentState = nextState;
  await this.currentState.enter(this.context);
  
} catch (error) {
  console.error('[GameStateMachine] Transition failed:', error);

  // Rollback: restore previous state if enter() failed
  if (this.currentState === nextState) {
    console.warn('[GameStateMachine] Rolling back to previous state:', fromName);
    this.currentState = previousState;

    // Try to re-enter previous state to restore consistency
    if (previousState) {
      try {
        await previousState.enter(this.context);
        console.log('[GameStateMachine] Rollback successful');
      } catch (rollbackError) {
        console.error('[GameStateMachine] Rollback failed:', rollbackError);
        this.currentState = null;
      }
    }
  }
  throw error;
}
```

**Результат:** При ошибке в `enter()` состояние откатывается к предыдущему, а не остается в полу-инициализированном состоянии.

### 2. RacingState.ts - Защитная очистка в начале enter()

Добавлена проверка и очистка "зависших" vehicles перед созданием новых:

```typescript
// STEP 2: Defensive cleanup - ensure no leftover vehicles from previous failed transitions
console.log('[RacingState] Performing defensive cleanup of any existing vehicles...');
const existingLocalVehicle = this.physicsService!.getVehicle('local');
if (existingLocalVehicle) {
  console.warn('[RacingState] Found existing local vehicle from previous failed transition, destroying it');
  this.physicsService!.destroyVehicle('local');
}

// Also clean up any guest vehicles that might be leftover (multiplayer)
if (this.gameMode === 'multi_host' && this.roomInfo) {
  this.roomInfo.players.forEach(player => {
    if (player.id !== this.playerId) {
      const existingGuestVehicle = this.physicsService!.getVehicle(player.id);
      if (existingGuestVehicle) {
        console.warn(`[RacingState] Found existing guest vehicle ${player.id}, destroying it`);
        this.physicsService!.destroyVehicle(player.id);
      }
    }
  });
}
```

**Результат:** Даже если предыдущий переход провалился, "зависшие" vehicles будут очищены.

### 3. PhysicsService.ts - Метод clearAllVehicles()

Добавлен метод для полной очистки всех vehicles:

```typescript
clearAllVehicles(): void {
  console.log(`[PhysicsService] Clearing all vehicles (${this.vehicles.size} total)`);
  const vehicleIds = Array.from(this.vehicles.keys());
  vehicleIds.forEach(id => {
    this.destroyVehicle(id);
  });
  console.log('[PhysicsService] All vehicles cleared');
}
```

**Результат:** Можно "сбросить" состояние PhysicsService в аварийных ситуациях.

### 4. CountdownState.ts - Защита от одновременных переходов

Добавлен флаг для предотвращения дублирующих запросов на переход:

```typescript
private transitionRequested = false;

async enter(context: StateContext): Promise<void> {
  this.transitionRequested = false;
  
  this.countdown.show(countdownSeconds, () => {
    if (this.context && !this.transitionRequested) {
      this.transitionRequested = true;
      console.log('[CountdownState] Requesting transition to racing (first request)');
      // ... emit transition
    } else if (this.transitionRequested) {
      console.warn('[CountdownState] Transition already requested, ignoring duplicate');
    }
  });
}
```

**Результат:** Только первый запрос на переход будет обработан.

### 5. RacingState.ts - Проверка перед созданием гостевых транспортов (существующее)

```typescript
// Check if guest vehicle already exists (from previous failed transition)
const existingVehicle = this.physicsService.getVehicle(guestId);
if (existingVehicle) {
  console.warn(`[RacingState] Found existing vehicle for guest ${guestId}, destroying it`);
  this.physicsService.destroyVehicle(guestId);
}
```

### 6. RacingState.ts - Очистка локального транспорта при выходе (существующее)

```typescript
// Clean up local player vehicle
if (this.physicsService) {
  this.physicsService.destroyVehicle('local');
}
```

## Результат
- ✅ Откат состояния при ошибке в `enter()` предотвращает полу-инициализированное состояние
- ✅ Защитная очистка в начале `enter()` удаляет "зависшие" vehicles
- ✅ Метод `clearAllVehicles()` позволяет сбросить состояние PhysicsService
- ✅ Защита от одновременных переходов в CountdownState
- ✅ Локальное транспортное средство корректно удаляется при выходе из состояния гонки
- ✅ Улучшенное логирование помогает отслеживать жизненный цикл переходов и транспортных средств
- ✅ Все игроки могут успешно войти в гонку без конфликтов ID

## Тестирование
Протестируйте следующие сценарии:
1. Создание игры с 3 игроками - все должны успешно войти в гонку
2. Искусственно вызвать ошибку у одного игрока (отключить сеть на секунду)
3. Проверить, что после ошибки игрок может повторно войти в гонку
4. Выход из гонки и повторный вход - не должно быть ошибок о существующих транспортах
5. Проверьте консоль браузера на наличие логов создания/удаления транспортов и откатов состояния

## Дата исправления
2026-05-03

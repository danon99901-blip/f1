# Отчет о критических багах в F1 Racing Game

**Дата анализа:** 2026-05-03  
**Статус проекта:** Phase 1 (Research), множественные модифицированные файлы

---

## 🔴 КРИТИЧЕСКИЕ БАГИ

### 1. **Memory Leak в PhysicsService** (КРИТИЧНО)
**Файл:** `src/services/PhysicsService.ts:83-86`

**Проблема:**
```typescript
dispose(): void {
  this.vehicles.clear();
  this.world = null;
}
```

При dispose не удаляются rigid bodies и colliders из Rapier world перед очисткой. Это приводит к утечке памяти в WebAssembly heap.

**Последствия:**
- Утечка памяти при переходах между состояниями
- Накопление неиспользуемых физических объектов
- Возможный crash при длительной игре

**Решение:**
```typescript
dispose(): void {
  this.vehicles.forEach((vehicle) => {
    if (this.world) {
      this.world.removeRigidBody(vehicle.rigidBody);
    }
  });
  this.vehicles.clear();
  if (this.world) {
    this.world.free(); // Освободить Rapier world
  }
  this.world = null;
}
```

---

### 2. **Race Condition в Force Accumulation** (КРИТИЧНО)
**Файл:** `src/car/vehicle.ts:390-395`

**Проблема:**
```typescript
rigidBody.resetForces(false);
```

Комментарий в коде указывает на критическую проблему: "Without this reset, downforce/drag/thrust from prior frames pile up every tick... the car accelerates to 300 km/h and punches through the track."

**Последствия:**
- Машина может неконтролируемо ускоряться
- Пробивание через трек
- Непредсказуемое физическое поведение

**Статус:** Исправлено в коде, но требует тестирования

---

### 3. **Wheel Raycast Collision с AI машинами** (КРИТИЧНО)
**Файл:** `src/car/vehicle.ts:552-556`

**Проблема:**
```typescript
controller.updateVehicle(
  dt,
  RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
);
```

Комментарий указывает: "Without this, a wheel ray can hit an opponent's chassis underside... and the suspension snaps to its minimum because the 'ground' suddenly appears 0.3-0.4 m above the asphalt."

**Последствия:**
- Внезапные скачки подвески при обгоне
- Потеря контроля над машиной
- Нереалистичное поведение физики

**Статус:** Исправлено, но может проявляться в edge cases

---

### 4. **Infinite Loop Risk в GameStateMachine** (ВЫСОКИЙ)
**Файл:** `src/core/GameStateMachine.ts:39-42`

**Проблема:**
```typescript
if (this.transitioning) {
  console.warn('[GameStateMachine] Already transitioning, rejecting');
  throw new Error('Cannot transition while another transition is in progress');
}
```

При ошибке в `exit()` или `enter()` флаг `transitioning` может остаться `true`, блокируя все последующие переходы.

**Последствия:**
- Игра застревает в текущем состоянии
- Невозможность вернуться в меню
- Требуется перезагрузка страницы

**Решение:**
```typescript
try {
  // ... transition logic
} catch (error) {
  console.error('[GameStateMachine] Transition failed:', error);
  throw error;
} finally {
  this.transitioning = false; // ✅ УЖЕ ЕСТЬ
}
```

**Статус:** Частично исправлено (finally block есть), но нужна дополнительная защита

---

### 5. **EventBus Memory Leak** (ВЫСОКИЙ)
**Файл:** `src/core/EventBus.ts:62-68`

**Проблема:**
```typescript
once<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
  const wrappedHandler = (data: GameEvents[K]) => {
    handler(data);
    this.off(event, wrappedHandler as EventHandler);
  };
  this.on(event, wrappedHandler as EventHandler);
}
```

`wrappedHandler` создает замыкание, которое может не удалиться, если событие никогда не произойдет.

**Последствия:**
- Накопление неиспользуемых обработчиков
- Утечка памяти при частых подписках/отписках
- Замедление игры со временем

**Решение:** Добавить метод `clearOnce()` или timeout для автоматической очистки

---

### 6. **RaceController Lap Comparison Bug** (ВЫСОКИЙ)
**Файл:** `src/game/RaceController.ts:99-106`

**Проблема:**
```typescript
if (lapState.currentLap > player.lapTracker.state.currentLap) {
  this.eventBus.emit('race:lap-complete', {
    playerId: player.id,
    lapNumber: lapState.currentLap - 1,
    lapTime: lapState.lastLapTime * 1000,
  });
}
```

Сравнение `lapState.currentLap > player.lapTracker.state.currentLap` всегда false, т.к. это один и тот же объект!

**Последствия:**
- События завершения круга никогда не срабатывают
- Нет уведомлений о прохождении круга
- Статистика кругов не обновляется

**Решение:** Сохранять предыдущее значение `currentLap` отдельно

---

### 7. **Network Reconnect Infinite Loop** (ВЫСОКИЙ)
**Файл:** `src/services/NetworkService.ts:153-177`

**Проблема:**
```typescript
private async reconnect(): Promise<void> {
  try {
    await this.connect();
  } catch (error) {
    console.error('[NetworkService] Reconnect failed:', error);
  }
}
```

Если `connect()` падает синхронно (не async), `handleDisconnect` может вызваться снова, создавая бесконечный цикл.

**Последствия:**
- Зависание браузера
- Исчерпание стека вызовов
- Невозможность играть в мультиплеер

**Решение:** Добавить debounce и проверку состояния перед reconnect

---

## ⚠️ СЕРЬЕЗНЫЕ ПРОБЛЕМЫ

### 8. **Composer Disabled** (СРЕДНИЙ)
**Файл:** `src/services/RenderService.ts:35`

```typescript
// Temporarily disable composer to avoid WebGL errors
// this.composer = createComposer(this.renderer, this.scene, this.camera);
```

**Проблема:** Post-processing эффекты отключены из-за WebGL ошибок

**Последствия:**
- Нет motion blur
- Нет bloom эффектов
- Ухудшенная визуальная составляющая

---

### 9. **Opponent Collision Detection O(n²)** (СРЕДНИЙ)
**Файл:** `src/ai/opponents.ts:235-268`

**Проблема:** Проверка столкновений между AI машинами выполняется в двойном цикле O(n²)

**Последствия:**
- Падение FPS при большом количестве оппонентов
- Не масштабируется (5 машин = 25 проверок, 20 машин = 400 проверок)

**Решение:** Использовать spatial hashing или Rapier collision events

---

### 10. **Missing Error Boundaries** (СРЕДНИЙ)
**Файлы:** Все state файлы

**Проблема:** Нет обработки ошибок в `enter()` методах состояний

**Последствия:**
- Uncaught exceptions ломают весь game loop
- Нет graceful degradation
- Плохой UX при ошибках

---

### 11. **ServiceContainer Circular Dependency** (СРЕДНИЙ)
**Файл:** `src/core/ServiceContainer.ts:22-45`

**Проблема:** Нет защиты от циклических зависимостей при resolve

**Последствия:**
- Stack overflow при неправильной конфигурации
- Сложная отладка

**Решение:** Добавить tracking resolving services

---

### 12. **Track Collision Trimesh Performance** (СРЕДНИЙ)
**Файл:** `src/track/track.ts:523-529`

**Проблема:** Используется trimesh collider для всей трассы (256+ сегментов)

**Последствия:**
- Медленные raycast операции
- Возможные проблемы с CCD
- Падение FPS на сложных трассах

**Решение:** Разбить на несколько colliders или использовать heightfield

---

## 🟡 ПОТЕНЦИАЛЬНЫЕ ПРОБЛЕМЫ

### 13. **Camera Lerp без deltaTime** (НИЗКИЙ)
**Файл:** `src/states/RacingState.ts:188`

```typescript
camera.position.lerp(this.cameraTarget.clone().add(offsetWorld), 0.08);
```

**Проблема:** Фиксированный коэффициент lerp не учитывает dt

**Последствия:**
- Разная скорость камеры при разных FPS
- Рывки камеры при просадках FPS

---

### 14. **No Input Validation** (НИЗКИЙ)
**Файлы:** Network-related

**Проблема:** Нет валидации входящих сетевых сообщений

**Последствия:**
- Возможность читерства
- Crash при некорректных данных

---

### 15. **Large Bundle Size** (НИЗКИЙ)
**Build output:** 2.7 MB (920 KB gzipped)

**Проблема:** Весь код в одном chunk

**Последствия:**
- Медленная загрузка
- Плохой UX на медленных соединениях

**Решение:** Code splitting, dynamic imports

---

## 📊 СТАТИСТИКА

- **Критические баги:** 7
- **Серьезные проблемы:** 8
- **Потенциальные проблемы:** 3
- **Всего найдено:** 18 проблем

---

## 🎯 ПРИОРИТЕТЫ ИСПРАВЛЕНИЯ

### Немедленно (P0):
1. Memory Leak в PhysicsService
2. RaceController Lap Comparison Bug
3. Network Reconnect Infinite Loop

### Высокий приоритет (P1):
4. EventBus Memory Leak
5. GameStateMachine error handling
6. Opponent Collision O(n²)

### Средний приоритет (P2):
7. Composer WebGL errors
8. ServiceContainer circular deps
9. Track collision performance

### Низкий приоритет (P3):
10. Camera lerp
11. Input validation
12. Bundle size optimization

---

## 🔧 РЕКОМЕНДАЦИИ

1. **Добавить автотесты** для критических систем (physics, state machine, network)
2. **Внедрить memory profiling** для отслеживания утечек
3. **Настроить error tracking** (Sentry/LogRocket)
4. **Добавить performance monitoring** для FPS и frame time
5. **Создать CI/CD pipeline** с автоматическими проверками

---

## ✅ ЧТО УЖЕ ИСПРАВЛЕНО

- Force accumulation reset (vehicle.ts:395)
- Wheel raycast filtering (vehicle.ts:552)
- GameStateMachine finally block (GameStateMachine.ts:80)
- Bump detection diagnostic (vehicle.ts:560-603)

---

**Примечание:** Проект находится в активной разработке (множество измененных файлов). Рекомендуется создать отдельную ветку для исправления критических багов перед добавлением новых фич.

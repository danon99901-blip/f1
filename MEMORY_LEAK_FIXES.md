# Memory Leak Fixes - Implementation Plan

**Date:** 2026-05-03  
**Status:** Ready for implementation

---

## Summary

Found 10 critical memory leaks through systematic analysis. All leaks follow the same pattern: resources created during game state initialization are not properly cleaned up during state transitions (Menu → Racing → Menu).

---

## Fixes to Implement

### 1. **OpponentController - AI opponents not disposed** ✅ PRIORITY 1
**File:** `src/game/OpponentController.ts:120-128`

**Problem:** `dispose()` only clears remote opponents, ignoring AI controller.

**Fix:**
```typescript
dispose(): void {
  // Clean up remote opponents
  this.remoteOpponents.forEach((opponent) => {
    this.scene.remove(opponent.mesh);
    opponent.nameTag.dispose();
    opponent.interpolator.reset();
    // Dispose geometries and materials
    opponent.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  });
  this.remoteOpponents.clear();
  
  // ✅ ADD: Clean up AI controller
  if (this.aiController) {
    this.aiController.dispose();
    this.aiController = null;
  }
}
```

---

### 2. **createOpponents - Add dispose method** ✅ PRIORITY 1
**File:** `src/ai/opponents.ts:44-53`

**Problem:** `OpponentsController` interface has no `dispose()` method. Debris meshes and AI rigid bodies never cleaned up.

**Fix:**
```typescript
export interface OpponentsController {
  update: (dt: number, elapsedTime: number, playerSpeedKmh: number) => void;
  handlePlayerImpacts: (playerBody: RAPIER.RigidBody) => number;
  getPlayerPosition: (playerArcDistance: number) => number;
  getTotalCars: () => number;
  dispose: () => void; // ✅ ADD
}
```

**Implementation in `createOpponents()` return object:**
```typescript
return {
  update,
  handlePlayerImpacts,
  getPlayerPosition: () => opponents.length + 1,
  getTotalCars: () => opponents.length + 1,
  dispose: () => {
    // Clean up all AI opponents
    opponents.forEach((opponent) => {
      if (!opponent.destroyed) {
        scene.remove(opponent.mesh);
        if (opponent.collider) {
          world.removeCollider(opponent.collider, false);
        }
        if (opponent.body) {
          world.removeRigidBody(opponent.body);
        }
        // Dispose geometries and materials
        opponent.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach((mat) => mat.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
      }
    });
    opponents.length = 0;
    
    // Clean up all debris pieces
    debris.forEach((piece) => {
      scene.remove(piece.mesh);
      if (piece.mesh.geometry) piece.mesh.geometry.dispose();
      if (piece.mesh.material instanceof THREE.Material) {
        piece.mesh.material.dispose();
      }
    });
    debris.length = 0;
  },
};
```

---

### 3. **Track - Colliders not removed** ✅ PRIORITY 1
**File:** `src/track/track.ts`

**Problem:** Barriers, checkpoints, and trimesh colliders created but never removed from physics world.

**Fix:** Store collider references and add cleanup in track disposal.

**Changes needed:**
1. Store all created colliders in arrays
2. Add `dispose()` method to Track interface
3. Call `world.removeCollider()` for each collider in dispose

---

### 4. **RaceController - Lap trackers not cleaned** ✅ PRIORITY 2
**File:** `src/game/RaceController.ts:182-184`

**Problem:** Lap trackers hold closures with references to deleted rigid bodies.

**Fix:**
```typescript
dispose(): void {
  // Clean up lap trackers first
  this.players.forEach((player) => {
    if (player.lapTracker && typeof player.lapTracker.dispose === 'function') {
      player.lapTracker.dispose();
    }
  });
  this.players.clear();
}
```

**Also need to add `dispose()` method to lap tracker in `src/track/lap.ts`:**
```typescript
return {
  update,
  state,
  dispose: () => {
    // Clear references to prevent memory leaks
    // (lap tracker uses closures, so this helps GC)
  },
};
```

---

### 5. **RenderService - Composer not disposed** ✅ PRIORITY 2
**File:** `src/services/RenderService.ts:122-137`

**Problem:** Composer nullified without calling dispose, leaking WebGL textures.

**Fix:**
```typescript
dispose(): void {
  if (this.resizeHandler) {
    window.removeEventListener('resize', this.resizeHandler);
    this.resizeHandler = null;
  }

  // ✅ ADD: Dispose composer before nullifying
  if (this.composer && typeof this.composer.dispose === 'function') {
    this.composer.dispose();
  }
  this.composer = null;

  if (this.renderer) {
    this.renderer.dispose();
    this.renderer = null;
  }

  this.scene = null;
  this.camera = null;
  this.container = null;
}
```

---

### 6. **UIManager - Event listeners not removed** ✅ PRIORITY 2
**File:** `src/ui/UIManager.ts:45-53, 108-112`

**Problem:** EventBus listeners registered but never removed, causing multiple handler invocations.

**Fix:**
```typescript
export class UIManager {
  private screens = new Map<string, UIScreen>();
  private currentScreen: UIScreen | null = null;
  private eventBus: EventBus;
  // ✅ ADD: Store handler references
  private stateChangeHandler: ((data: any) => void) | null = null;
  private fatalErrorHandler: ((data: any) => void) | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.stateChangeHandler = ({ to }) => {
      this.handleStateChange(to as GameStateName);
    };
    this.eventBus.on('game:state-change', this.stateChangeHandler);

    this.fatalErrorHandler = ({ message }) => {
      this.showErrorScreen(message);
    };
    this.eventBus.on('error:fatal', this.fatalErrorHandler);
  }

  dispose(): void {
    // ✅ ADD: Remove event listeners
    if (this.stateChangeHandler) {
      this.eventBus.off('game:state-change', this.stateChangeHandler);
      this.stateChangeHandler = null;
    }
    if (this.fatalErrorHandler) {
      this.eventBus.off('error:fatal', this.fatalErrorHandler);
      this.fatalErrorHandler = null;
    }

    this.screens.forEach((screen) => screen.dispose());
    this.screens.clear();
    this.currentScreen = null;
  }
}
```

---

### 7. **CountdownOverlay - setInterval not cleared** ⚠️ PRIORITY 3
**File:** `src/client/game/CountdownOverlay.ts:31-52`

**Problem:** setInterval continues running if hide() called before countdown completes.

**Fix:**
```typescript
export class CountdownOverlay {
  private root: HTMLElement;
  private countdownEl: HTMLElement;
  private intervalId: number | null = null; // ✅ ADD

  show(onComplete: () => void): void {
    this.root.classList.add('visible');
    let count = 3;
    this.countdownEl.textContent = count.toString();

    this.intervalId = window.setInterval(() => { // ✅ STORE ID
      count--;
      if (count > 0) {
        this.countdownEl.textContent = count.toString();
      } else {
        this.countdownEl.textContent = 'GO!';
        setTimeout(() => {
          this.hide();
          onComplete();
        }, 500);
        if (this.intervalId !== null) {
          clearInterval(this.intervalId);
          this.intervalId = null;
        }
      }
    }, 1000);
  }

  hide(): void {
    // ✅ ADD: Clear interval before hiding
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.root.classList.remove('visible');
  }

  dispose(): void {
    this.hide(); // Will clear interval
    this.root.remove();
  }
}
```

---

### 8. **ConnectionStatusIndicator - setTimeout not cleared** ⚠️ PRIORITY 3
**File:** `src/client/game/ConnectionStatusIndicator.ts:47`

**Problem:** setTimeout continues running if remove() called before 2-second auto-hide.

**Fix:**
```typescript
export class ConnectionStatusIndicator {
  private root: HTMLElement;
  private textEl: HTMLElement;
  private timeoutId: number | null = null; // ✅ ADD

  setStatus(status: 'connecting' | 'connected' | 'disconnected' | 'error'): void {
    // ✅ ADD: Clear any existing timeout
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    switch (status) {
      case 'connecting':
        this.textEl.textContent = 'Connecting...';
        this.root.classList.add('visible');
        break;
      case 'connected':
        this.textEl.textContent = 'Connected';
        this.root.classList.add('visible');
        this.timeoutId = window.setTimeout(() => { // ✅ STORE ID
          this.hide();
          this.timeoutId = null;
        }, 2000);
        break;
      case 'disconnected':
        this.textEl.textContent = 'Disconnected';
        this.root.classList.add('visible');
        break;
      case 'error':
        this.textEl.textContent = 'Connection Error';
        this.root.classList.add('visible');
        break;
    }
  }

  remove(): void {
    // ✅ ADD: Clear timeout before removing
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.root.remove();
  }
}
```

---

### 9. **MainMenu - setTimeout not cleared** ⚠️ PRIORITY 3
**File:** `src/client/menu/MainMenu.ts:210-215`

**Problem:** Error message auto-hide setTimeout continues if menu hidden early.

**Fix:**
```typescript
export class MainMenu {
  private root: HTMLElement;
  private errorTimeoutId: number | null = null; // ✅ ADD

  private displayError(errorDiv: HTMLElement, message: string): void {
    // ✅ ADD: Clear existing timeout
    if (this.errorTimeoutId !== null) {
      clearTimeout(this.errorTimeoutId);
    }

    errorDiv.innerHTML = `<div class="menu-error">${message}</div>`;
    this.errorTimeoutId = window.setTimeout(() => { // ✅ STORE ID
      errorDiv.innerHTML = '';
      this.errorTimeoutId = null;
    }, 3000);
  }

  hide(): void {
    // ✅ ADD: Clear timeout before hiding
    if (this.errorTimeoutId !== null) {
      clearTimeout(this.errorTimeoutId);
      this.errorTimeoutId = null;
    }
    this.root.remove();
  }
}
```

---

### 10. **LobbyMenu - setTimeout and event listeners not cleared** ⚠️ PRIORITY 3
**File:** `src/client/menu/LobbyMenu.ts:135-137`

**Problem:** 
1. Copy button setTimeout continues if menu hidden early
2. Event listeners added in render() but never removed when DOM recreated

**Fix:**
```typescript
export class LobbyMenu {
  private root: HTMLElement;
  private copyTimeoutId: number | null = null; // ✅ ADD
  private eventCleanupFns: Array<() => void> = []; // ✅ ADD

  private copyRoomCode(): void {
    const btn = this.root.querySelector('.copy-btn') as HTMLButtonElement;
    if (!btn) return;

    const originalText = btn.textContent;
    btn.textContent = 'COPIED!';

    // ✅ ADD: Clear existing timeout
    if (this.copyTimeoutId !== null) {
      clearTimeout(this.copyTimeoutId);
    }

    this.copyTimeoutId = window.setTimeout(() => { // ✅ STORE ID
      btn.textContent = originalText;
      this.copyTimeoutId = null;
    }, 2000);
  }

  render(roomInfo: RoomInfo): void {
    // ✅ ADD: Clean up old event listeners before recreating DOM
    this.eventCleanupFns.forEach(fn => fn());
    this.eventCleanupFns = [];

    // ... existing render code ...

    // ✅ CHANGE: Store cleanup functions for event listeners
    const startBtn = this.root.querySelector('.start-btn');
    if (startBtn) {
      const handler = () => this.callbacks.onStartRace();
      startBtn.addEventListener('click', handler);
      this.eventCleanupFns.push(() => startBtn.removeEventListener('click', handler));
    }

    // ... repeat for all other event listeners ...
  }

  hide(): void {
    // ✅ ADD: Clear timeout and event listeners
    if (this.copyTimeoutId !== null) {
      clearTimeout(this.copyTimeoutId);
      this.copyTimeoutId = null;
    }
    this.eventCleanupFns.forEach(fn => fn());
    this.eventCleanupFns = [];
    this.root.remove();
  }
}
```

---

## Implementation Order

### Phase 1: Critical Physics/Rendering Leaks (P1)
1. OpponentController AI disposal
2. createOpponents dispose method
3. Track colliders cleanup
4. RenderService composer disposal

### Phase 2: Game Logic Leaks (P2)
5. RaceController lap tracker cleanup
6. UIManager event listener removal

### Phase 3: UI Timer Leaks (P3)
7. CountdownOverlay setInterval
8. ConnectionStatusIndicator setTimeout
9. MainMenu setTimeout
10. LobbyMenu setTimeout + event listeners

---

## Testing Strategy

After each fix:
1. Start game → Enter race → Exit to menu → Repeat 10x
2. Monitor Chrome DevTools Memory profiler
3. Check for:
   - Detached DOM nodes
   - Retained Three.js objects
   - Active timers (Performance → Timers)
   - Rapier heap size (if exposed)

Expected result: Memory usage should stabilize after 2-3 cycles, not grow linearly.

---

## Related Issues

These fixes address the memory leaks found in the iteration analysis. They complement the critical bugs already documented in `CRITICAL_BUGS_REPORT.md`:
- Bug #1: PhysicsService memory leak (already documented)
- These 10 new leaks: Component-level resource cleanup

---

**Next Steps:** Implement fixes in order, test each one, then run full memory profiling session.

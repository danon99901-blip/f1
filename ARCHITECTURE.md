# Production Architecture Refactoring

## Overview

This branch contains a complete architectural refactoring of the F1 racing game, transforming it from a callback-based prototype into a production-ready application with proper separation of concerns, testability, and error handling.

## Architecture

### Core Components

- **EventBus** (`src/core/EventBus.ts`) - Typed pub/sub system for decoupled communication
- **ServiceContainer** (`src/core/ServiceContainer.ts`) - Dependency injection container with lifecycle management
- **GameStateMachine** (`src/core/GameStateMachine.ts`) - Explicit state machine for game flow
- **GameLoop** (`src/core/GameLoop.ts`) - Unified game loop with pause/resume support

### Services

- **PhysicsService** - Wraps Rapier physics world and vehicle management
- **RenderService** - Wraps Three.js scene, camera, and post-processing
- **InputService** - Keyboard input abstraction
- **NetworkService** - Network client wrapper with automatic reconnection

### Game States

1. **MenuState** - Main menu
2. **LobbyState** - Multiplayer lobby
3. **CountdownState** - Pre-race countdown
4. **RacingState** - Active gameplay
5. **ResultsState** - Post-race results

### Game Controllers

- **GameSession** - Orchestrates services and state machine
- **RaceController** - Manages race state, lap tracking, positions
- **PlayerController** - Local player vehicle control
- **OpponentController** - AI or remote player management

## Key Improvements

### Before (main.ts: 200 lines)
```typescript
// Callback hell
const menuManager = new MenuManager({
  onSinglePlayer: async () => {
    loadingEl?.classList.remove('hidden');
    const { startSinglePlayerGame } = await import('./client/game/SinglePlayerGame');
    await startSinglePlayerGame();
    loadingEl?.classList.add('hidden');
  },
  onMultiplayerHost: async (playerName: string, totalLaps: number) => {
    // 50+ lines of nested callbacks...
  },
  // More nested callbacks...
});
```

### After (main.ts: 80 lines)
```typescript
// Clean, declarative
const gameSession = new GameSession();
await gameSession.init(appEl, SIGNALING_URL);

gameSession.registerStates(new Map([
  ['menu', new MenuState()],
  ['racing', new RacingState()],
  // ...
]));

await gameSession.start('menu');
```

## Benefits

✅ **No callback hell** - Linear, readable code
✅ **Testable** - Services can be mocked for unit tests
✅ **Maintainable** - Clear separation of concerns
✅ **Extensible** - Easy to add new states/features
✅ **Resilient** - Error recovery and reconnect logic
✅ **Type-safe** - Full TypeScript coverage

## Debug Tools

Access game internals via browser console:

```javascript
// Exposed on window.__game
__game.session          // GameSession instance
__game.eventBus         // EventBus instance
__game.serviceContainer // ServiceContainer instance
__game.transitionTo('racing')  // Manual state transition
__game.pause()          // Pause game loop
__game.resume()         // Resume game loop
```

## Testing

```bash
# Type checking
npm run typecheck

# Build
npm run build

# Run dev server
npm run dev

# Run with signaling server
npm run dev:all
```

## Migration Notes

- Old game client files (`SinglePlayerGame.ts`, `HostGameClient.ts`, `GuestGameClient.ts`) are still present but unused
- Core systems (vehicle, track, AI, effects) remain unchanged - only wrapped by services
- Can be gradually migrated to use new architecture patterns

## Next Steps

1. Add unit tests for core components (EventBus, StateMachine, ServiceContainer)
2. Add integration tests for state transitions
3. Implement pause menu state
4. Add spectator mode state
5. Implement replay system using event recording
6. Add analytics/telemetry via EventBus listeners

## File Structure

```
src/
├── core/              # Core infrastructure
│   ├── EventBus.ts
│   ├── GameLoop.ts
│   ├── GameStateMachine.ts
│   └── ServiceContainer.ts
├── services/          # Service layer
│   ├── PhysicsService.ts
│   ├── RenderService.ts
│   ├── NetworkService.ts
│   └── InputService.ts
├── game/              # Game orchestration
│   ├── GameSession.ts
│   ├── RaceController.ts
│   ├── PlayerController.ts
│   └── OpponentController.ts
├── states/            # Game states
│   ├── MenuState.ts
│   ├── LobbyState.ts
│   ├── CountdownState.ts
│   ├── RacingState.ts
│   └── ResultsState.ts
├── ui/                # UI management
│   └── UIManager.ts
├── network/           # Network utilities
│   └── ReconnectStrategy.ts
└── [existing dirs]    # Unchanged core systems
    ├── car/
    ├── track/
    ├── ai/
    ├── effects/
    └── hud/
```

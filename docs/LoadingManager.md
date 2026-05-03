# LoadingManager

Progressive loading system with visual progress feedback for F1 Racing game.

## Features

- **Weighted progress calculation** — stages have different weights based on typical load times
- **Real-time UI updates** — progress bar and stage labels update automatically
- **Stage tracking** — monitors 6 loading stages: three.js, rapier, postprocessing, game-init, states, assets
- **Callback system** — subscribe to progress updates for custom UI
- **Singleton pattern** — single instance shared across the application

## Usage

### Basic Integration

```typescript
import { loadingManager } from './utils/LoadingManager';

// Update stage progress (0-1)
loadingManager.updateStage('three', 0.5);

// Mark stage as complete
loadingManager.completeStage('rapier');

// Get overall progress (0-100)
const progress = loadingManager.getOverallProgress();

// Get current active stage
const stage = loadingManager.getCurrentStage();
```

### Subscribe to Progress Updates

```typescript
loadingManager.onProgress((progress, stage) => {
  console.log(`Loading: ${progress}% - ${stage}`);
  updateProgressBar(progress);
});
```

### Reset Progress

```typescript
loadingManager.reset(); // Reset all stages to 0%
```

## Loading Stages

| Stage | Weight | Description |
|-------|--------|-------------|
| `three` | 15 | Three.js core library (~600KB) |
| `rapier` | 40 | Rapier physics WASM (~2MB) |
| `postprocessing` | 10 | Post-processing effects (~200KB) |
| `game-init` | 15 | Game session initialization |
| `states` | 10 | Game state modules |
| `assets` | 10 | Textures, models, other assets |

## UI Integration

The loading screen in `index.html` includes:

- **Progress bar** — animated gradient bar showing overall progress
- **Stage label** — human-readable current stage name
- **Percentage** — numeric progress indicator (0-100%)

### Styling

```css
#loading-bar {
  background: linear-gradient(90deg, #e10600, #ff4444);
  transition: width 0.3s ease-out;
}
```

## Architecture

```
main.ts
  ├─> setupLoadingUI() — connects LoadingManager to DOM
  ├─> GameSession.init() — updates 'game-init' stage
  ├─> import states — updates 'states' stage
  └─> gameSession.start() — updates 'assets' stage

composerLoader.ts
  └─> loadComposer() — updates 'postprocessing' stage
```

## Performance Impact

- **Minimal overhead** — simple weighted sum calculation
- **No blocking** — progress updates are synchronous and fast
- **Smooth animations** — CSS transitions handle visual smoothness

## Testing

Run tests with:

```bash
npm test
```

Test coverage includes:
- Progress calculation
- Stage transitions
- Callback notifications
- Edge cases (unknown stages, clamping)
- Reset functionality

## Future Improvements

- [ ] Add asset loading progress (Three.js LoadingManager integration)
- [ ] Network request progress tracking
- [ ] Estimated time remaining
- [ ] Retry mechanism for failed stages

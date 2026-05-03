# Performance Monitor

Real-time performance monitoring overlay for debugging and optimization.

## Features

- **FPS** - Frames per second with color-coded indicator
- **Frame Time** - Average and max frame time in milliseconds
- **Physics Time** - Physics simulation time per frame
- **Memory Usage** - Heap memory usage (Chrome only)
- **Network Stats** - Ping and jitter in multiplayer mode

## Usage

### Enable via Query Parameter

Add `?debug=1` to the URL:
```
http://localhost:5174/?debug=1
```

The performance overlay will be visible on page load.

### Toggle with F3 Key

Press **F3** at any time to toggle the performance overlay on/off.

## Metrics Explanation

### FPS (Frames Per Second)
- 🟢 Green: ≥60 FPS (excellent)
- 🟡 Yellow: 30-59 FPS (acceptable)
- 🔴 Red: <30 FPS (poor)

### Frame Time
- 🟢 Green: ≤16.67ms (60 FPS target)
- 🟡 Yellow: 16.67-33.33ms (30-60 FPS)
- 🔴 Red: >33.33ms (<30 FPS)

Shows both average and maximum frame time over the last 60 frames.

### Physics Time
- Time spent on physics simulation per frame
- Should be <16.67ms to maintain 60 FPS
- High values indicate physics bottleneck

### Memory
- Shows used heap memory vs total limit
- Only available in Chrome/Chromium browsers
- 🟢 Green: <70% usage
- 🟡 Yellow: 70-85% usage
- 🔴 Red: >85% usage (risk of GC pauses)

### Network Stats (Multiplayer Only)
Visible only when connected to a multiplayer session:

- **Ping**: Round-trip time to peer
  - 🟢 Green: ≤50ms (excellent)
  - 🟡 Yellow: 50-100ms (good)
  - 🔴 Red: >100ms (noticeable lag)

- **Jitter**: Variance in ping (network stability)
  - 🟢 Green: ≤10ms (stable)
  - 🟡 Yellow: 10-30ms (moderate)
  - 🔴 Red: >30ms (unstable)

## Implementation Details

### Architecture

- `PerformanceMonitor.ts` - Core metrics collection
- `PerformanceOverlay.ts` - UI rendering
- Integration in `main.ts` - Setup and update loop
- `GameLoop.ts` - Physics time callback
- `NetworkService.ts` - Network stats via WebRTC

### Sampling

- FPS: Updated every 500ms
- Frame/Physics time: Rolling average over 60 samples
- Network ping: Measured every 5 seconds via WebRTC stats

### Performance Impact

The monitor itself has minimal overhead:
- ~0.1ms per frame for metrics collection
- DOM updates only when overlay is visible
- No impact when disabled

## Troubleshooting

### Memory stats not showing
Memory API is Chrome-specific. Use Chrome/Edge for full metrics.

### Network stats not showing
Network stats only appear in multiplayer mode after connecting to a peer.

### High physics time
- Check number of physics bodies in scene
- Verify physics tick rate (should be 60 Hz)
- Look for complex collision shapes

### Frame time spikes
- Check for GC pauses (memory usage)
- Profile with browser DevTools
- Look for expensive render operations

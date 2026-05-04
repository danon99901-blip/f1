# Browser Test Instructions - Multiplayer Verification

## Quick Start

```bash
npm run dev
```

Then open http://localhost:5173 in **two separate browser windows** (not tabs in the same window for better visibility).

## Test Scenario: Host and Client Movement Replication

### Window 1 - Host Setup
1. Click **"Create Lobby"** button
2. Copy the **lobby code** that appears (e.g., "ABC123")
3. Wait for client to join
4. Click **"Start Race"** button
5. Press **arrow keys** to move your car
6. Press **'D'** to toggle debug overlay

### Window 2 - Client Setup
1. Enter the **lobby code** from Window 1
2. Click **"Join Lobby"** button
3. Wait for host to start the race
4. Press **arrow keys** to move your car
5. Press **'D'** to toggle debug overlay

## What to Verify

### ✅ Success Criteria

#### Host Window Should Show:
- [x] Own car (blue/primary color)
- [x] Opponent car (red/secondary color) appears when client joins
- [x] Opponent car moves when client presses arrow keys
- [x] Debug overlay shows "Role: Host"
- [x] Debug overlay shows opponent position updating

#### Client Window Should Show:
- [x] Own car (blue/primary color)
- [x] Opponent car (red/secondary color) - **THIS IS THE HOST CAR**
- [x] Opponent car moves when host presses arrow keys
- [x] Debug overlay shows "Role: Guest"
- [x] Debug overlay shows opponent position updating

### 🔍 Debug Overlay Information

Press **'D'** key to see:
```
Role: Host/Guest
Lobby: ABC123
Status: Connected
Position: (x, y, z)
Opponent: (x, y, z)
Tick Rate: 20 Hz
```

## Common Issues to Check

### Issue: Client doesn't see host car
**Check:**
- Console errors in client window
- Network tab shows WebSocket messages
- Debug overlay shows opponent position as (0, 0, 0) or undefined

### Issue: Movement not replicated
**Check:**
- Both windows show "Status: Connected"
- Network tab shows continuous snapshot messages
- Debug overlay shows opponent position changing

### Issue: Cars overlap at spawn
**Check:**
- Host car should be at starting position
- Client car should be offset (different spawn point)

## Browser DevTools Checks

### Console Tab
Look for:
- ✅ "Multiplayer listeners set up"
- ✅ "Host snapshot received"
- ✅ "Updating remote player position"
- ❌ No errors about missing opponent mesh

### Network Tab
1. Filter by "WS" (WebSocket)
2. Click on the WebSocket connection
3. Go to "Messages" tab
4. Look for:
   - `{"type":"snapshot","data":{...}}` messages every ~50ms
   - Position data in the messages

## Expected Network Traffic

### Host → Client Messages
```json
{
  "type": "snapshot",
  "data": {
    "position": {"x": 1.23, "y": 0, "z": 4.56},
    "rotation": {"x": 0, "y": 1.57, "z": 0},
    "velocity": {"x": 0.1, "y": 0, "z": 0.5}
  }
}
```

### Client → Host Messages
```json
{
  "type": "snapshot",
  "data": {
    "position": {"x": -2.34, "y": 0, "z": 4.56},
    "rotation": {"x": 0, "y": 0, "z": 0},
    "velocity": {"x": -0.1, "y": 0, "z": 0.5}
  }
}
```

## Test Results Template

Copy and fill out:

```
Date: 2026-05-04
Tester: [Your Name]

Host Window:
- [ ] Can create lobby
- [ ] Can see own car
- [ ] Can see client car
- [ ] Client car moves in real-time

Client Window:
- [ ] Can join lobby
- [ ] Can see own car
- [ ] Can see host car ← CRITICAL FIX
- [ ] Host car moves in real-time ← CRITICAL FIX

Network:
- [ ] WebSocket connected
- [ ] Snapshot messages flowing
- [ ] No console errors

Notes:
[Any observations or issues]
```

## Automated Verification

After manual testing, run:
```bash
npm test
```

All tests should pass, including:
- `RacingState.test.ts` - multiplayer initialization
- `AdaptiveTickRate.test.ts` - network tick rate

## Next Steps

If issues found:
1. Note the specific behavior in test results
2. Check browser console for errors
3. Check Network tab for WebSocket messages
4. Report findings with screenshots if possible

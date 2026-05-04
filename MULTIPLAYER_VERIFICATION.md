# Multiplayer Verification Guide

## Browser Testing Instructions

The dev server is running at http://localhost:5173

### Setup

1. **Host Setup:**
   - Open http://localhost:5173 in Browser 1
   - Click "Multiplayer" → "Host Game"
   - Note the room code displayed
   - Click "Start Race"

2. **Guest Setup:**
   - Open http://localhost:5173 in Browser 2 (or incognito window)
   - Click "Multiplayer" → "Join Game"
   - Enter the room code from Host
   - Click "Join"
   - Wait for Host to start the race

### What to Verify

#### Debug Overlay (Top Right Corner)
Both browsers will show a green debug overlay with:
- **Mode**: `multi_host` or `multi_guest`
- **Player ID**: First 8 characters of your player ID
- **Room**: The room ID
- **Snapshots Received**: Counter (should increment on guest)
- **Snapshots Processed**: Counter (should increment on guest)
- **Last Snapshot**: Time since last snapshot (should be < 100ms on guest when active)
- **Opponents**: List of other players with ✓ (visible) or ✗ (not visible)

#### Expected Behavior

**Guest Browser:**
- ✅ Should see "Snapshots Received" counter incrementing
- ✅ Should see "Snapshots Processed" counter incrementing
- ✅ Should see "Last Snapshot" updating frequently (< 100ms)
- ✅ Should see Host in "Opponents" list with ✓ (green checkmark)
- ✅ Should see Host's car moving on the track
- ✅ Host's car should replicate movement smoothly

**Host Browser:**
- ✅ Should see Guest in "Opponents" list with ✓ (green checkmark)
- ✅ Should see Guest's car moving on the track
- ✅ Guest's car should replicate input from guest

### Success Criteria

✅ **PASS** if:
1. Guest sees Host's car on the track
2. Host's car moves and replicates position to Guest
3. Debug overlay shows snapshots being received and processed
4. "Last Snapshot" time stays under 100ms on Guest
5. Opponents list shows ✓ for the other player

❌ **FAIL** if:
1. Guest doesn't see Host's car
2. Host's car appears but doesn't move
3. Snapshots counter stays at 0
4. "Last Snapshot" shows "Never" or very old timestamp
5. Opponents list shows ✗ or is empty

### Console Logs to Check

Open browser DevTools (F12) and check Console for:

**Guest should see:**
```
[RacingState] Guest received snapshot #1: { tick: ..., playerCount: 2, players: [...] }
[RacingState] Processing snapshot #1: { tick: ..., playerCount: 2, myId: ... }
[RacingState] Creating opponent mesh for host <hostId> (<hostName>)
[RacingState] Updating remote player <hostId> position: { pos: [...], rot: [...] }
```

**Host should see:**
```
[RacingState] Host sent first snapshot after opponent initialization
```

### Troubleshooting

**If Guest doesn't see Host:**
1. Check console for "Creating opponent mesh for host" message
2. Verify "Snapshots Received" is incrementing
3. Check "Opponents" list shows Host with ✓

**If snapshots aren't arriving:**
1. Check network connection in DevTools → Network tab
2. Verify WebRTC connection is established
3. Check for any error messages in console

**If Host's car doesn't move:**
1. Verify Host is actually driving (press W/Arrow Up)
2. Check "Last Snapshot" timestamp is updating
3. Look for "Updating remote player" messages in console

## Implementation Details

### Debug Overlay
- Located at `src/debug/MultiplayerDebugOverlay.ts`
- Shows real-time multiplayer state
- Green = good, Yellow = warning, Red = error
- Auto-updates every frame

### Key Files Modified
- `src/states/RacingState.ts` - Added debug overlay integration
- `src/debug/MultiplayerDebugOverlay.ts` - New debug overlay component

### Snapshot Flow
1. Host creates snapshot with all player positions
2. Host broadcasts snapshot to all guests via WebRTC
3. Guest receives snapshot in `handleHostSnapshot`
4. Guest creates opponent mesh if not exists
5. Guest calls `updateRemotePlayer` to replicate position
6. OpponentController interpolates movement for smooth visuals

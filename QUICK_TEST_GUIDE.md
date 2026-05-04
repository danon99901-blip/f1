# Manual Browser Test - Quick Reference Card

## 🚀 Quick Start (30 seconds)

```bash
# Dev server should already be running at http://localhost:5173
# If not: npm run dev
```

## 📋 Two-Window Test

### Window 1 (Host) - Left Side
```
1. Open http://localhost:5173
2. Click "Create Lobby"
3. Copy lobby code (e.g., "ABC123")
4. Click "Start Race"
5. Press ↑ arrow to accelerate
6. Press 'T' to see diagnostics
```

### Window 2 (Client) - Right Side
```
1. Open http://localhost:5173
2. Paste lobby code
3. Click "Join Lobby"
4. Wait for race to start
5. Press ↑ arrow to accelerate
6. Press 'T' to see diagnostics
```

## ✅ What You Should See

### Host Window
- ✅ Your car (blue)
- ✅ Client car (red) appears when client joins
- ✅ Client car moves when client presses arrows
- ✅ Diagnostics: `snapshots_sent` counter increasing
- ✅ Diagnostics: `opponent_guest-id: { exists: true }`

### Client Window (THE CRITICAL TEST)
- ✅ Your car (blue)
- ✅ **Host car (red) is VISIBLE** ← This was broken before
- ✅ **Host car MOVES when host presses arrows** ← This was broken before
- ✅ Diagnostics: `snapshots_received` counter increasing
- ✅ Diagnostics: `opponent_host-id: { exists: true, position: "(...)" }`

## 🔍 Diagnostic Keys

- **'T'** - Toggle test diagnostics overlay (detailed stats)
- **'D'** - Toggle debug overlay (basic multiplayer info)
- **ESC** - Pause game

## 🐛 If Something's Wrong

### Client doesn't see host car
Check diagnostics (press 'T'):
- `opponent_host-id` should show `{ exists: true }`
- `snapshots_received` should be increasing
- `opponent_host-id_created` should be `true`

### Cars don't move
Check diagnostics:
- Position values should be changing
- `snapshots_sent` / `snapshots_received` should be increasing
- Check browser console for errors (F12)

### Can't connect
- Check both windows show "Status: Connected" in debug overlay ('D')
- Check browser console for WebSocket errors
- Verify lobby code is correct

## 📊 Expected Diagnostics Output

### Host (press 'T'):
```
network: { connected: true, role: "Host", lobby: "abc123" }
local_player: { position: "(1.23, 0.00, 4.56)", speed: "72.5 km/h" }
opponent_guest-id: { exists: true, position: "(5.67, 0.00, 8.90)" }
snapshots_sent: 150
opponents_created: 1
```

### Client (press 'T'):
```
network: { connected: true, role: "Guest", lobby: "abc123" }
local_player: { position: "(5.67, 0.00, 8.90)", speed: "65.2 km/h" }
opponent_host-id: { exists: true, position: "(1.23, 0.00, 4.56)" }
snapshots_received: 150
opponents_created: 1
```

## ✍️ Record Your Results

After testing, note:
- [ ] Host can see client car: YES / NO
- [ ] Host sees client movement: YES / NO
- [ ] Client can see host car: YES / NO ← CRITICAL
- [ ] Client sees host movement: YES / NO ← CRITICAL
- [ ] No console errors: YES / NO
- [ ] Smooth movement: YES / NO

## 🎯 Success = All 6 checkboxes are YES

---

**Current Status:** Dev server running at http://localhost:5173
**Time to test:** ~2 minutes
**Critical fix:** Client should now see host car and movement

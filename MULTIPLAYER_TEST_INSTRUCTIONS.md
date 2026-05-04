# Multiplayer Testing Instructions

## Setup
The dev server should be running at: http://localhost:5173/

To start the dev server:
```bash
npm run dev
```

## How to Test

### Step 1: Open Two Browser Windows
1. **Window 1 (Host)**: Open http://localhost:5173/ in Chrome/Firefox
2. **Window 2 (Guest)**: Open http://localhost:5173/ in Chrome/Firefox (incognito or different profile)

### Step 2: Open Developer Console in Both Windows
- Press `F12` or `Ctrl+Shift+I` (Linux/Windows) or `Cmd+Option+I` (Mac)
- Go to the **Console** tab

### Step 3: Create a Room (Host)
1. In **Window 1**, click "Multiplayer"
2. Click "Create Room"
3. You'll see a room code (e.g., "ABC123")
4. Click "Start Race"

### Step 4: Join the Room (Guest)
1. In **Window 2**, click "Multiplayer"
2. Click "Join Room"
3. Enter the room code from Window 1
4. Click "Join"
5. Wait for the host to start the race

### Step 5: Check the Debug Overlay
In the **top-right corner** of each window, you should see a debug overlay showing:
- **Host (Window 1)**: 
  - 🔴 HOST
  - Snapshots sent: (increasing number)
  - Guest vehicles: 1
  - Guest ID

- **Guest (Window 2)**:
  - 🟢 GUEST
  - Snapshots received: (increasing number)
  - Opponent meshes: 1
  - Host ID

### Step 6: Use Console Test Helper
In the console of either window, type:
```javascript
checkMultiplayer()
```

This will show detailed information about:
- Game mode (HOST/GUEST)
- Scene objects and car meshes
- Opponent/guest vehicle state
- Mesh positions and visibility

### Step 7: Check Console Logs
Look for these **colored console messages**:

**In Host Console (Window 1):**
- 🔴 Red background: `[HOST] Broadcasting snapshot #X with 2 players`
- 🟠 Orange background: `[HOST] Received input from guest`
- 🟣 Purple background: `[HOST] Creating NEW guest vehicle`

**In Guest Console (Window 2):**
- 🟢 Green background: `[GUEST] Received snapshot with 2 players`
- 🟣 Purple background: `[GUEST] Creating NEW opponent mesh`
- 🔵 Blue background: `[GUEST] Processing MY player snapshot`
- 🔷 Cyan background: `[GUEST] Updating opponent`

### Step 8: What to Look For

✅ **SUCCESS - You should see:**
1. Both cars visible in both windows
2. Debug overlay showing increasing snapshot counts
3. Colored console logs appearing regularly
4. Cars moving when you press W/A/S/D
5. `checkMultiplayer()` shows 2 car meshes in scene

❌ **FAILURE - If you see:**
1. Only one car visible
2. Snapshot counts not increasing
3. No colored console logs
4. Debug overlay showing "Opponent meshes: 0"
5. `checkMultiplayer()` shows only 1 car mesh

### Step 9: Report Results
Please check:
1. Can you see BOTH cars in BOTH windows?
2. What do the debug overlays show?
3. What colored console messages appear?
4. What does `checkMultiplayer()` output show?
5. Take screenshots if possible

## Troubleshooting

If you don't see the opponent car:
1. Check if snapshots are being sent/received (debug overlay)
2. Look for error messages in console (red text)
3. Run `checkMultiplayer()` to see scene state
4. Check if the opponent mesh was created (purple log)
5. Verify both players are in the same room (check room code)

## Additional Tools

### Console Test Helper
The `checkMultiplayer()` function is automatically available in the console when in multiplayer mode. It shows:
- Total scene children count
- All car-related meshes with positions
- Guest vehicles (Host only)
- Remote opponents (Guest only)
- Mesh visibility status

Run it multiple times to see state changes as the game progresses.

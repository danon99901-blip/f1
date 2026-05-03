# HUD Notification System

## Overview

Non-blocking notification system for displaying temporary messages to players during races. Replaces blocking `alert()` calls with smooth, dismissible notifications.

## API

### `showNotification(message: string, type?: NotificationType, durationMs?: number): void`

Display a notification with automatic dismissal.

**Parameters:**
- `message` - Text to display
- `type` - `'info' | 'warning' | 'error' | 'success'` (default: `'info'`)
- `durationMs` - Auto-dismiss delay in milliseconds (default: `4000`)

**Example:**
```typescript
hud.showNotification('Player disconnected', 'warning', 5000);
```

### `showError(message: string): void`

Shorthand for error notifications with longer duration (6 seconds).

**Example:**
```typescript
hud.showError('Host disconnected. Returning to menu...');
```

## Notification Types

| Type | Color | Icon | Use Case |
|------|-------|------|----------|
| `info` | Blue | ℹ | General information |
| `success` | Green | ✓ | Successful operations |
| `warning` | Orange | ⚠ | Non-critical issues (player disconnect) |
| `error` | Red | ✕ | Critical errors (host disconnect, connection lost) |

## Features

- **Non-blocking** - Game continues while notification is visible
- **Auto-dismiss** - Notifications fade out after specified duration
- **Manual dismiss** - Click notification to dismiss immediately
- **Stacking** - Multiple notifications stack vertically
- **Smooth animations** - Slide-in/slide-out with cubic-bezier easing
- **Mobile responsive** - Adapts to narrow viewports
- **Accessibility** - Respects `prefers-reduced-motion`

## Styling

Notifications inherit F1 broadcast styling:
- Glass-morphism background with backdrop blur
- Angular clip-path cuts
- Color-coded left border
- Icon with glow effect
- Smooth transitions

## Testing

Run `npm run dev` and open `/test-notifications.html` to test all notification types.

## Migration from `alert()`

**Before:**
```typescript
alert('Host disconnected. Returning to menu...');
```

**After:**
```typescript
if (this.hud) {
  this.hud.showError('Host disconnected. Returning to menu...');
}
```

## Implementation Details

- Notifications positioned at `top: 7rem; right: 1.25rem`
- Container uses `z-index: 100` (above HUD panels, below pause/results overlays)
- Each notification is clickable (`pointer-events: auto`)
- Active notifications tracked in `Set<HTMLElement>` for cleanup
- Exit animation duration: 300ms

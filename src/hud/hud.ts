// F1 broadcast-style HUD overlay.
// Plain DOM, no framework. Construct once, mutate text/classes per-frame.

export type Gear = number | 'N' | 'R';

export interface NetworkStats {
  ping: number;
  jitter: number;
  state: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  reconnectAttempt?: number;
}

export interface HudState {
  speedKmh: number;
  gear: Gear;
  currentLap: number;
  totalLaps: number;
  lapTimeMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  position: number;
  totalCars: number;
  networkStats?: NetworkStats | null;
}

export type NotificationType = 'info' | 'warning' | 'error' | 'success';

export interface Hud {
  root: HTMLElement;
  update(state: HudState): void;
  showNotification(message: string, type?: NotificationType, durationMs?: number): void;
  showError(message: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatLapTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '--:--.---';
  const totalMs = Math.floor(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatSpeed(kmh: number): string {
  const v = Math.max(0, Math.round(kmh));
  return String(v).padStart(3, '0');
}

function formatGear(g: Gear): string {
  if (g === 'N' || g === 'R') return g;
  if (!Number.isFinite(g) || g <= 0) return 'N';
  return String(Math.min(8, Math.max(1, Math.floor(g))));
}

function formatCount(n: number, total: number): string {
  const a = String(Math.max(0, Math.floor(n))).padStart(2, '0');
  const b = String(Math.max(0, Math.floor(total))).padStart(2, '0');
  return `${a}/${b}`;
}

export function createHud(): Hud {
  const root = el('div', 'hud-root');
  root.setAttribute('aria-hidden', 'true');

  // ---- Top-left: lap counter ----
  const lapPanel = el('div', 'hud-panel hud-lap hud-anim hud-anim-tl');
  const lapLabel = el('div', 'hud-panel-label', 'LAP');
  const lapValue = el('div', 'hud-panel-value hud-num', '00/00');
  lapPanel.append(lapLabel, lapValue);

  // ---- Top-right: position ----
  const posPanel = el('div', 'hud-panel hud-pos hud-anim hud-anim-tr');
  const posLabel = el('div', 'hud-panel-label', 'POS');
  const posValueWrap = el('div', 'hud-pos-value');
  const posPrefix = el('span', 'hud-pos-prefix', 'P');
  const posValue = el('span', 'hud-num', '00');
  const posTotal = el('span', 'hud-pos-total hud-num', '/00');
  posValueWrap.append(posPrefix, posValue, posTotal);
  posPanel.append(posLabel, posValueWrap);

  // ---- Top-center: lap times ----
  const timesPanel = el('div', 'hud-panel hud-times hud-anim hud-anim-top');

  const timeRowCurrent = el('div', 'hud-time-row');
  const timeCurrentLabel = el('span', 'hud-time-label', 'CURRENT');
  const timeCurrentValue = el('span', 'hud-time-value hud-num', '--:--.---');
  timeRowCurrent.append(timeCurrentLabel, timeCurrentValue);

  const timeRowLast = el('div', 'hud-time-row');
  const timeLastLabel = el('span', 'hud-time-label', 'LAST');
  const timeLastValue = el('span', 'hud-time-value hud-num', '--:--.---');
  timeRowLast.append(timeLastLabel, timeLastValue);

  const timeRowBest = el('div', 'hud-time-row hud-time-best');
  const timeBestLabel = el('span', 'hud-time-label', 'BEST');
  const timeBestValue = el('span', 'hud-time-value hud-num', '--:--.---');
  timeRowBest.append(timeBestLabel, timeBestValue);

  timesPanel.append(timeRowCurrent, timeRowLast, timeRowBest);

  // ---- Bottom-center: gear ----
  const gearPanel = el('div', 'hud-panel hud-gear hud-anim hud-anim-bottom');
  const gearValue = el('div', 'hud-gear-value hud-num', 'N');
  const gearLabel = el('div', 'hud-panel-label hud-gear-label', 'GEAR');
  gearPanel.append(gearValue, gearLabel);

  // ---- Bottom-left: speedometer ----
  const speedPanel = el('div', 'hud-panel hud-speed hud-anim hud-anim-bl');
  const speedValue = el('div', 'hud-speed-value hud-num', '000');
  const speedUnit = el('div', 'hud-speed-unit', 'KM/H');
  // Decorative arc bar: filled width scales with speed up to ~360 km/h.
  const speedBarWrap = el('div', 'hud-speed-bar');
  const speedBarFill = el('div', 'hud-speed-bar-fill');
  speedBarWrap.append(speedBarFill);
  speedPanel.append(speedValue, speedUnit, speedBarWrap);

  // ---- Top-right (below position): network stats ----
  const netPanel = el('div', 'hud-panel hud-network hud-anim hud-anim-tr');
  netPanel.style.display = 'none'; // Hidden by default, shown only in multiplayer
  const netIcon = el('div', 'hud-net-icon');
  const netPing = el('div', 'hud-net-ping hud-num', '--');
  const netUnit = el('div', 'hud-net-unit', 'ms');
  netPanel.append(netIcon, netPing, netUnit);

  // ---- Top-right: FPS counter ----
  // Self-contained: measures inter-frame time from update() calls. Uses an EWMA so
  // the displayed value doesn't flicker every frame, but updates fast enough that
  // a real fps drop is visible within ~250ms.
  const fpsPanel = el('div', 'hud-panel hud-fps hud-anim hud-anim-tr');
  const fpsValue = el('div', 'hud-fps-value hud-num', '--');
  const fpsLabel = el('div', 'hud-fps-label', 'FPS');
  fpsPanel.append(fpsValue, fpsLabel);
  // Inline minimal styling so we don't need to touch CSS files for this debug panel.
  fpsPanel.style.cssText = 'position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.55);color:#fff;font-family:monospace;font-size:14px;padding:4px 8px;border-radius:4px;z-index:1000;display:flex;gap:6px;align-items:baseline;';
  fpsValue.style.cssText = 'font-size:18px;font-weight:bold;';
  fpsLabel.style.cssText = 'font-size:10px;opacity:0.7;';

  let lastFpsUpdate = performance.now();
  let smoothedFps = 0;
  let frameCounter = 0;

  // ---- Center overlay: reconnection notification ----
  const reconnectOverlay = el('div', 'hud-reconnect-overlay');
  reconnectOverlay.style.display = 'none';
  const reconnectBox = el('div', 'hud-reconnect-box');
  const reconnectIcon = el('div', 'hud-reconnect-icon', '⟳');
  const reconnectText = el('div', 'hud-reconnect-text', 'Reconnecting...');
  const reconnectAttempt = el('div', 'hud-reconnect-attempt', 'Attempt 1/5');
  reconnectBox.append(reconnectIcon, reconnectText, reconnectAttempt);
  reconnectOverlay.append(reconnectBox);

  // ---- Notification system ----
  const notificationContainer = el('div', 'hud-notification-container');

  root.append(lapPanel, posPanel, timesPanel, gearPanel, speedPanel, netPanel, fpsPanel, reconnectOverlay, notificationContainer);

  // Track previous best to flash on improvement.
  let lastBestMs: number | null = null;

  // Active notifications tracking
  const activeNotifications = new Set<HTMLElement>();

  function update(state: HudState): void {
    // FPS — sampled from inter-frame time, smoothed via EWMA, displayed every 250ms.
    // We compute every frame so the EWMA tracks accurately, but only paint to the DOM
    // 4x/sec to avoid font-rendering jank.
    const now = performance.now();
    const dt = now - lastFpsUpdate;
    lastFpsUpdate = now;
    if (dt > 0 && dt < 1000) {
      const instantFps = 1000 / dt;
      smoothedFps = smoothedFps === 0 ? instantFps : smoothedFps * 0.9 + instantFps * 0.1;
    }
    frameCounter++;
    if (frameCounter >= 15) {
      frameCounter = 0;
      const rounded = Math.round(smoothedFps);
      fpsValue.textContent = String(rounded);
      // Color-code: green ≥55, yellow 30-54, red <30.
      fpsValue.style.color = rounded >= 55 ? '#7fff7f' : rounded >= 30 ? '#ffd57f' : '#ff7f7f';
    }

    // Speed
    speedValue.textContent = formatSpeed(state.speedKmh);
    const pct = Math.min(1, Math.max(0, state.speedKmh / 360));
    speedBarFill.style.transform = `scaleX(${pct.toFixed(3)})`;

    // Gear
    const gearText = formatGear(state.gear);
    if (gearValue.textContent !== gearText) {
      gearValue.textContent = gearText;
    }
    gearPanel.classList.toggle('hud-gear-neutral', gearText === 'N' || gearText === 'R');

    // Lap counter
    lapValue.textContent = formatCount(state.currentLap, state.totalLaps);

    // Position
    posValue.textContent = String(Math.max(0, Math.floor(state.position))).padStart(2, '0');
    posTotal.textContent = '/' + String(Math.max(0, Math.floor(state.totalCars))).padStart(2, '0');

    // Lap times
    timeCurrentValue.textContent = formatLapTime(state.lapTimeMs);
    timeLastValue.textContent = formatLapTime(state.lastLapMs);
    timeBestValue.textContent = formatLapTime(state.bestLapMs);

    // Highlight current as a personal best in real time
    const currentIsBest =
      state.bestLapMs !== null &&
      state.lapTimeMs > 0 &&
      state.lapTimeMs < state.bestLapMs;
    timeRowCurrent.classList.toggle('hud-time-best', currentIsBest);

    // Flash row when best improves
    if (state.bestLapMs !== null && state.bestLapMs !== lastBestMs && lastBestMs !== null) {
      timeRowBest.classList.remove('hud-flash');
      // Force reflow to restart animation.
      void timeRowBest.offsetWidth;
      timeRowBest.classList.add('hud-flash');
    }
    lastBestMs = state.bestLapMs;

    // Network stats (multiplayer only)
    if (state.networkStats) {
      netPanel.style.display = '';
      const { ping, jitter, state: netState, reconnectAttempt: attemptNum } = state.networkStats;

      // Show reconnection overlay if reconnecting
      if (netState === 'reconnecting') {
        reconnectOverlay.style.display = 'flex';
        if (attemptNum !== undefined) {
          reconnectAttempt.textContent = `Attempt ${attemptNum}/5`;
        }
      } else {
        reconnectOverlay.style.display = 'none';
      }

      // Update ping display
      if (Number.isFinite(ping) && ping >= 0) {
        netPing.textContent = String(Math.round(ping));
      } else {
        netPing.textContent = '--';
      }

      // Color code by ping quality
      netPanel.classList.remove('hud-net-good', 'hud-net-ok', 'hud-net-bad', 'hud-net-disconnected');
      if (netState === 'disconnected') {
        netPanel.classList.add('hud-net-disconnected');
        netIcon.textContent = '⚠';
      } else if (netState === 'connecting' || netState === 'reconnecting') {
        netPanel.classList.add('hud-net-ok');
        netIcon.textContent = '⟳';
      } else if (ping < 50) {
        netPanel.classList.add('hud-net-good');
        netIcon.textContent = '●';
      } else if (ping < 100) {
        netPanel.classList.add('hud-net-ok');
        netIcon.textContent = '●';
      } else {
        netPanel.classList.add('hud-net-bad');
        netIcon.textContent = '●';
      }

      // Show jitter warning if high
      if (jitter > 20) {
        netPanel.classList.add('hud-net-jitter');
      } else {
        netPanel.classList.remove('hud-net-jitter');
      }
    } else {
      netPanel.style.display = 'none';
      reconnectOverlay.style.display = 'none';
    }
  }

  function showNotification(message: string, type: NotificationType = 'info', durationMs: number = 4000): void {
    const notification = el('div', `hud-notification hud-notification-${type}`);

    // Icon based on type
    const icon = el('div', 'hud-notification-icon');
    switch (type) {
      case 'error':
        icon.textContent = '✕';
        break;
      case 'warning':
        icon.textContent = '⚠';
        break;
      case 'success':
        icon.textContent = '✓';
        break;
      case 'info':
      default:
        icon.textContent = 'ℹ';
        break;
    }

    const text = el('div', 'hud-notification-text', message);
    notification.append(icon, text);

    // Add to container
    notificationContainer.append(notification);
    activeNotifications.add(notification);

    // Trigger enter animation
    requestAnimationFrame(() => {
      notification.classList.add('hud-notification-enter');
    });

    // Auto-remove after duration
    const removeTimeout = setTimeout(() => {
      notification.classList.remove('hud-notification-enter');
      notification.classList.add('hud-notification-exit');

      // Wait for exit animation
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
        activeNotifications.delete(notification);
      }, 300);
    }, durationMs);

    // Allow manual dismiss on click
    notification.addEventListener('click', () => {
      clearTimeout(removeTimeout);
      notification.classList.remove('hud-notification-enter');
      notification.classList.add('hud-notification-exit');

      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
        activeNotifications.delete(notification);
      }, 300);
    });
  }

  function showError(message: string): void {
    showNotification(message, 'error', 6000); // Errors stay longer
  }

  return { root, update, showNotification, showError };
}

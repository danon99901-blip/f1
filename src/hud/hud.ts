// F1 broadcast-style HUD overlay.
// Plain DOM, no framework. Construct once, mutate text/classes per-frame.

export type Gear = number | 'N' | 'R';

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
}

export interface Hud {
  root: HTMLElement;
  update(state: HudState): void;
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

  root.append(lapPanel, posPanel, timesPanel, gearPanel, speedPanel);

  // Track previous best to flash on improvement.
  let lastBestMs: number | null = null;

  function update(state: HudState): void {
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
  }

  return { root, update };
}

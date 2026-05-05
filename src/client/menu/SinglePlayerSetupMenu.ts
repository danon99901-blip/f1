// Single player setup menu UI component

import type { TrackType } from '../../shared/types';
import { LAP_OPTIONS } from '../../shared/constants';

const TRACK_OPTIONS = [
  { id: 'default' as TrackType, name: 'Catalunya' },
  { id: 'silverstone' as TrackType, name: 'Silverstone' },
  { id: 'monaco' as TrackType, name: 'Monaco' },
];

export interface SinglePlayerSetupMenuCallbacks {
  onStartRace: (trackType: string, totalLaps: number) => void;
  onBack: () => void;
}

export class SinglePlayerSetupMenu {
  private root: HTMLElement;
  private callbacks: SinglePlayerSetupMenuCallbacks;
  private selectedTrack: TrackType = 'default';
  private selectedLaps: number = 3;

  constructor(callbacks: SinglePlayerSetupMenuCallbacks) {
    this.callbacks = callbacks;
    this.root = this.createDOM();
  }

  private createDOM(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'menu-overlay';
    overlay.innerHTML = `
      <div class="menu-container">
        <div class="menu-panel" id="setup-content"></div>
      </div>
    `;
    return overlay;
  }

  private render(): void {
    const content = this.root.querySelector('#setup-content');
    if (!content) return;

    content.innerHTML = `
      <h1 class="menu-title">Single Player</h1>

      <div class="lobby-settings">
        <div class="lobby-setting-row">
          <div class="lobby-setting-label">Track</div>
          <div class="lobby-track-selector">
            ${TRACK_OPTIONS.map(
              (track) => `
              <button
                class="lobby-track-btn ${track.id === this.selectedTrack ? 'active' : ''}"
                data-track="${track.id}"
              >
                ${track.name}
              </button>
            `,
            ).join('')}
          </div>
        </div>

        <div class="lobby-setting-row">
          <div class="lobby-setting-label">Laps</div>
          <div class="lobby-lap-selector">
            ${LAP_OPTIONS.map(
              (laps) => `
              <button
                class="lobby-lap-btn ${laps === this.selectedLaps ? 'active' : ''}"
                data-laps="${laps}"
              >
                ${laps}
              </button>
            `,
            ).join('')}
          </div>
        </div>
      </div>

      <div class="menu-button-row">
        <button class="menu-button" id="btn-back">Back</button>
        <button class="menu-button primary" id="btn-start">Start Race</button>
      </div>
    `;

    // Track selector buttons
    content.querySelectorAll('.lobby-track-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedTrack = (btn as HTMLElement).dataset.track as TrackType;
        this.render();
      });
    });

    // Lap selector buttons
    content.querySelectorAll('.lobby-lap-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedLaps = parseInt((btn as HTMLElement).dataset.laps || '3');
        this.render();
      });
    });

    // Back button
    content.querySelector('#btn-back')?.addEventListener('click', () => {
      this.callbacks.onBack();
    });

    // Start button
    content.querySelector('#btn-start')?.addEventListener('click', () => {
      this.callbacks.onStartRace(this.selectedTrack, this.selectedLaps);
    });
  }

  show(): void {
    this.render();
    document.body.appendChild(this.root);
  }

  hide(): void {
    this.root.remove();
  }
}

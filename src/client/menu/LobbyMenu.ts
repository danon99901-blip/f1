// Lobby menu UI component

import type { RoomInfo } from '../../shared/types';
import { LAP_OPTIONS } from '../../shared/constants';

export interface LobbyMenuCallbacks {
  onStartRace: () => void;
  onLeaveLobby: () => void;
  onChangeLaps: (laps: number) => void;
  onColorChange: (color: number) => void;
}

// F1 team colors
const CAR_COLORS = [
  { name: 'Red Bull', hex: '#1E41FF' },
  { name: 'Ferrari', hex: '#E10600' },
  { name: 'Mercedes', hex: '#00D2BE' },
  { name: 'McLaren', hex: '#FF8700' },
  { name: 'Alpine', hex: '#0090FF' },
  { name: 'Aston Martin', hex: '#006F62' },
];

export class LobbyMenu {
  private root: HTMLElement;
  private callbacks: LobbyMenuCallbacks;
  private roomInfo: RoomInfo;
  private isHost: boolean;
  private localPlayerId: string;

  constructor(roomInfo: RoomInfo, isHost: boolean, callbacks: LobbyMenuCallbacks, localPlayerId: string) {
    this.roomInfo = roomInfo;
    this.isHost = isHost;
    this.callbacks = callbacks;
    this.localPlayerId = localPlayerId;
    this.root = this.createDOM();
  }

  private createDOM(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'menu-overlay';
    overlay.innerHTML = `
      <div class="menu-container">
        <div class="menu-panel" id="lobby-content"></div>
      </div>
    `;
    return overlay;
  }

  private render(): void {
    const content = this.root.querySelector('#lobby-content');
    if (!content) return;

    const playersList = this.roomInfo.players
      .map(
        (p) => {
          const isLocalPlayer = p.id === this.localPlayerId;
          const colorPicker = isLocalPlayer
            ? `
            <div class="lobby-color-picker">
              ${CAR_COLORS.map(
                (c) => `
                <button
                  class="lobby-color-btn ${parseInt(c.hex.replace('#', '0x')) === p.carColor ? 'active' : ''}"
                  data-color="${parseInt(c.hex.replace('#', '0x'))}"
                  style="background-color: ${c.hex}"
                  title="${c.name}"
                ></button>
              `,
              ).join('')}
            </div>
          `
            : `<div class="lobby-player-color" style="background-color: #${p.carColor.toString(16).padStart(6, '0')}"></div>`;

          return `
            <div class="lobby-player">
              <div class="lobby-player-info">
                <div class="lobby-player-dot"></div>
                <div class="lobby-player-name">${this.escapeHtml(p.name)}</div>
                ${p.isHost ? '<div class="lobby-player-badge">Host</div>' : ''}
              </div>
              ${colorPicker}
            </div>
          `;
        },
      )
      .join('');

    const lapSelector = this.isHost
      ? `
        <div class="lobby-lap-selector">
          ${LAP_OPTIONS.map(
            (laps) => `
            <button
              class="lobby-lap-btn ${laps === this.roomInfo.totalLaps ? 'active' : ''}"
              data-laps="${laps}"
            >
              ${laps}
            </button>
          `,
          ).join('')}
        </div>
      `
      : `<div class="lobby-setting-value">${this.roomInfo.totalLaps}</div>`;

    content.innerHTML = `
      <div class="lobby-header">
        <div>
          <div class="menu-label">Room Code</div>
          <div class="lobby-room-code">${this.roomInfo.roomId}</div>
        </div>
        <button class="lobby-copy-btn" id="btn-copy">COPY</button>
      </div>

      <div class="menu-section">
        <div class="menu-label">Players (${this.roomInfo.players.length}/4)</div>
        <div class="lobby-players">${playersList}</div>
      </div>

      <div class="lobby-settings">
        <div class="lobby-setting-row">
          <div class="lobby-setting-label">Laps</div>
          ${lapSelector}
        </div>
      </div>

      <div class="menu-button-row">
        <button class="menu-button" id="btn-leave">Leave</button>
        ${
          this.isHost
            ? `<button class="menu-button primary" id="btn-start" ${this.roomInfo.players.length < 2 ? 'disabled' : ''}>Start Race</button>`
            : '<button class="menu-button" disabled>Waiting for host...</button>'
        }
      </div>
    `;

    // Copy button
    content.querySelector('#btn-copy')?.addEventListener('click', () => {
      this.copyRoomCode();
    });

    // Color picker buttons
    content.querySelectorAll('.lobby-color-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const color = parseInt((btn as HTMLElement).dataset.color || '0xe10600');
        this.callbacks.onColorChange(color);
      });
    });

    // Leave button
    content.querySelector('#btn-leave')?.addEventListener('click', () => {
      this.callbacks.onLeaveLobby();
    });

    // Start button (host only)
    if (this.isHost) {
      content.querySelector('#btn-start')?.addEventListener('click', () => {
        if (this.roomInfo.players.length >= 2) {
          this.callbacks.onStartRace();
        }
      });

      // Lap selector buttons
      content.querySelectorAll('.lobby-lap-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const laps = parseInt((btn as HTMLElement).dataset.laps || '3');
          this.callbacks.onChangeLaps(laps);
        });
      });
    }
  }

  private copyRoomCode(): void {
    navigator.clipboard.writeText(this.roomInfo.roomId).then(
      () => {
        const btn = this.root.querySelector('#btn-copy');
        if (btn) {
          const originalText = btn.textContent;
          btn.textContent = 'COPIED!';
          setTimeout(() => {
            btn.textContent = originalText;
          }, 2000);
        }
      },
      (err) => {
        console.error('Failed to copy room code:', err);
      },
    );
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  updateRoomInfo(roomInfo: RoomInfo): void {
    this.roomInfo = roomInfo;
    this.render();
  }

  show(): void {
    this.render();
    document.body.appendChild(this.root);
  }

  hide(): void {
    this.root.remove();
  }
}

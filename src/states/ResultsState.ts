// Results state - post-race results screen

import type { GameState, StateContext } from '../core/GameStateMachine';
import type { RaceResult } from '../game/RaceController';

export class ResultsState implements GameState {
  readonly name = 'results';
  private context: StateContext | null = null;
  private resultsContainer: HTMLElement | null = null;

  async enter(context: StateContext): Promise<void> {
    this.context = context;
    const results = (context.data?.raceResults as RaceResult[]) ?? [];

    this.showResults(results);
  }

  update(_dt: number): void {
    // Results screen is static
  }

  async exit(): Promise<void> {
    if (this.resultsContainer) {
      document.body.removeChild(this.resultsContainer);
      this.resultsContainer = null;
    }
    this.context = null;
  }

  private showResults(results: RaceResult[]): void {
    this.resultsContainer = document.createElement('div');
    this.resultsContainer.className = 'results-overlay';
    this.resultsContainer.innerHTML = `
      <div class="results-container">
        <div class="results-title">RACE COMPLETE</div>
        <div class="results-panel">
          <div class="results-header">
            <div class="results-header-col">POS</div>
            <div class="results-header-col">DRIVER</div>
            <div class="results-header-col">TIME</div>
            <div class="results-header-col">BEST LAP</div>
          </div>
          <div class="results-table">
            ${results.map((result) => this.createResultRow(result)).join('')}
          </div>
        </div>
        <div class="results-buttons">
          <button class="results-btn results-btn-primary" id="btn-restart">
            <span class="results-btn-icon">↻</span>
            Restart Race
          </button>
          <button class="results-btn" id="btn-menu">
            <span class="results-btn-icon">←</span>
            Main Menu
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.resultsContainer);

    // Setup button handlers
    this.resultsContainer.querySelector('#btn-restart')?.addEventListener('click', () => {
      if (this.context) {
        this.context.eventBus.emit('game:request-state-change', { from: 'results', to: 'racing' });
      }
    });

    this.resultsContainer.querySelector('#btn-menu')?.addEventListener('click', () => {
      if (this.context) {
        this.context.eventBus.emit('game:request-state-change', { from: 'results', to: 'menu' });
      }
    });
  }

  private createResultRow(result: RaceResult): string {
    const positionClass = result.position === 1 ? 'results-row-first' :
                         result.position === 2 ? 'results-row-second' :
                         result.position === 3 ? 'results-row-third' : '';

    const positionIcon = result.position === 1 ? '🥇' :
                        result.position === 2 ? '🥈' :
                        result.position === 3 ? '🥉' :
                        `P${result.position}`;

    const time = this.formatTime(result.totalTime);
    const bestLap = result.bestLap ? this.formatTime(result.bestLap / 1000) : '--:--.---';

    return `
      <div class="results-row ${positionClass}">
        <div class="results-cell results-position">${positionIcon}</div>
        <div class="results-cell results-name">${result.name}</div>
        <div class="results-cell results-time">${time}</div>
        <div class="results-cell results-best">${bestLap}</div>
      </div>
    `;
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
}

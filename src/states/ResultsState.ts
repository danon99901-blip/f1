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
    this.resultsContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: white;
      font-family: monospace;
      z-index: 1000;
    `;

    const title = document.createElement('h1');
    title.textContent = 'Race Results';
    title.style.cssText = 'font-size: 48px; margin-bottom: 40px;';
    this.resultsContainer.appendChild(title);

    const table = document.createElement('div');
    table.style.cssText = 'font-size: 24px; margin-bottom: 40px;';

    results.forEach((result) => {
      const row = document.createElement('div');
      row.style.cssText = 'margin: 10px 0;';

      const position = result.position === 1 ? '🥇' : result.position === 2 ? '🥈' : result.position === 3 ? '🥉' : `${result.position}.`;
      const time = this.formatTime(result.totalTime);
      const bestLap = result.bestLap ? this.formatTime(result.bestLap / 1000) : 'N/A';

      row.textContent = `${position} ${result.name} - ${time} (Best: ${bestLap})`;
      table.appendChild(row);
    });

    this.resultsContainer.appendChild(table);

    const button = document.createElement('button');
    button.textContent = 'Back to Menu';
    button.style.cssText = `
      padding: 15px 30px;
      font-size: 20px;
      background: #e10600;
      color: white;
      border: none;
      cursor: pointer;
      font-family: monospace;
    `;
    button.onclick = () => {
      if (this.context) {
        this.context.eventBus.emit('game:state-change', { from: 'results', to: 'menu' });
      }
    };
    this.resultsContainer.appendChild(button);

    document.body.appendChild(this.resultsContainer);
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
}

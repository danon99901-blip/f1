// Countdown overlay for race start

export class CountdownOverlay {
  private root: HTMLElement;
  private countdownEl: HTMLElement;

  constructor() {
    this.root = this.createDOM();
    this.countdownEl = this.root.querySelector('#countdown-number')!;
  }

  private createDOM(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'countdown-overlay hidden';
    overlay.innerHTML = `
      <div class="countdown-container">
        <div class="countdown-number" id="countdown-number">3</div>
      </div>
    `;
    return overlay;
  }

  show(seconds: number, onComplete: () => void): void {
    document.body.appendChild(this.root);
    this.root.classList.remove('hidden');

    let remaining = seconds;
    this.countdownEl.textContent = String(remaining);
    this.countdownEl.className = 'countdown-number countdown-pulse';

    const interval = setInterval(() => {
      remaining--;

      if (remaining > 0) {
        this.countdownEl.textContent = String(remaining);
        // Restart animation
        this.countdownEl.classList.remove('countdown-pulse');
        void this.countdownEl.offsetWidth; // Force reflow
        this.countdownEl.classList.add('countdown-pulse');
      } else {
        this.countdownEl.textContent = 'GO!';
        this.countdownEl.classList.remove('countdown-pulse');
        this.countdownEl.classList.add('countdown-go');

        setTimeout(() => {
          this.hide();
          onComplete();
        }, 800);

        clearInterval(interval);
      }
    }, 1000);
  }

  hide(): void {
    this.root.classList.add('hidden');
    setTimeout(() => {
      this.root.remove();
    }, 300);
  }
}

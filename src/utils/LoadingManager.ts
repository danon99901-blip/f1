/**
 * LoadingManager tracks loading progress across multiple stages
 * and provides visual feedback to the user.
 */

export interface LoadingStage {
  name: string;
  weight: number; // Relative weight for progress calculation
  progress: number; // 0-1
}

export class LoadingManager {
  private stages: Map<string, LoadingStage> = new Map();
  private totalWeight = 0;
  private onProgressCallback?: (progress: number, stage: string) => void;

  constructor() {
    this.initStages();
  }

  private initStages() {
    // Define loading stages with relative weights based on typical load times
    const stageDefinitions = [
      { name: 'three', weight: 15 }, // Three.js core (~600KB)
      { name: 'rapier', weight: 40 }, // Rapier WASM (~2MB)
      { name: 'postprocessing', weight: 10 }, // Postprocessing (~200KB)
      { name: 'game-init', weight: 15 }, // Game session initialization
      { name: 'states', weight: 10 }, // State modules
      { name: 'assets', weight: 10 }, // Textures, models
    ];

    stageDefinitions.forEach(({ name, weight }) => {
      this.stages.set(name, { name, weight, progress: 0 });
      this.totalWeight += weight;
    });
  }

  /**
   * Update progress for a specific stage
   * @param stageName Stage identifier
   * @param progress Progress value 0-1
   */
  updateStage(stageName: string, progress: number) {
    const stage = this.stages.get(stageName);
    if (!stage) {
      console.warn(`[LoadingManager] Unknown stage: ${stageName}`);
      return;
    }

    stage.progress = Math.max(0, Math.min(1, progress));
    this.notifyProgress();
  }

  /**
   * Mark a stage as complete
   */
  completeStage(stageName: string) {
    this.updateStage(stageName, 1);
  }

  /**
   * Calculate overall progress (0-100)
   */
  getOverallProgress(): number {
    let weightedSum = 0;

    this.stages.forEach((stage) => {
      weightedSum += stage.progress * stage.weight;
    });

    return Math.round((weightedSum / this.totalWeight) * 100);
  }

  /**
   * Get current active stage (first incomplete stage)
   */
  getCurrentStage(): string {
    for (const [name, stage] of this.stages) {
      if (stage.progress < 1) {
        return name;
      }
    }
    return 'complete';
  }

  /**
   * Register progress callback
   */
  onProgress(callback: (progress: number, stage: string) => void) {
    this.onProgressCallback = callback;
  }

  private notifyProgress() {
    if (this.onProgressCallback) {
      const progress = this.getOverallProgress();
      const stage = this.getCurrentStage();
      this.onProgressCallback(progress, stage);
    }
  }

  /**
   * Reset all stages to 0
   */
  reset() {
    this.stages.forEach((stage) => {
      stage.progress = 0;
    });
    this.notifyProgress();
  }
}

// Singleton instance
export const loadingManager = new LoadingManager();

import { Injectable } from '@angular/core';

interface AnimationFrame {
  duration: number;
  transform?: string;
  opacity?: number;
  scale?: number;
  color?: string;
}

interface AnimationSequence {
  name: string;
  frames: AnimationFrame[];
  loop?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AnimationService {
  private animations: Map<string, AnimationSequence> = new Map();
  private activeAnimations: Map<string, { sequence: AnimationSequence; currentFrame: number; startTime: number; element: HTMLElement }> = new Map();

  constructor() {
    this.initializeAnimations();
  }

  private initializeAnimations() {
    // Agent idle animation
    this.animations.set('agent-idle', {
      name: 'agent-idle',
      frames: [
        { duration: 500, transform: 'translateY(0px)' },
        { duration: 500, transform: 'translateY(-2px)' },
        { duration: 500, transform: 'translateY(0px)' },
        { duration: 500, transform: 'translateY(2px)' }
      ],
      loop: true
    });

    // Agent running animation
    this.animations.set('agent-running', {
      name: 'agent-running',
      frames: [
        { duration: 200, transform: 'translateX(0px) translateY(0px)' },
        { duration: 200, transform: 'translateX(2px) translateY(-1px)' },
        { duration: 200, transform: 'translateX(0px) translateY(0px)' },
        { duration: 200, transform: 'translateX(-2px) translateY(1px)' }
      ],
      loop: true
    });

    // Agent busy animation
    this.animations.set('agent-busy', {
      name: 'agent-busy',
      frames: [
        { duration: 150, scale: 1 },
        { duration: 150, scale: 1.05 },
        { duration: 150, scale: 1 },
        { duration: 150, scale: 0.95 }
      ],
      loop: true
    });

    // Agent error animation
    this.animations.set('agent-error', {
      name: 'agent-error',
      frames: [
        { duration: 100, transform: 'rotate(0deg)' },
        { duration: 100, transform: 'rotate(-5deg)' },
        { duration: 100, transform: 'rotate(0deg)' },
        { duration: 100, transform: 'rotate(5deg)' }
      ],
      loop: true
    });

    // Agent victory animation
    this.animations.set('agent-victory', {
      name: 'agent-victory',
      frames: [
        { duration: 200, transform: 'scale(1) translateY(0px)' },
        { duration: 200, transform: 'scale(1.1) translateY(-5px)' },
        { duration: 200, transform: 'scale(1) translateY(0px)' },
        { duration: 200, transform: 'scale(1.1) translateY(-5px)' },
        { duration: 200, transform: 'scale(1) translateY(0px)' }
      ]
    });

    // Agent defeat animation
    this.animations.set('agent-defeat', {
      name: 'agent-defeat',
      frames: [
        { duration: 300, opacity: 1, transform: 'rotate(0deg)' },
        { duration: 300, opacity: 0.8, transform: 'rotate(-10deg)' },
        { duration: 300, opacity: 0.6, transform: 'rotate(0deg)' },
        { duration: 300, opacity: 0.4, transform: 'rotate(10deg)' },
        { duration: 300, opacity: 0.2, transform: 'rotate(0deg)' }
      ]
    });

    // Status transition animations
    this.animations.set('status-transition', {
      name: 'status-transition',
      frames: [
        { duration: 100, scale: 1, opacity: 1 },
        { duration: 100, scale: 1.2, opacity: 0.8 },
        { duration: 100, scale: 1, opacity: 1 }
      ]
    });
  }

  playAnimation(element: HTMLElement, animationName: string, id: string) {
    const animation = this.animations.get(animationName);
    if (!animation) return;

    // Stop any existing animation for this element
    this.stopAnimation(id);

    this.activeAnimations.set(id, {
      sequence: animation,
      currentFrame: 0,
      startTime: Date.now(),
      element
    });

    this.animate(id);
  }

  stopAnimation(id: string) {
    this.activeAnimations.delete(id);
  }

  private animate(id: string): void {
    const animation = this.activeAnimations.get(id);
    if (!animation) return;

    const { sequence, currentFrame, startTime, element } = animation;
    const currentTime = Date.now();
    const elapsedTime = currentTime - startTime;

    // Calculate which frame we should be on
    let frameIndex = currentFrame;
    let frameStartTime = 0;
    for (let i = 0; i < currentFrame; i++) {
      frameStartTime += sequence.frames[i].duration;
    }

    while (elapsedTime > frameStartTime + sequence.frames[frameIndex].duration) {
      frameStartTime += sequence.frames[frameIndex].duration;
      frameIndex++;
      if (frameIndex >= sequence.frames.length) {
        if (sequence.loop) {
          frameIndex = 0;
          this.activeAnimations.set(id, {
            ...animation,
            currentFrame: 0,
            startTime: currentTime
          });
          return this.animate(id);
        } else {
          this.stopAnimation(id);
          return;
        }
      }
    }

    // Apply the current frame
    const currentFrameData = sequence.frames[frameIndex];
    if (currentFrameData.transform) {
      element.style.transform = currentFrameData.transform;
    }
    if (currentFrameData.opacity !== undefined) {
      element.style.opacity = currentFrameData.opacity.toString();
    }
    if (currentFrameData.scale) {
      element.style.transform = `${element.style.transform} scale(${currentFrameData.scale})`;
    }
    if (currentFrameData.color) {
      element.style.color = currentFrameData.color;
    }

    // Update the current frame
    this.activeAnimations.set(id, {
      ...animation,
      currentFrame: frameIndex
    });

    // Continue the animation
    requestAnimationFrame(() => this.animate(id));
  }

  // Get animation based on agent status
  getAnimationForStatus(status: string): string {
    const statusAnimations = {
      idle: 'agent-idle',
      running: 'agent-running',
      busy: 'agent-busy',
      error: 'agent-error'
    };
    return statusAnimations[status as keyof typeof statusAnimations] || 'agent-idle';
  }

  // Get victory/defeat animation
  getOutcomeAnimation(outcome: 'victory' | 'defeat'): string {
    return outcome === 'victory' ? 'agent-victory' : 'agent-defeat';
  }
}

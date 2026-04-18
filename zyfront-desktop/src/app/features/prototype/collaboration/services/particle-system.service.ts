import { Injectable } from '@angular/core';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  opacity: number;
  type: 'explosion' | 'beam' | 'score' | 'spark';
}

interface ParticleEffect {
  id: string;
  particles: Particle[];
  active: boolean;
  x: number;
  y: number;
  duration: number;
  startTime: number;
  type?: 'explosion' | 'beam' | 'score' | 'spark';
  score?: number;
}

@Injectable({ providedIn: 'root' })
export class ParticleSystemService {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private effects: Map<string, ParticleEffect> = new Map();
  private animationId: number | null = null;
  private particlePool: Particle[] = [];
  private maxPoolSize = 500; // 减少最大粒子池大小

  initialize(container: HTMLElement) {
    // Create canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    container.appendChild(this.canvas);

    // Get canvas context
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) {
      console.error('Failed to get canvas context');
      return;
    }

    // Pre-populate particle pool
    this.initializeParticlePool();

    // Start animation loop
    this.animate();
  }

  private initializeParticlePool() {
    for (let i = 0; i < this.maxPoolSize; i++) {
      this.particlePool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0,
        size: 0,
        color: '#ffffff',
        opacity: 0,
        type: 'spark'
      });
    }
  }

  private getParticle(): Particle {
    if (this.particlePool.length > 0) {
      return this.particlePool.pop()!;
    }
    // If pool is empty, create a new particle
    return {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0,
      size: 0,
      color: '#ffffff',
      opacity: 0,
      type: 'spark'
    };
  }

  private releaseParticle(particle: Particle) {
    if (this.particlePool.length < this.maxPoolSize) {
      // Reset particle properties
      particle.x = 0;
      particle.y = 0;
      particle.vx = 0;
      particle.vy = 0;
      particle.life = 0;
      particle.maxLife = 0;
      particle.size = 0;
      particle.opacity = 0;
      this.particlePool.push(particle);
    }
  }

  private resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;
  }

  createExplosion(x: number, y: number, color: string = '#ff4444') {
    const id = `explosion-${Date.now()}`;
    const particles: Particle[] = [];
    
    // Create explosion particles
    for (let i = 0; i < 20; i++) {
      const angle = (Math.PI * 2 * i) / 20;
      const speed = Math.random() * 3 + 1;
      
      const particle = this.getParticle();
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.life = 1;
      particle.maxLife = Math.random() * 1 + 0.5;
      particle.size = Math.random() * 3 + 2;
      particle.color = color;
      particle.opacity = 1;
      particle.type = 'explosion';
      
      particles.push(particle);
    }

    this.effects.set(id, {
      id,
      particles,
      active: true,
      x,
      y,
      duration: 1.5,
      startTime: Date.now(),
      type: 'explosion'
    });

    return id;
  }

  createBeam(fromX: number, fromY: number, toX: number, toY: number, color: string = '#00ff00') {
    const id = `beam-${Date.now()}`;
    const particles: Particle[] = [];
    
    // Create beam particles
    const distance = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
    const steps = Math.floor(distance / 5);
    const dx = (toX - fromX) / steps;
    const dy = (toY - fromY) / steps;
    
    for (let i = 0; i < steps; i++) {
      const particle = this.getParticle();
      particle.x = fromX + dx * i;
      particle.y = fromY + dy * i;
      particle.vx = dx * 0.1;
      particle.vy = dy * 0.1;
      particle.life = 1;
      particle.maxLife = 0.5;
      particle.size = Math.random() * 2 + 1;
      particle.color = color;
      particle.opacity = Math.random() * 0.8 + 0.2;
      particle.type = 'beam';
      
      particles.push(particle);
    }

    this.effects.set(id, {
      id,
      particles,
      active: true,
      x: fromX,
      y: fromY,
      duration: 0.5,
      startTime: Date.now(),
      type: 'beam'
    });

    return id;
  }

  createScore(x: number, y: number, score: number, color: string = '#ffdd00') {
    const id = `score-${Date.now()}`;
    const particles: Particle[] = [];
    
    // Create score particles (text-based)
    const particle = this.getParticle();
    particle.x = x;
    particle.y = y;
    particle.vx = 0;
    particle.vy = -2;
    particle.life = 1;
    particle.maxLife = 1.5;
    particle.size = 16;
    particle.color = color;
    particle.opacity = 1;
    particle.type = 'score';
    
    particles.push(particle);

    this.effects.set(id, {
      id,
      particles,
      active: true,
      x,
      y,
      duration: 1.5,
      startTime: Date.now(),
      type: 'score',
      score
    });

    return id;
  }

  createSpark(x: number, y: number, color: string = '#4488ff') {
    const id = `spark-${Date.now()}`;
    const particles: Particle[] = [];
    
    // Create spark particles
    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 * i) / 5;
      const speed = Math.random() * 2 + 0.5;
      
      const particle = this.getParticle();
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.life = 1;
      particle.maxLife = Math.random() * 0.8 + 0.2;
      particle.size = Math.random() * 2 + 1;
      particle.color = color;
      particle.opacity = 1;
      particle.type = 'spark';
      
      particles.push(particle);
    }

    this.effects.set(id, {
      id,
      particles,
      active: true,
      x,
      y,
      duration: 1,
      startTime: Date.now(),
      type: 'spark'
    });

    return id;
  }

  private animate() {
    if (!this.ctx || !this.canvas) return;

    // Resize canvas if needed
    this.resizeCanvas();

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Update and render particles
    const now = Date.now();
    const effectsToRemove: string[] = [];

    this.effects.forEach((effect, id) => {
      if (!effect.active) return;

      // Check if effect has ended
      if (now - effect.startTime > effect.duration * 1000) {
        effectsToRemove.push(id);
        return;
      }

      // Update particles
      effect.particles.forEach(particle => {
        // Update position
        particle.x += particle.vx;
        particle.y += particle.vy;

        // Update life
        particle.life -= 1 / (particle.maxLife * 60);
        if (particle.life <= 0) {
          particle.life = 0;
          particle.opacity = 0;
        } else {
          particle.opacity = particle.life;
        }

        // Apply gravity for explosion particles
        if (particle.type === 'explosion') {
          particle.vy += 0.1;
        }

        // Render particle
        this.renderParticle(particle);
      });

      // Remove dead particles and release them back to the pool
      const activeParticles: Particle[] = [];
      effect.particles.forEach(particle => {
        if (particle.life > 0) {
          activeParticles.push(particle);
        } else {
          this.releaseParticle(particle);
        }
      });
      effect.particles = activeParticles;

      // Render score text
      if (effect.type === 'score' && effect.score !== undefined) {
        this.renderScore(effect as ParticleEffect & { score: number });
      }
    });

    // Remove ended effects
    effectsToRemove.forEach(id => this.effects.delete(id));

    // Continue animation loop
    this.animationId = requestAnimationFrame(() => this.animate());
  }

  private renderParticle(particle: Particle) {
    if (!this.ctx) return;

    this.ctx.save();
    this.ctx.globalAlpha = particle.opacity;
    this.ctx.fillStyle = particle.color;

    if (particle.type === 'beam') {
      // Render beam particles as lines
      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      // Render other particles as circles
      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private renderScore(effect: ParticleEffect & { score: number }) {
    if (!this.ctx) return;

    const particle = effect.particles[0];
    if (!particle) return;

    this.ctx.save();
    this.ctx.globalAlpha = particle.opacity;
    this.ctx.fillStyle = particle.color;
    this.ctx.font = `${particle.size}px 'Press Start 2P', cursive`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.shadowColor = particle.color;
    this.ctx.shadowBlur = 8;
    this.ctx.fillText(`+${effect.score}`, particle.x, particle.y);
    this.ctx.restore();
  }

  clearEffects() {
    // Release all particles back to the pool
    this.effects.forEach(effect => {
      effect.particles.forEach(particle => {
        this.releaseParticle(particle);
      });
    });
    this.effects.clear();
  }

  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.clearEffects();
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
  }
}

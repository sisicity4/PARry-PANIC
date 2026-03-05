import Phaser from "phaser";
import {
  BASE_PARRY_WINDOW_MS,
  EXHAUSTED_PARRY_WINDOW_MS,
  EXHAUSTED_THRESHOLD,
  FIXED_STEP_MS,
  FIXED_STEP_SECONDS,
  GAME_HEIGHT,
  PLAYER_BASE_SPEED,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_STAMINA,
  PARRY_STAMINA_COST,
  SHOUT_STAMINA_COST,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../config";
import type { AudioFeatureTick } from "../audio/types";
import { MODIFIER_TYPES, type ModifierType } from "../combat/types";
import { ModifierSystem } from "../combat/ModifierSystem";
import { Random } from "../core/Random";
import { runtime } from "../core/runtime";
import { SCENE_KEYS } from "./keys";
import type { ResultData } from "./ResultScene";

type EnemyType = "tank" | "rusher" | "sniper";

interface Enemy {
  id: number;
  type: EnemyType;
  sprite: Phaser.GameObjects.Arc;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  attackDamage: number;
  attackRange: number;
  cooldownSec: number;
  state: "idle" | "windup" | "recover";
  stateTimerSec: number;
  stunSec: number;
  hitFlashSec: number;
}

interface Projectile {
  id: number;
  sprite: Phaser.GameObjects.Arc;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  lifeSec: number;
}

interface ArenaObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
  rect: Phaser.GameObjects.Rectangle;
}

interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  health: number;
  stamina: number;
  maxHealth: number;
  maxStamina: number;
  invulnSec: number;
  shield: number;
  parryWindowSec: number;
  parryCooldownSec: number;
  counterWindowSec: number;
  chargeStartAtSec: number | null;
  staminaRegenPerSec: number;
}

interface KeyMap {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  UP: Phaser.Input.Keyboard.Key;
  LEFT: Phaser.Input.Keyboard.Key;
  DOWN: Phaser.Input.Keyboard.Key;
  RIGHT: Phaser.Input.Keyboard.Key;
  SHIFT: Phaser.Input.Keyboard.Key;
  SPACE: Phaser.Input.Keyboard.Key;
  F: Phaser.Input.Keyboard.Key;
}

interface GameSceneData {
  runSeed?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const ENEMY_COLORS: Record<EnemyType, number> = {
  tank: 0x6b4b9a,
  rusher: 0xff6f8d,
  sniper: 0xffbf57,
};

export class GameScene extends Phaser.Scene {
  private runSeed = 0;
  private random = new Random(1);

  private accumulatorMs = 0;
  private simulationTimeSec = 0;
  private survivalTimeSec = 0;

  private player!: Player;
  private playerBody!: Phaser.GameObjects.Arc;
  private playerFacingLine!: Phaser.GameObjects.Line;

  private keys!: KeyMap;
  private shoutGateOpen = false;

  private enemies: Enemy[] = [];
  private enemyIdCounter = 0;

  private projectiles: Projectile[] = [];
  private projectileIdCounter = 0;

  private obstacles: ArenaObstacle[] = [];

  private modifiers = new ModifierSystem();

  private spawnIntensity = 0.4;
  private enemySpeedMultiplier = 1;
  private aggression = 0.5;
  private spawnAccumulator = 0;
  private obstacleTargetCount = 2;

  private hitstopSec = 0;
  private worldFreezeSec = 0;

  private score = 0;
  private parryCount = 0;
  private crowdMeter = 0;

  private runWon = false;
  private runEnded = false;

  private uiGraphics!: Phaser.GameObjects.Graphics;
  private debugText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private micText!: Phaser.GameObjects.Text;
  private pulseRing!: Phaser.GameObjects.Arc;

  private audioLast: AudioFeatureTick = {
    timestampMs: 0,
    trackTimeSec: 0,
    beatCount: 0,
    subdivisionCount: 0,
    bpm: 120,
    bpmNorm: 0.38,
    spectralCentroid: 0.5,
    bassEnergy: 0.5,
    rms: 0,
  };

  private unsubscribers: Array<() => void> = [];

  constructor() {
    super(SCENE_KEYS.GAME);
  }

  create(data: GameSceneData): void {
    this.runSeed = (data.runSeed ?? Date.now()) >>> 0;
    this.random = new Random(this.runSeed);

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.drawBackdrop();

    this.player = this.createInitialPlayer();
    this.playerBody = this.add.circle(this.player.x, this.player.y, 22, 0x7df6ff, 1).setDepth(15);
    this.playerFacingLine = this.add
      .line(this.player.x, this.player.y, 0, 0, 36, 0, 0xffffff, 0.95)
      .setLineWidth(4)
      .setDepth(16);
    this.pulseRing = this.add.circle(this.player.x, this.player.y, 28, 0x9dfcff, 0.15).setDepth(14);

    this.cameras.main.startFollow(this.playerBody, true, 0.14, 0.14);
    this.cameras.main.setZoom(1.02);

    this.keys = this.input.keyboard?.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT,SHIFT,SPACE,F") as unknown as KeyMap;

    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0) {
        this.beginChargeAttack();
      } else if (pointer.button === 2) {
        this.tryParry();
      }
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0) {
        this.releaseChargeAttack();
      }
    });

    this.uiGraphics = this.add.graphics().setScrollFactor(0).setDepth(1000);

    this.statusText = this.add
      .text(18, 90, "", {
        fontFamily: "'Noto Sans JP', sans-serif",
        fontSize: "16px",
        color: "#e9f0ff",
      })
      .setScrollFactor(0)
      .setDepth(1001);

    this.micText = this.add
      .text(18, 154, "", {
        fontFamily: "'Noto Sans JP', sans-serif",
        fontSize: "14px",
        color: "#c8f2ff",
      })
      .setScrollFactor(0)
      .setDepth(1001);

    this.debugText = this.add
      .text(18, GAME_HEIGHT - 170, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#d6e6ff",
        lineSpacing: 4,
      })
      .setScrollFactor(0)
      .setDepth(1001);

    this.spawnInitialEnemies();
    this.syncObstacleDensity();

    this.unsubscribers.push(
      runtime.audio.on("featureTick", (tick) => {
        this.onFeatureTick(tick);
      }),
    );

    this.unsubscribers.push(
      runtime.audio.on("beat", () => {
        this.modifiers.onBeat();
        if (this.modifiers.has("BeatShield")) {
          this.player.shield = Math.min(2, this.player.shield + 1);
        }
        this.pulseRing.setAlpha(0.3);
      }),
    );

    this.unsubscribers.push(
      runtime.audio.on("shout", () => {
        this.handleShout();
      }),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.teardown();
    });

    window.render_game_to_text = () => this.renderGameToText();
    window.advanceTime = (ms: number) => this.advanceTime(ms);
  }

  update(_time: number, deltaMs: number): void {
    if (this.runEnded) {
      return;
    }

    this.accumulatorMs += deltaMs;

    while (this.accumulatorMs >= FIXED_STEP_MS) {
      this.fixedUpdate(FIXED_STEP_SECONDS);
      this.accumulatorMs -= FIXED_STEP_MS;
    }

    this.updateVisualObjects();
    this.drawHud();
    this.updateDebugOverlay();
  }

  private fixedUpdate(dt: number): void {
    runtime.audio.update();

    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) {
      this.toggleFullscreen();
    }

    if (this.keys.SPACE.isDown !== this.shoutGateOpen) {
      this.shoutGateOpen = this.keys.SPACE.isDown;
      runtime.audio.setShoutGate(this.shoutGateOpen);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.SHIFT)) {
      this.tryParry();
    }

    this.simulationTimeSec += dt;
    this.survivalTimeSec += dt;

    if (this.hitstopSec > 0) {
      this.hitstopSec = Math.max(0, this.hitstopSec - dt);
    }

    if (this.worldFreezeSec > 0) {
      this.worldFreezeSec = Math.max(0, this.worldFreezeSec - dt);
    }

    this.player.parryCooldownSec = Math.max(0, this.player.parryCooldownSec - dt);
    this.player.parryWindowSec = Math.max(0, this.player.parryWindowSec - dt);
    this.player.invulnSec = Math.max(0, this.player.invulnSec - dt);
    this.player.counterWindowSec = Math.max(0, this.player.counterWindowSec - dt);

    const staminaRegen = this.player.staminaRegenPerSec * dt;
    this.player.stamina = clamp(this.player.stamina + staminaRegen, 0, this.player.maxStamina);

    this.updateFacingFromMouse();

    const worldStep = this.hitstopSec > 0 ? 0 : dt * this.modifiers.getTimeScale();

    this.updatePlayerMovement(worldStep);
    this.resolvePlayerObstacleCollisions();

    this.updateEnemySpawning(worldStep);
    this.updateEnemies(worldStep);
    this.updateProjectiles(worldStep);

    this.cleanupDeadObjects();

    this.crowdMeter = clamp(this.crowdMeter + (this.audioLast.bassEnergy * 0.25 + this.parryCount * 0.005 - 0.06) * dt, 0, 1);

    if (this.player.health <= 0) {
      this.finishRun(false);
      return;
    }

    if (this.audioLast.beatCount >= 192) {
      this.finishRun(true);
    }
  }

  private drawBackdrop(): void {
    const gradient = this.add.graphics();
    gradient.fillGradientStyle(0x080d20, 0x121a3f, 0x0e1020, 0x190f2e, 1, 1, 1, 1);
    gradient.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    for (let index = 0; index < 180; index += 1) {
      const x = this.random.float(0, WORLD_WIDTH);
      const y = this.random.float(0, WORLD_HEIGHT);
      const radius = this.random.float(1, 3);
      const alpha = this.random.float(0.05, 0.25);
      this.add.circle(x, y, radius, 0x75a1ff, alpha);
    }

    const border = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH - 20, WORLD_HEIGHT - 20);
    border.setStrokeStyle(8, 0x1f356d, 0.9);
  }

  private createInitialPlayer(): Player {
    const meta = runtime.meta.snapshot;
    const staminaBonus = meta.staminaLevel > 0 ? 18 : 0;

    return {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
      vx: 0,
      vy: 0,
      heading: 0,
      health: PLAYER_MAX_HEALTH,
      stamina: PLAYER_MAX_STAMINA + staminaBonus,
      maxHealth: PLAYER_MAX_HEALTH,
      maxStamina: PLAYER_MAX_STAMINA + staminaBonus,
      invulnSec: 0,
      shield: 0,
      parryWindowSec: 0,
      parryCooldownSec: 0,
      counterWindowSec: 0,
      chargeStartAtSec: null,
      staminaRegenPerSec: 20 + meta.staminaLevel * 4,
    };
  }

  private spawnInitialEnemies(): void {
    for (let index = 0; index < 4; index += 1) {
      this.spawnEnemy();
    }
  }

  private updateFacingFromMouse(): void {
    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

    this.player.heading = Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y);
  }

  private updatePlayerMovement(dt: number): void {
    const moveX =
      (this.keys.D.isDown || this.keys.RIGHT.isDown ? 1 : 0) -
      (this.keys.A.isDown || this.keys.LEFT.isDown ? 1 : 0);
    const moveY =
      (this.keys.S.isDown || this.keys.DOWN.isDown ? 1 : 0) -
      (this.keys.W.isDown || this.keys.UP.isDown ? 1 : 0);
    const movement = new Phaser.Math.Vector2(moveX, moveY);

    if (movement.lengthSq() > 1) {
      movement.normalize();
    }

    const slowdown = this.player.chargeStartAtSec !== null ? 0.72 : 1;
    const speed = PLAYER_BASE_SPEED * slowdown;

    this.player.vx = movement.x * speed;
    this.player.vy = movement.y * speed;

    this.player.x = clamp(this.player.x + this.player.vx * dt, 30, WORLD_WIDTH - 30);
    this.player.y = clamp(this.player.y + this.player.vy * dt, 30, WORLD_HEIGHT - 30);
  }

  private updateEnemySpawning(dt: number): void {
    if (dt <= 0) {
      return;
    }

    this.spawnAccumulator += dt * this.spawnIntensity;

    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      if (this.enemies.length < 26) {
        this.spawnEnemy();
      }
    }
  }

  private spawnEnemy(): void {
    const enemyType = this.random.pickWeighted<EnemyType>([
      { item: "tank", weight: 0.35 + this.audioLast.bassEnergy * 1.0 },
      { item: "rusher", weight: 0.35 + this.audioLast.bpmNorm * 1.0 },
      { item: "sniper", weight: 0.3 + this.audioLast.spectralCentroid * 1.0 },
    ]);

    const spawnPoint = this.pickSpawnPoint();

    let hp = 46;
    let speed = 95;
    let radius = 16;
    let attackRange = 68;
    let attackDamage = 10;

    if (enemyType === "tank") {
      hp = 95;
      speed = 70;
      radius = 20;
      attackRange = 76;
      attackDamage = 14;
    } else if (enemyType === "rusher") {
      hp = 42;
      speed = 150;
      radius = 15;
      attackRange = 74;
      attackDamage = 9;
    } else if (enemyType === "sniper") {
      hp = 30;
      speed = 88;
      radius = 14;
      attackRange = 270;
      attackDamage = 12;
    }

    const sprite = this.add.circle(spawnPoint.x, spawnPoint.y, radius, ENEMY_COLORS[enemyType], 0.95).setDepth(12);

    this.enemies.push({
      id: this.enemyIdCounter++,
      type: enemyType,
      sprite,
      hp,
      maxHp: hp,
      speed,
      radius,
      attackDamage,
      attackRange,
      cooldownSec: this.random.float(0.25, 0.9),
      state: "idle",
      stateTimerSec: 0,
      stunSec: 0,
      hitFlashSec: 0,
    });
  }

  private pickSpawnPoint(): Phaser.Math.Vector2 {
    const angle = this.random.float(0, Math.PI * 2);
    const distance = this.random.float(260, 460);
    const x = clamp(this.player.x + Math.cos(angle) * distance, 40, WORLD_WIDTH - 40);
    const y = clamp(this.player.y + Math.sin(angle) * distance, 40, WORLD_HEIGHT - 40);
    return new Phaser.Math.Vector2(x, y);
  }

  private updateEnemies(dt: number): void {
    const shouldFreezeEnemies = this.worldFreezeSec > 0;

    for (const enemy of this.enemies) {
      enemy.hitFlashSec = Math.max(0, enemy.hitFlashSec - dt);

      if (enemy.hitFlashSec > 0) {
        enemy.sprite.setFillStyle(0xffffff, 1);
      } else {
        enemy.sprite.setFillStyle(ENEMY_COLORS[enemy.type], 0.95);
      }

      if (enemy.stunSec > 0) {
        enemy.stunSec = Math.max(0, enemy.stunSec - dt);
        enemy.state = "recover";
        enemy.stateTimerSec = Math.max(enemy.stateTimerSec, 0.2);
        enemy.sprite.setFillStyle(0x9fe2ff, 0.95);
        continue;
      }

      if (shouldFreezeEnemies || dt <= 0) {
        continue;
      }

      const dx = this.player.x - enemy.sprite.x;
      const dy = this.player.y - enemy.sprite.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const dirX = dx / dist;
      const dirY = dy / dist;

      const speed = enemy.speed * this.enemySpeedMultiplier;

      if (enemy.state === "idle") {
        enemy.cooldownSec = Math.max(0, enemy.cooldownSec - dt);

        if (enemy.type === "sniper") {
          const preferred = 220;
          const moveFactor = dist < preferred ? -0.75 : dist > preferred + 70 ? 0.65 : 0;
          enemy.sprite.x = clamp(enemy.sprite.x + dirX * speed * moveFactor * dt, 24, WORLD_WIDTH - 24);
          enemy.sprite.y = clamp(enemy.sprite.y + dirY * speed * moveFactor * dt, 24, WORLD_HEIGHT - 24);
        } else {
          const targetDistance = enemy.attackRange * 0.85;
          if (dist > targetDistance) {
            enemy.sprite.x = clamp(enemy.sprite.x + dirX * speed * dt, 24, WORLD_WIDTH - 24);
            enemy.sprite.y = clamp(enemy.sprite.y + dirY * speed * dt, 24, WORLD_HEIGHT - 24);
          }
        }

        if (enemy.cooldownSec <= 0 && dist <= enemy.attackRange + 30) {
          enemy.state = "windup";
          enemy.stateTimerSec = this.getSnappedWindup(0.2 + (1 - this.aggression) * 0.2);
        }
      } else if (enemy.state === "windup") {
        enemy.stateTimerSec -= dt;
        enemy.sprite.setStrokeStyle(3, 0xffffff, 0.9);

        if (enemy.stateTimerSec <= 0) {
          enemy.sprite.setStrokeStyle();
          this.resolveEnemyAttack(enemy, dirX, dirY, dist);
          enemy.state = "recover";
          enemy.stateTimerSec = 0.2 + (1 - this.aggression) * 0.25;
        }
      } else {
        enemy.stateTimerSec -= dt;
        if (enemy.stateTimerSec <= 0) {
          enemy.state = "idle";
          enemy.cooldownSec = this.random.float(0.4, 0.9);
        }
      }
    }
  }

  private resolveEnemyAttack(enemy: Enemy, dirX: number, dirY: number, dist: number): void {
    if (enemy.type === "sniper") {
      const speed = 420;
      const projectile = this.add.circle(enemy.sprite.x, enemy.sprite.y, 7, 0xfff0ad, 1).setDepth(13);
      this.projectiles.push({
        id: this.projectileIdCounter++,
        sprite: projectile,
        x: enemy.sprite.x,
        y: enemy.sprite.y,
        vx: dirX * speed,
        vy: dirY * speed,
        radius: 7,
        damage: enemy.attackDamage,
        lifeSec: 2,
      });
      return;
    }

    if (dist > enemy.attackRange + 18) {
      return;
    }

    if (this.tryResolveParry(enemy.sprite.x, enemy.sprite.y, enemy.radius + 18)) {
      enemy.stunSec = 0.85;
      return;
    }

    this.damagePlayer(enemy.attackDamage, dirX, dirY);
  }

  private updateProjectiles(dt: number): void {
    if (dt <= 0 || this.worldFreezeSec > 0) {
      return;
    }

    for (const projectile of this.projectiles) {
      projectile.lifeSec -= dt;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;

      projectile.sprite.setPosition(projectile.x, projectile.y);

      if (
        projectile.x < 0 ||
        projectile.y < 0 ||
        projectile.x > WORLD_WIDTH ||
        projectile.y > WORLD_HEIGHT
      ) {
        projectile.lifeSec = 0;
      }

      const dx = projectile.x - this.player.x;
      const dy = projectile.y - this.player.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= projectile.radius + 24) {
        if (this.tryResolveParry(projectile.x, projectile.y, projectile.radius + 14)) {
          projectile.lifeSec = 0;
        } else {
          const hitDirX = dist > 1e-5 ? dx / dist : 1;
          const hitDirY = dist > 1e-5 ? dy / dist : 0;
          this.damagePlayer(projectile.damage, hitDirX, hitDirY);
          projectile.lifeSec = 0;
        }
      }
    }
  }

  private tryResolveParry(sourceX: number, sourceY: number, range: number): boolean {
    if (this.player.parryWindowSec <= 0) {
      return false;
    }

    const dx = sourceX - this.player.x;
    const dy = sourceY - this.player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range + 22) {
      return false;
    }

    const incomingAngle = Math.atan2(dy, dx);
    const facingDelta = Math.abs(Phaser.Math.Angle.Wrap(incomingAngle - this.player.heading));
    if (facingDelta > Phaser.Math.DEG_TO_RAD * 75) {
      return false;
    }

    this.handleParrySuccess(sourceX, sourceY);
    return true;
  }

  private handleParrySuccess(sourceX: number, sourceY: number): void {
    this.parryCount += 1;
    this.player.invulnSec = Math.max(this.player.invulnSec, 0.28);
    this.player.counterWindowSec = 0.85;
    this.player.parryWindowSec = 0;
    this.hitstopSec = 0.06;

    const chosen = this.pickModifier();
    this.modifiers.apply(chosen, 8);

    for (const enemy of this.enemies) {
      const dx = enemy.sprite.x - sourceX;
      const dy = enemy.sprite.y - sourceY;
      const dist = Math.hypot(dx, dy);
      if (dist < 150) {
        enemy.stunSec = Math.max(enemy.stunSec, 0.7);
      }
    }

    this.cameras.main.flash(120, 165, 245, 255, true);
    this.cameras.main.shake(90, 0.002);
    this.score += 8;
  }

  private pickModifier(): ModifierType {
    const unlockedSlots = runtime.meta.snapshot.modifierSlots;
    const pool = MODIFIER_TYPES.slice(0, clamp(unlockedSlots + 2, 2, MODIFIER_TYPES.length));
    const index = this.random.int(0, pool.length - 1);
    return pool[index];
  }

  private tryParry(): void {
    if (this.player.parryCooldownSec > 0) {
      return;
    }

    if (!this.spendStamina(PARRY_STAMINA_COST)) {
      return;
    }

    const windowMs = this.player.stamina <= EXHAUSTED_THRESHOLD ? EXHAUSTED_PARRY_WINDOW_MS : BASE_PARRY_WINDOW_MS;
    this.player.parryWindowSec = windowMs / 1000;
    this.player.parryCooldownSec = 0.26;
    this.playerBody.setFillStyle(0x95ffd8, 1);
  }

  private beginChargeAttack(): void {
    if (this.player.chargeStartAtSec !== null) {
      return;
    }

    this.player.chargeStartAtSec = this.simulationTimeSec;
  }

  private releaseChargeAttack(): void {
    if (this.player.chargeStartAtSec === null) {
      return;
    }

    const heldSec = Math.max(0, this.simulationTimeSec - this.player.chargeStartAtSec);
    this.player.chargeStartAtSec = null;

    const forcedCounter = this.player.counterWindowSec > 0;
    let chargeRatio = clamp(heldSec / 0.7, 0, 1);

    if (forcedCounter) {
      chargeRatio = 1;
      this.player.counterWindowSec = 0;
      this.player.invulnSec = Math.max(this.player.invulnSec, 0.25);
    }

    if (this.player.stamina < 6) {
      return;
    }

    const staminaCost = forcedCounter ? 0 : lerp(10, 24, chargeRatio);
    if (!this.spendStamina(staminaCost)) {
      return;
    }

    const beatDistance = runtime.audio.getDistanceToNearestBeatSec();
    const beatSynced = beatDistance <= 0.085;

    const damage = lerp(18, 48, chargeRatio) * (beatSynced ? 1.4 : 1);
    const range = lerp(88, 188, chargeRatio) * (beatSynced ? 1.1 : 1);
    const arc = Phaser.Math.DEG_TO_RAD * lerp(60, 88, chargeRatio);

    let hitCount = 0;

    for (const enemy of this.enemies) {
      const dx = enemy.sprite.x - this.player.x;
      const dy = enemy.sprite.y - this.player.y;
      const dist = Math.hypot(dx, dy);

      if (dist > range + enemy.radius) {
        continue;
      }

      const angleToEnemy = Math.atan2(dy, dx);
      const headingDelta = Math.abs(Phaser.Math.Angle.Wrap(angleToEnemy - this.player.heading));

      if (headingDelta > arc * 0.5) {
        continue;
      }

      enemy.hp -= damage;
      enemy.hitFlashSec = 0.08;
      enemy.stunSec = Math.max(enemy.stunSec, lerp(0.12, 0.38, chargeRatio));
      hitCount += 1;

      if (enemy.hp <= 0) {
        this.score += enemy.type === "tank" ? 11 : enemy.type === "rusher" ? 8 : 10;
      }
    }

    if (hitCount > 0) {
      this.hitstopSec = clamp(0.03 + chargeRatio * 0.06, 0.03, 0.09);
      this.cameras.main.shake(80 + chargeRatio * 140, 0.0015 + chargeRatio * 0.0028);
      this.score += hitCount;
    }

    if (forcedCounter) {
      this.cameras.main.flash(80, 255, 240, 180, true);
    }

    this.playerBody.setFillStyle(beatSynced ? 0xfff0b0 : 0x7df6ff, 1);
  }

  private handleShout(): void {
    if (!this.spendStamina(SHOUT_STAMINA_COST)) {
      return;
    }

    this.worldFreezeSec = 0.35;

    for (const enemy of this.enemies) {
      const dx = enemy.sprite.x - this.player.x;
      const dy = enemy.sprite.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 220) {
        enemy.stunSec = Math.max(enemy.stunSec, 0.9);
      }
    }

    this.cameras.main.flash(140, 255, 130, 130, true);
    this.cameras.main.shake(220, 0.004);
    this.score += 5;
  }

  private damagePlayer(amount: number, dirX: number, dirY: number): void {
    if (this.player.invulnSec > 0) {
      return;
    }

    if (this.player.shield > 0) {
      this.player.shield -= 1;
      this.player.invulnSec = 0.12;
      this.cameras.main.flash(70, 170, 240, 255, true);
      return;
    }

    this.player.health = Math.max(0, this.player.health - amount);
    this.player.invulnSec = 0.35;

    if (!this.modifiers.has("KnockbackNull")) {
      this.player.x = clamp(this.player.x - dirX * 20, 30, WORLD_WIDTH - 30);
      this.player.y = clamp(this.player.y - dirY * 20, 30, WORLD_HEIGHT - 30);
    }

    this.playerBody.setFillStyle(0xff7d9f, 1);
    this.cameras.main.shake(100, 0.003);
  }

  private spendStamina(cost: number): boolean {
    if (this.player.stamina < cost) {
      return false;
    }

    this.player.stamina -= cost;
    return true;
  }

  private onFeatureTick(tick: AudioFeatureTick): void {
    this.audioLast = tick;

    this.spawnIntensity = lerp(0.35, 2.2, Math.pow(tick.bassEnergy, 1.2));
    this.enemySpeedMultiplier = lerp(0.85, 1.45, tick.bpmNorm);
    this.aggression = tick.spectralCentroid;

    this.obstacleTargetCount = Math.round(lerp(2, 11, tick.bassEnergy));
    this.syncObstacleDensity();

    if (this.modifiers.has("LightFlickerBoost")) {
      const alpha = 0.18 + tick.spectralCentroid * 0.12;
      this.pulseRing.setAlpha(alpha);
    }
  }

  private getSnappedWindup(minDelay: number): number {
    const beatDuration = runtime.audio.getBeatDurationSeconds();
    const trackTime = runtime.audio.getTrackTimeSeconds();

    if (!Number.isFinite(beatDuration) || beatDuration <= 0) {
      return minDelay;
    }

    const target = trackTime + minDelay;
    const snapped = Math.ceil(target / beatDuration) * beatDuration;
    return Math.max(minDelay, snapped - trackTime);
  }

  private syncObstacleDensity(): void {
    while (this.obstacles.length < this.obstacleTargetCount) {
      this.createObstacle();
    }

    while (this.obstacles.length > this.obstacleTargetCount) {
      const obstacle = this.obstacles.pop();
      obstacle?.rect.destroy();
    }
  }

  private createObstacle(): void {
    const safeRadius = lerp(190, 300, 1 - this.audioLast.bassEnergy);

    let x = this.random.float(120, WORLD_WIDTH - 120);
    let y = this.random.float(120, WORLD_HEIGHT - 120);

    const attempts = 20;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const dx = x - this.player.x;
      const dy = y - this.player.y;
      if (Math.hypot(dx, dy) > safeRadius) {
        break;
      }

      x = this.random.float(120, WORLD_WIDTH - 120);
      y = this.random.float(120, WORLD_HEIGHT - 120);
    }

    const width = this.random.float(70, 170);
    const height = this.random.float(60, 150);

    const rect = this.add
      .rectangle(x, y, width, height, 0x2f355f, 0.82)
      .setStrokeStyle(2, 0x6f8bde, 0.5)
      .setDepth(8);

    this.obstacles.push({ x, y, width, height, rect });
  }

  private resolvePlayerObstacleCollisions(): void {
    const playerHalf = 22;

    for (const obstacle of this.obstacles) {
      const left = obstacle.x - obstacle.width * 0.5;
      const right = obstacle.x + obstacle.width * 0.5;
      const top = obstacle.y - obstacle.height * 0.5;
      const bottom = obstacle.y + obstacle.height * 0.5;

      if (
        this.player.x + playerHalf < left ||
        this.player.x - playerHalf > right ||
        this.player.y + playerHalf < top ||
        this.player.y - playerHalf > bottom
      ) {
        continue;
      }

      const overlapLeft = this.player.x + playerHalf - left;
      const overlapRight = right - (this.player.x - playerHalf);
      const overlapTop = this.player.y + playerHalf - top;
      const overlapBottom = bottom - (this.player.y - playerHalf);

      const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

      if (minOverlap === overlapLeft) {
        this.player.x -= overlapLeft;
      } else if (minOverlap === overlapRight) {
        this.player.x += overlapRight;
      } else if (minOverlap === overlapTop) {
        this.player.y -= overlapTop;
      } else {
        this.player.y += overlapBottom;
      }
    }
  }

  private cleanupDeadObjects(): void {
    this.enemies = this.enemies.filter((enemy) => {
      const alive = enemy.hp > 0;
      if (!alive) {
        enemy.sprite.destroy();
      }
      return alive;
    });

    this.projectiles = this.projectiles.filter((projectile) => {
      const alive = projectile.lifeSec > 0;
      if (!alive) {
        projectile.sprite.destroy();
      }
      return alive;
    });
  }

  private updateVisualObjects(): void {
    this.playerBody.setPosition(this.player.x, this.player.y);
    this.playerFacingLine.setPosition(this.player.x, this.player.y);
    this.playerFacingLine.setTo(0, 0, Math.cos(this.player.heading) * 36, Math.sin(this.player.heading) * 36);

    this.pulseRing.setPosition(this.player.x, this.player.y);
    this.pulseRing.radius = 28 + this.crowdMeter * 28;
    this.pulseRing.setStrokeStyle(2, 0x96d5ff, 0.3 + this.crowdMeter * 0.3);

    if (this.player.invulnSec > 0) {
      this.playerBody.setAlpha(0.65 + Math.sin(this.simulationTimeSec * 45) * 0.2);
    } else {
      this.playerBody.setAlpha(1);
      const fill = this.player.parryWindowSec > 0 ? 0x95ffd8 : 0x7df6ff;
      this.playerBody.setFillStyle(fill, 1);
    }

    for (const obstacle of this.obstacles) {
      if (this.modifiers.has("LightFlickerBoost")) {
        const flicker = 0.5 + this.audioLast.spectralCentroid * 0.35 + Math.sin(this.simulationTimeSec * 18) * 0.08;
        obstacle.rect.setAlpha(clamp(flicker, 0.2, 0.95));
      } else {
        obstacle.rect.setAlpha(0.82);
      }
    }
  }

  private drawHud(): void {
    const beatProgress = runtime.audio.getBeatProgress01();
    const modifierText = this.modifiers
      .listActive()
      .map((modifier) => `${modifier.type}(${modifier.remainingBeats})`)
      .join("  ");

    this.uiGraphics.clear();

    this.uiGraphics.fillStyle(0x090f20, 0.85);
    this.uiGraphics.fillRoundedRect(10, 10, 500, 70, 12);

    this.drawBar(22, 20, 190, 12, this.player.health / this.player.maxHealth, 0xff6d8b, 0x4d202d);
    this.drawBar(22, 42, 190, 12, this.player.stamina / this.player.maxStamina, 0x6df2ff, 0x1f3d47);
    this.drawBar(240, 20, 250, 10, beatProgress, 0xffdc78, 0x43361d);
    this.drawBar(240, 38, 250, 10, this.crowdMeter, 0xc786ff, 0x2e2040);

    this.statusText.setText([
      `HP ${this.player.health.toFixed(0)} / ${this.player.maxHealth}   ST ${this.player.stamina.toFixed(0)} / ${this.player.maxStamina}`,
      `Beat ${this.audioLast.beatCount}  Score ${Math.floor(this.score)}  Parries ${this.parryCount}`,
      modifierText.length > 0 ? `Modifiers: ${modifierText}` : "Modifiers: none",
    ]);

    const audioSnapshot = runtime.audio.getSnapshot();
    const micState = audioSnapshot.micState;
    this.micText.setText(`Mic: ${micState} / Gate: ${audioSnapshot.shoutGateOpen ? "OPEN" : "CLOSED"} / RMS ${audioSnapshot.rms.toFixed(3)}`);
  }

  private drawBar(
    x: number,
    y: number,
    width: number,
    height: number,
    ratio: number,
    fillColor: number,
    bgColor: number,
  ): void {
    const clamped = clamp(ratio, 0, 1);
    this.uiGraphics.fillStyle(bgColor, 0.9);
    this.uiGraphics.fillRoundedRect(x, y, width, height, 4);

    this.uiGraphics.fillStyle(fillColor, 1);
    this.uiGraphics.fillRoundedRect(x, y, width * clamped, height, 4);
  }

  private updateDebugOverlay(): void {
    const fps = this.game.loop.actualFps;
    const audio = runtime.audio.getSnapshot();

    this.debugText.setText([
      `[Debug] FPS ${fps.toFixed(1)} | Seed ${this.runSeed}`,
      `BPM ${audio.bpm.toFixed(1)} (norm ${audio.bpmNorm.toFixed(2)}) | beat ${audio.beatCount} / sub ${audio.subdivisionCount}`,
      `centroid ${audio.spectralCentroid.toFixed(2)} | bass ${audio.bassEnergy.toFixed(2)} | rms ${audio.rms.toFixed(3)}`,
      `spawnRate ${this.spawnIntensity.toFixed(2)} | enemySpeed x${this.enemySpeedMultiplier.toFixed(2)} | aggression ${this.aggression.toFixed(2)}`,
      `parryWindow ${Math.round(this.player.parryWindowSec * 1000)}ms | counter ${this.player.counterWindowSec.toFixed(2)}s | freeze ${this.worldFreezeSec.toFixed(2)}s`,
      `section(fallback): beat/64 => ${Math.floor(audio.beatCount / 64) + 1} / 3`,
    ]);
  }

  private finishRun(won: boolean): void {
    if (this.runEnded) {
      return;
    }

    this.runEnded = true;
    this.runWon = won;
    runtime.audio.setShoutGate(false);

    const resultData: ResultData = {
      won,
      score: Math.floor(this.score),
      parryCount: this.parryCount,
      runSeed: this.runSeed,
      survivedSeconds: this.survivalTimeSec,
    };

    this.time.delayedCall(700, () => {
      this.scene.start(SCENE_KEYS.RESULT, resultData);
    });
  }

  private toggleFullscreen(): void {
    if (this.scale.isFullscreen) {
      this.scale.stopFullscreen();
    } else {
      this.scale.startFullscreen();
    }
  }

  private advanceTime(ms: number): void {
    const safeMs = clamp(ms, 0, 3000);
    const steps = Math.max(1, Math.round(safeMs / FIXED_STEP_MS));
    for (let step = 0; step < steps; step += 1) {
      this.fixedUpdate(FIXED_STEP_SECONDS);
    }
    this.updateVisualObjects();
    this.drawHud();
    this.updateDebugOverlay();
  }

  private renderGameToText(): string {
    const payload = {
      mode: "gameplay",
      coordinates: {
        origin: "top-left",
        xAxis: "right-positive",
        yAxis: "down-positive",
      },
      player: {
        x: Number(this.player.x.toFixed(2)),
        y: Number(this.player.y.toFixed(2)),
        headingRad: Number(this.player.heading.toFixed(3)),
        hp: Number(this.player.health.toFixed(1)),
        stamina: Number(this.player.stamina.toFixed(1)),
        shield: this.player.shield,
        parryWindowMs: Math.round(this.player.parryWindowSec * 1000),
        counterWindowMs: Math.round(this.player.counterWindowSec * 1000),
      },
      enemies: this.enemies.map((enemy) => ({
        id: enemy.id,
        type: enemy.type,
        x: Number(enemy.sprite.x.toFixed(2)),
        y: Number(enemy.sprite.y.toFixed(2)),
        hp: Number(enemy.hp.toFixed(1)),
        state: enemy.state,
      })),
      projectiles: this.projectiles.map((projectile) => ({
        id: projectile.id,
        x: Number(projectile.x.toFixed(2)),
        y: Number(projectile.y.toFixed(2)),
        vx: Number(projectile.vx.toFixed(1)),
        vy: Number(projectile.vy.toFixed(1)),
      })),
      modifiers: this.modifiers.listActive(),
      score: Math.floor(this.score),
      crowd: Number(this.crowdMeter.toFixed(2)),
      audio: {
        bpm: Number(this.audioLast.bpm.toFixed(2)),
        beat: this.audioLast.beatCount,
        bass: Number(this.audioLast.bassEnergy.toFixed(2)),
        centroid: Number(this.audioLast.spectralCentroid.toFixed(2)),
      },
      run: {
        won: this.runWon,
        ended: this.runEnded,
        survivalSec: Number(this.survivalTimeSec.toFixed(2)),
      },
    };

    return JSON.stringify(payload);
  }

  private teardown(): void {
    runtime.audio.setShoutGate(false);

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    if (window.render_game_to_text) {
      delete window.render_game_to_text;
    }
    if (window.advanceTime) {
      delete window.advanceTime;
    }
  }
}

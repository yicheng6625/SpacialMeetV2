import * as Phaser from 'phaser';
import { AnimationManager, Direction } from './AnimationManager';

interface RemotePlayerState {
  targetX: number;
  targetY: number;
  direction: Direction;
  isMoving: boolean;
  lastUpdateTime: number;
}

export class PlayerManager {
  private scene: Phaser.Scene;
  private animationManager: AnimationManager;
  private players: Map<string, Phaser.GameObjects.Container> = new Map();
  private playerLabels: Map<string, Phaser.GameObjects.Text> = new Map();
  private playerStates: Map<string, RemotePlayerState> = new Map();
  private readonly LERP_SPEED = 1.0; // Snap to position for real-time movement
  private readonly IDLE_THRESHOLD = 0.5; // Pixels to consider stopped (tighter threshold)

  constructor(scene: Phaser.Scene, animationManager: AnimationManager) {
    this.scene = scene;
    this.animationManager = animationManager;
  }

  addPlayer(id: string, name: string, x: number, y: number, spriteKey: string = 'Adam') {
    if (this.players.has(id)) return;

    // Validate sprite key
    const validSprites = ['Adam', 'Alex', 'Amelia', 'Bob'];
    const safeSpriteKey = validSprites.includes(spriteKey) ? spriteKey : 'Adam';

    const container = this.scene.add.container(x, y);
    
    // Create sprite (start with idle)
    const sprite = this.scene.add.sprite(0, 0, `${safeSpriteKey}_idle`);
    sprite.setOrigin(0.5, 0.5);
    
    // Store sprite key for later use
    sprite.setData('spriteName', safeSpriteKey);
    
    sprite.setScale(2); // Match local player size
    
    // Play initial idle animation
    const animKey = this.animationManager.getAnimationKey(safeSpriteKey, 'idle', 'down');
    sprite.play(animKey);
    
    container.add(sprite);
    this.players.set(id, container);

    const label = this.scene.add.text(0, -25, name, {
      fontSize: "12px",
      color: "#000",
      backgroundColor: "#ffffff80"
    });
    label.setOrigin(0.5);
    container.add(label);
    this.playerLabels.set(id, label);

    // Set depth for all players to render above map layers but below OverPlayer_Layer
    container.setDepth(10000);

    // Initialize state for smooth interpolation
    this.playerStates.set(id, {
      targetX: x,
      targetY: y,
      direction: 'down',
      isMoving: false,
      lastUpdateTime: this.scene.time.now,
    });
  }

  updatePlayerPosition(id: string, x: number, y: number, direction: Direction) {
    const state = this.playerStates.get(id);
    if (!state) return;

    const container = this.players.get(id);
    if (!container) return;

    // Update target position and direction
    state.targetX = x;
    state.targetY = y;
    state.direction = direction;
    state.lastUpdateTime = this.scene.time.now;

    // Determine if player is moving (based on distance to target)
    const dx = x - container.x;
    const dy = y - container.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    state.isMoving = distance > this.IDLE_THRESHOLD;
  }

  update() {
    // Called every frame from GameScene.update()
    this.playerStates.forEach((state, id) => {
      const container = this.players.get(id);
      if (!container) return;

      const sprite = container.list[0] as Phaser.GameObjects.Sprite;
      const spriteName = sprite.getData('spriteName') || 'Adam';

      // Calculate distance to target
      const dx = state.targetX - container.x;
      const dy = state.targetY - container.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Smoothly interpolate toward target or snap if close
      if (distance > this.IDLE_THRESHOLD) {
        container.x += dx * this.LERP_SPEED;
        container.y += dy * this.LERP_SPEED;
        state.isMoving = true;
      } else {
        container.setPosition(state.targetX, state.targetY);
        state.isMoving = false;
      }

      // Update animation based on current movement state
      const animState = state.isMoving ? 'run' : 'idle';
      const animKey = this.animationManager.getAnimationKey(spriteName, animState, state.direction);
      
      if (sprite.anims.currentAnim?.key !== animKey) {
        sprite.play(animKey, true);
      }
    });
  }

  removePlayer(id: string) {
    const container = this.players.get(id);
    if (container) {
      container.destroy();
      this.players.delete(id);
    }
    const label = this.playerLabels.get(id);
    if (label) {
      this.playerLabels.delete(id);
    }
  }

  getPlayers(): Map<string, Phaser.GameObjects.Container> {
    return this.players;
  }

  getPlayerLabels(): Map<string, Phaser.GameObjects.Text> {
    return this.playerLabels;
  }

  destroy() {
    this.players.forEach(container => container.destroy());
    this.players.clear();
    this.playerLabels.clear();
  }
}
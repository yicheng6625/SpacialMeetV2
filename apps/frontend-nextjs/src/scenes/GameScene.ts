import * as Phaser from "phaser";
import { WebSocketManager, WebSocketMessage } from "../lib/WebSocketManager";
import { PlayerManager } from "../lib/PlayerManager";
import { ProximityManager } from "../lib/ProximityManager";
import { CallManager } from "../lib/CallManager";
import { AnimationManager, Direction } from "../lib/AnimationManager";
import { MovementManager } from "../lib/MovementManager";
import { MapManager } from "../lib/MapManager";
import { MessageHandler } from "../lib/MessageHandler";
import { VirtualJoystickManager } from "../lib/VirtualJoystickManager";
import { tileToPixel } from "../lib/types";

class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private wsManager!: WebSocketManager;
  private playerManager!: PlayerManager;
  private proximityManager!: ProximityManager;
  private callManager!: CallManager;
  private animationManager!: AnimationManager;
  private movementManager!: MovementManager;
  private mapManager!: MapManager;
  private messageHandler!: MessageHandler;
  private virtualJoystickManager?: VirtualJoystickManager;
  private playerId: string;
  private camera!: Phaser.Cameras.Scene2D.Camera;
  private sceneReady: boolean = false;
  private handleSendChatMessage?: EventListener;
  private handleInitiateCall?: EventListener;
  private handleStatusChange?: EventListener;

  constructor(
    private name: string,
    private roomId: string,
    private character: string,
    userId?: string | null,
  ) {
    super({ key: "GameScene" });
    this.playerId = userId || Phaser.Utils.String.UUID();
  }

  preload() {
    this.mapManager = new MapManager(this);
    this.mapManager.preload();

    this.animationManager = new AnimationManager(this);
    this.animationManager.preload();
  }

  create() {
    this.camera = this.cameras.main;

    this.animationManager.create();

    this.wsManager = new WebSocketManager(
      this.playerId,
      this.name,
      this.character,
    );
    this.playerManager = new PlayerManager(
      this,
      this.animationManager,
      this.playerId,
    );

    this.mapManager.create();
    const spawnTilePos = this.mapManager.getRandomSpawnPosition();
    // Convert tile spawn to pixel position for local player creation
    const spawnPixel = tileToPixel(spawnTilePos.tileX, spawnTilePos.tileY);

    // 強制依照頁面載入的協議決定 ws/wss，避免 HTTPS 頁面使用 ws:// 導致 Mixed Content 錯誤
    // 即使環境變數寫的是 ws://，也會自動升級為 wss://（反之亦然）
    const pageProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;

    let wsBaseUrl: string;
    const envWsUrl = process.env.NEXT_PUBLIC_WS_URL;

    if (envWsUrl && !envWsUrl.includes("localhost")) {
      // 使用環境變數的 host，但協議強制與頁面一致，防止 Mixed Content
      const envHost = envWsUrl.replace(/^wss?:\/\//, "");
      wsBaseUrl = `${pageProtocol}//${envHost}`;
    } else if (
      envWsUrl &&
      (host === "localhost" || host === "127.0.0.1")
    ) {
      // 本地開發：直接使用環境變數（含 localhost）
      wsBaseUrl = envWsUrl;
    } else {
      // Fallback：從 window.location 建構（本地開發未設環境變數時）
      wsBaseUrl = `${pageProtocol}//${host}:8080`;
    }

    const wsUrl = `${wsBaseUrl}/ws/${this.roomId}`;
    // Pass TILE coordinates to WebSocket
    this.wsManager.connect(wsUrl, spawnTilePos);

    // Create local player at PIXEL position (center of spawn tile)
    this.player = this.playerManager.createLocalPlayer(
      this.playerId,
      this.name,
      spawnPixel.x,
      spawnPixel.y,
      this.character,
    );

    const isMobile = !this.sys.game.device.os.desktop;
    this.movementManager = new MovementManager(
      this,
      this.player,
      this.animationManager,
      this.playerId,
      this.wsManager,
      isMobile,
    );

    this.sceneReady = true;

    this.callManager = new CallManager(this, this.wsManager, this.playerId);

    this.proximityManager = new ProximityManager(
      this,
      this.wsManager,
      this.playerManager,
      this.callManager,
      this.player,
      this.playerId,
    );

    this.mapManager.setupColliders(this.player);

    // Set up collision checking for movement
    this.movementManager.setCollisionChecker((x: number, y: number) => {
      return this.mapManager.checkCollisionAt(x, y);
    });

    // Local player uses tween-based movement, so no physics collision between players
    // Remote players still use physics for collision detection

    this.messageHandler = new MessageHandler(
      this,
      this.wsManager,
      this.playerManager,
      this.proximityManager,
      this.callManager,
      this.animationManager,
      this.playerId,
      this.player,
    );
    this.messageHandler.setSceneReady(true);
    this.wsManager.setOnMessage((msg: WebSocketMessage) => {
      this.messageHandler.handleMessage(msg);
    });

    // Set camera bounds
    this.cameras.main.setBounds(
      0,
      0,
      this.mapManager.getMapWidth(),
      this.mapManager.getMapHeight(),
    );
    this.cameras.main.startFollow(this.player);

    // Set physics world bounds
    this.physics.world.setBounds(
      0,
      0,
      this.mapManager.getMapWidth(),
      this.mapManager.getMapHeight(),
    );

    // Set camera zoom and deadzone for better view
    this.camera.setZoom(1.2);
    this.camera.setDeadzone(200, 150);

    if (isMobile) {
      this.virtualJoystickManager = new VirtualJoystickManager(this);
    }

    // Listen for chat messages from React
    this.handleSendChatMessage = ((event: CustomEvent) => {
      if (this.wsManager) {
        this.wsManager.send("chat", event.detail);
      }
    }) as EventListener;
    window.addEventListener("sendChatMessage", this.handleSendChatMessage);

    // Listen for call initiation from React
    this.handleInitiateCall = ((event: CustomEvent) => {
      const { playerId, type } = event.detail;
      if (this.proximityManager) {
        this.proximityManager.initiateCall(playerId, type);
      }
    }) as EventListener;
    window.addEventListener("initiateCall", this.handleInitiateCall);

    // Listen for status changes from React
    this.handleStatusChange = ((event: CustomEvent) => {
      const { status } = event.detail;
      if (this.wsManager) {
        this.wsManager.send("status_change", { status });
        // Update local player's status display
        if (this.playerManager) {
          this.playerManager.updatePlayerStatus(this.playerId, status);
        }
      }
    }) as EventListener;
    window.addEventListener("statusChange", this.handleStatusChange);
  }

  update(time: number, delta: number) {
    if (!this.player) return;

    // Update player name tag to follow smooth movement
    this.playerManager.updateLocalPlayerNameTag(this.player.x, this.player.y);

    // Handle joystick input for mobile
    if (this.virtualJoystickManager) {
      const velocity = this.virtualJoystickManager.getVelocity();
      this.movementManager.setJoystickVelocity(velocity.x, velocity.y);
    } else {
      this.movementManager.setJoystickVelocity(0, 0);
    }

    // Handle movement (throttled network sync is now internal)
    this.movementManager.update(delta);

    // Update proximity
    if (this.proximityManager) {
      this.proximityManager.update();
    }

    // Update remote player positions and animations
    if (this.playerManager) {
      this.playerManager.update();
    }
  }

  public cleanup() {
    if (this.handleSendChatMessage) {
      window.removeEventListener("sendChatMessage", this.handleSendChatMessage);
    }
    if (this.handleInitiateCall) {
      window.removeEventListener("initiateCall", this.handleInitiateCall);
    }
    if (this.handleStatusChange) {
      window.removeEventListener("statusChange", this.handleStatusChange);
    }
    this.wsManager.disconnect();
    this.playerManager.destroy();
    this.proximityManager.destroy();
    this.callManager.cleanup();
    if (this.virtualJoystickManager) {
      this.virtualJoystickManager.destroy();
    }
  }
}

export default GameScene;

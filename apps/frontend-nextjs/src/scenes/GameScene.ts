import * as Phaser from 'phaser';
import { WebSocketManager } from '../lib/WebSocketManager';
import { PlayerManager } from '../lib/PlayerManager';
import { ProximityManager } from '../lib/ProximityManager';
import { CallManager } from '../lib/CallManager';

class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: any;
  private wsManager!: WebSocketManager;
  private playerManager!: PlayerManager;
  private proximityManager!: ProximityManager;
  private callManager!: CallManager;
  private playerId: string;
  private camera!: Phaser.Cameras.Scene2D.Camera;
  private sceneReady: boolean = false;

  constructor(private name: string) {
    super({ key: "GameScene" });
    this.playerId = Phaser.Utils.String.UUID();
  }

  preload() {
    // Load Tiled map and tilesets
    this.load.tilemapTiledJSON("office", "/tilesets/office-map.tmj");
    this.load.image(
      "RoomBuilder",
      "/tilesets/textures/Room_Builder_Office_32x32.png"
    );
    this.load.image(
      "ModernOffice",
      "/tilesets/textures/Modern_Office_Black_Shadow_32x32.png"
    );

    // Add load error handling
    this.load.on("loaderror", (file: any) => {
      console.error("Failed to load file:", file.key, file.src);
    });
  }

  create() {
    this.camera = this.cameras.main;
    this.camera.setZoom(1);

    // Initialize managers
    this.wsManager = new WebSocketManager(this.playerId, this.name);
    this.playerManager = new PlayerManager(this);
    // ProximityManager will be initialized after player creation

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const wsUrl = `${protocol}//${host}:8080/ws`;
    this.wsManager.connect(wsUrl);

    // Set message handler
    this.wsManager.setOnMessage((msg: any) => {
      this.handleMessage(msg);
    });

    // Create Tiled map
    const map = this.make.tilemap({ key: "office" });
    const rb = map.addTilesetImage("Room_Builder_Office_32x32", "RoomBuilder");
    const mo = map.addTilesetImage(
      "Modern_Office_Black_Shadow_32x32",
      "ModernOffice"
    );

    if (!rb || !mo) {
      throw new Error("Tilesets not found");
    }

    map.createLayer("Ground", [rb, mo], 0, 0)!.setDepth(0);
    map.createLayer("Walls", [rb, mo], 0, 0)!.setDepth(10);
    map.createLayer("DesksBack", [rb, mo], 0, 0)!.setDepth(20);
    map.createLayer("DeskItems_Back", [rb, mo], 0, 0)!.setDepth(25);

    this.cursors = this.input.keyboard!.createCursorKeys();
    // Add WASD keys
    this.wasdKeys = this.input.keyboard!.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      D: Phaser.Input.Keyboard.KeyCodes.D,
    });

    this.sceneReady = true;

    // Create current player immediately
    this.createCurrentPlayer();

    // Initialize CallManager
    this.callManager = new CallManager(this, this.wsManager, this.playerId);

    // Initialize ProximityManager after player is created
    this.proximityManager = new ProximityManager(this, this.wsManager, this.playerManager, this.callManager, this.player, this.playerId);

    // Build colliders from object layer
    const collLayer = map.getObjectLayer("Colliders");
    const solids = this.physics.add.staticGroup();

    if (collLayer && collLayer.objects) {
      collLayer.objects.forEach((obj: any) => {
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;

        const rect = this.add.rectangle(
          cx,
          cy,
          obj.width || 1,
          obj.height || 1,
          0x000000,
          0
        );
        this.physics.add.existing(rect, true);
        const body = rect.body as Phaser.Physics.Arcade.StaticBody;
        body.setSize(obj.width, obj.height);
        solids.add(rect);
      });
    }

    // Add physics to player
    if (this.player) {
      const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
      playerBody.setSize(16, 12).setOffset(16, 30);
      playerBody.setCollideWorldBounds(true);
      this.physics.add.collider(this.player, solids);
    }

    // Set player depth
    if (this.player) {
      this.player.setDepth(10000);
    }

    // Create front layers
    map.createLayer("Dividers", [mo], 0, 0)!.setDepth(1000);
    map.createLayer("DesksFront", [mo], 0, 0)!.setDepth(1010);
    map.createLayer("DeskItems_Front", [mo], 0, 0)!.setDepth(1020);

    // Create over player layer
    map.createLayer("OverPlayer_Layer", [rb, mo], 0, 0)!.setDepth(20000);

    // Set camera bounds
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player);

    // Set physics world bounds
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
  }

  private createCurrentPlayer() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x00ff00, 1);
    graphics.fillCircle(24, 24, 12);
    graphics.generateTexture("playerAvatar", 48, 48);
    graphics.destroy();

    this.player = this.physics.add.sprite(
      5 * 32 + 16,
      5 * 32 + 16,
      "playerAvatar"
    );

    const label = this.add.text(this.player.x, this.player.y - 20, this.name, {
      fontSize: "12px",
      color: "#000",
    });
    label.setOrigin(0.5);
    this.playerManager.getPlayerLabels().set(this.playerId, label);
  }

  handleMessage(msg: any) {
    if (!this.sceneReady) return;

    switch (msg.type) {
      case "space-joined":
        this.handleSpaceJoined(msg.data);
        break;
      case "movement-rejected":
        this.handleMovementRejected(msg.data);
        break;
      case "movement":
        this.handleMovement(msg.data);
        break;
      case "user-left":
        this.handleUserLeft(msg.data);
        break;
      case "user-join":
        this.handleUserJoin(msg.data);
        break;
      case "incoming_call":
        this.callManager.handleIncomingCall(msg.data);
        break;
      case "call_response":
        this.callManager.handleCallResponse(msg.data);
        break;
      case "webrtc_signal":
        this.callManager.handleWebRTCSignal(msg.data);
        break;
      case "call_ended":
        this.callManager.handleCallEnded(msg.data);
        break;
    }
  }

  handleSpaceJoined(data: any) {
    const { spawnX, spawnY, existingUsers } = data;
    this.player.setPosition(spawnX, spawnY);

    existingUsers.forEach((user: any) => {
      this.playerManager.addPlayer(user.id, user.name, user.x, user.y);
    });
  }

  handleMovementRejected(data: any) {
    const { x, y } = data;
    this.player.setPosition(x, y);
  }

  handleMovement(data: any) {
    const { id, x, y } = data;
    if (id !== this.playerId) {
      this.playerManager.updatePlayerPosition(id, x, y);
    }
  }

  handleUserLeft(data: any) {
    const { id } = data;
    this.playerManager.removePlayer(id);
    this.proximityManager.destroyProximityCard(id);
    this.callManager.endCall(id, "user_left");
  }

  handleUserJoin(data: any) {
    const { id, name, x, y } = data;
    this.playerManager.addPlayer(id, name, x, y);
  }

  update() {
    if (!this.player) return;

    // Update player label
    const label = this.playerManager.getPlayerLabels().get(this.playerId);
    if (label) {
      label.setPosition(this.player.x, this.player.y - 20);
    }

    // Movement
    let moved = false;
    const speed = 100;
    if (this.player.body) {
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0);

      if (this.wasdKeys.W.isDown) {
        body.setVelocityY(-speed);
        moved = true;
      } else if (this.wasdKeys.S.isDown) {
        body.setVelocityY(speed);
        moved = true;
      }

      if (this.wasdKeys.A.isDown) {
        body.setVelocityX(-speed);
        moved = true;
      } else if (this.wasdKeys.D.isDown) {
        body.setVelocityX(speed);
        moved = true;
      }
    }

    if (moved && this.wsManager) {
      this.wsManager.send("move", {
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
      });
    }

    // Update proximity
    if (this.proximityManager) {
      this.proximityManager.update();
    }
  }

  public cleanup() {
    this.wsManager.disconnect();
    this.playerManager.destroy();
    this.proximityManager.destroy();
    this.callManager.cleanup();
  }
}

export default GameScene;
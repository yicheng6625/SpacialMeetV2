"use client";

import { useEffect, useRef } from "react";
import * as Phaser from "phaser";

interface PhaserGameProps {
  name: string;
}

const PhaserGame: React.FC<PhaserGameProps> = ({ name }) => {
  const gameRef = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (gameRef.current && !game.current) {
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width: 1760,
        height: 800,
        parent: gameRef.current,
        scene: new GameScene(name),
        backgroundColor: "#f0f0f0",
        physics: {
          default: "arcade",
          arcade: {
            debug: false,
            gravity: { x: 0, y: 0 },
            // Set world bounds to match the map
            width: 1760,
            height: 800,
          },
        },
      };
      game.current = new Phaser.Game(config);
    }

    return () => {
      if (game.current) {
        // Get the scene and clean up its resources
        const scene = game.current.scene.getScene("GameScene") as GameScene;
        if (scene) {
          scene.cleanup();
        }

        game.current.destroy(true);
        game.current = null;
      }
    };
  }, [name]);

  return <div ref={gameRef} />;
};

class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: any;
  private ws!: WebSocket;
  private playerId: string;
  private players: Map<string, Phaser.GameObjects.Container> = new Map();
  private playerLabels: Map<string, Phaser.GameObjects.Text> = new Map();
  private proximityCards: Map<string, Phaser.GameObjects.Container> = new Map();
  private R_PROXIMITY = 64; // pixels
  private R_DISCONNECT = 96; // pixels
  private activeCalls: Map<string, string> = new Map(); // id -> callType
  private incomingCallModal: Phaser.GameObjects.Container | null = null;
  private currentIncomingCall: {
    from: string;
    fromName: string;
    callType: string;
  } | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;
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

    // Build colliders from object layer - robust implementation
    const collLayer = map.getObjectLayer("Colliders");
    const solids = this.physics.add.staticGroup();

    if (collLayer && collLayer.objects) {
      collLayer.objects.forEach((obj: any) => {
        // Calculate center position
        // Rectangle objects in Tiled have y at top-left
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;

        // Create a simple rectangle game object and add physics body
        const rect = this.add.rectangle(
          cx,
          cy,
          obj.width || 1,
          obj.height || 1,
          0x000000,
          0
        );
        this.physics.add.existing(rect, true); // true = static body

        // Ensure body size matches exactly
        const body = rect.body as Phaser.Physics.Arcade.StaticBody;
        body.setSize(obj.width, obj.height);

        // Add to group for collision
        solids.add(rect);
      });
    }

    // Add physics to player and set up collision
    if (this.player) {
      const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
      playerBody.setSize(16, 12).setOffset(16, 30);
      playerBody.setCollideWorldBounds(true);
      this.physics.add.collider(this.player, solids);
    }

    // Set player to render above everything
    if (this.player) {
      this.player.setDepth(10000);
    }

    // Create front layers (rendered below player)
    map.createLayer("Dividers", [mo], 0, 0)!.setDepth(1000);
    map.createLayer("DesksFront", [mo], 0, 0)!.setDepth(1010);
    map.createLayer("DeskItems_Front", [mo], 0, 0)!.setDepth(1020);

    // Create layer that renders above the player
    map.createLayer("OverPlayer_Layer", [rb, mo], 0, 0)!.setDepth(20000);

    // Set camera bounds to match the map
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player);

    // Set physics world bounds
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // Delay WebSocket connection to ensure scene is fully initialized
    this.time.delayedCall(100, () => {
      this.initializeWebSocket();
    });
  }

  private initializeWebSocket() {
    // Connect to WebSocket using the same host as the frontend but backend port (8080)
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const wsUrl = `${protocol}//${host}:8080/ws`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      console.log("WebSocket connected successfully");
      // Send join message with spaceId, token, and player name
      this.ws.send(
        JSON.stringify({
          type: "join",
          data: {
            spaceId: "default-space",
            token: "dummy-token-" + this.playerId,
            name: this.name,
          },
        })
      );
    };
    this.ws.onmessage = (event) => {
      if (this.sceneReady && this.add) {
        this.handleMessage(event);
      } else {
        console.log(
          "Scene or Phaser add not ready, ignoring message:",
          event.data
        );
      }
    };
    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      console.error("Failed to connect to:", this.ws?.url);
    };
    this.ws.onclose = (event) => {
      console.log(
        "WebSocket closed:",
        event.code,
        event.reason,
        "Clean:",
        event.wasClean
      );
      // Basic reconnection logic
      setTimeout(() => {
        if (this.sceneReady) {
          this.initializeWebSocket();
        }
      }, 3000);
    };
  }

  private createCurrentPlayer() {
    if (!this.add) return;

    // Create player as a sprite (not container) for proper physics support
    // Use a circle graphic as texture
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
    this.playerLabels.set(this.playerId, label);

    // Note: Physics body will be configured later in create() method
  }

  handleMessage(event: MessageEvent) {
    if (!this.sceneReady || !this.add) {
      return;
    }

    const msg = JSON.parse(event.data);
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
        this.handleIncomingCall(msg.data);
        break;
      case "call_response":
        this.handleCallResponse(msg.data);
        break;
      case "webrtc_signal":
        this.handleWebRTCSignal(msg.data);
        break;
      case "call_ended":
        this.handleCallEnded(msg.data);
        break;
    }
  }
  handleSpaceJoined(data: any) {
    if (!this.add) {
      return;
    }

    // Set player position from spawn point
    const { spawnX, spawnY, existingUsers } = data;
    this.player.setPosition(spawnX, spawnY);

    // Create containers for existing users
    existingUsers.forEach((user: any) => {
      const container = this.add.container(user.x, user.y);
      const avatar = this.add.circle(0, 0, 12, 0xff0000);
      container.add(avatar);
      this.players.set(user.id, container);

      const label = this.add.text(0, -20, user.name, {
        fontSize: "12px",
        color: "#000",
      });
      label.setOrigin(0.5);
      container.add(label);
      this.playerLabels.set(user.id, label);
    });
  }

  handleMovementRejected(data: any) {
    // Server rejected our movement, correct our position
    const { x, y } = data;
    this.player.setPosition(x, y);
  }

  handleMovement(data: any) {
    const { id, x, y } = data;

    // Never move the current player through network messages
    if (id === this.playerId) {
      return;
    }

    const container = this.players.get(id);
    if (container) {
      // Smooth movement to new position
      this.tweens.add({
        targets: container,
        x: x,
        y: y,
        duration: 200,
        ease: "Linear",
      });
    }
  }

  handleUserLeft(data: any) {
    const { id } = data;
    const container = this.players.get(id);
    if (container) {
      container.destroy();
      this.players.delete(id);
    }
    const label = this.playerLabels.get(id);
    if (label) {
      // Label is destroyed with container
      this.playerLabels.delete(id);
    }
    // Clean up proximity card
    if (this.proximityCards.has(id)) {
      this.proximityCards.get(id)!.destroy();
      this.proximityCards.delete(id);
    }
  }

  handleUserJoin(data: any) {
    if (!this.add) {
      return;
    }

    const { id, name, x, y } = data;

    // Don't create a duplicate if this player already exists
    if (this.players.has(id) || id === this.playerId) {
      return;
    }

    const container = this.add.container(x, y);
    const avatar = this.add.circle(0, 0, 12, 0xff0000);
    container.add(avatar);
    this.players.set(id, container);

    const label = this.add.text(0, -20, name, {
      fontSize: "12px",
      color: "#000",
    });
    label.setOrigin(0.5);
    container.add(label);
    this.playerLabels.set(id, label);
  }

  update() {
    if (!this.player) return;

    // Update player label position to follow player
    const label = this.playerLabels.get(this.playerId);
    if (label) {
      label.setPosition(this.player.x, this.player.y - 20);
    }

    // Handle WASD movement with physics
    const speed = 100; // pixels per second
    let moved = false;

    if (this.player.body) {
      const body = this.player.body as Phaser.Physics.Arcade.Body;

      // Reset velocity
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

    // Send movement to server if position changed
    if (moved && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "move",
          data: {
            x: Math.round(this.player.x),
            y: Math.round(this.player.y),
          },
        })
      );
    }

    // Update proximity cards and check call distances
    this.players.forEach((container, id) => {
      const distance = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        container.x,
        container.y
      );

      if (distance <= this.R_PROXIMITY) {
        if (!this.proximityCards.has(id)) {
          // Create proximity card
          if (!this.add) {
            return;
          }

          const card = this.add.container(container.x, container.y - 40);
          const bg = this.add.rectangle(0, 0, 120, 40, 0xffffff);
          bg.setStrokeStyle(2, 0x000000);
          card.add(bg);

          const videoBtn = this.add.text(-40, 0, "Video", {
            fontSize: "12px",
            color: "#000",
          });
          videoBtn.setInteractive();
          videoBtn.on("pointerdown", () => this.initiateCall(id, "video"));
          card.add(videoBtn);

          const audioBtn = this.add.text(0, 0, "Audio", {
            fontSize: "12px",
            color: "#000",
          });
          audioBtn.setInteractive();
          audioBtn.on("pointerdown", () => this.initiateCall(id, "audio"));
          card.add(audioBtn);

          const chatBtn = this.add.text(40, 0, "Chat", {
            fontSize: "12px",
            color: "#000",
          });
          chatBtn.setInteractive();
          chatBtn.on("pointerdown", () => this.initiateChat(id));
          card.add(chatBtn);

          this.proximityCards.set(id, card);
        } else {
          // Update position
          const card = this.proximityCards.get(id)!;
          card.setPosition(container.x, container.y - 40);
        }
      } else {
        if (this.proximityCards.has(id)) {
          this.proximityCards.get(id)!.destroy();
          this.proximityCards.delete(id);
        }
      }
    });

    // Check for auto-end calls
    this.activeCalls.forEach((callType, id) => {
      const container = this.players.get(id);
      if (container) {
        const distance = Phaser.Math.Distance.Between(
          this.player.x,
          this.player.y,
          container.x,
          container.y
        );
        if (distance > this.R_DISCONNECT) {
          this.endCall(id, "distance");
        }
      }
    });
  }

  private endCall(toId: string, reason: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "call_ended",
          data: { from: this.playerId, to: toId, reason },
        })
      );
    }
    this.activeCalls.delete(toId);

    // Clean up peer connection
    const pc = this.peerConnections.get(toId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(toId);
    }

    // Clean up local stream if no more active calls
    if (this.activeCalls.size === 0 && this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
  }

  private initiateCall(toId: string, callType: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "request_call",
          data: { from: this.playerId, to: toId, callType },
        })
      );
    }
  }

  private initiateChat(toId: string) {
    // TODO: Implement chat
  }

  private handleIncomingCall(data: any) {
    if (!this.add) {
      return;
    }

    const { from, fromName, callType } = data;
    this.currentIncomingCall = { from, fromName, callType };

    // Create modal
    this.incomingCallModal = this.add.container(640, 320);
    const bg = this.add.rectangle(0, 0, 300, 150, 0xffffff);
    bg.setStrokeStyle(2, 0x000000);
    this.incomingCallModal.add(bg);

    const title = this.add.text(
      0,
      -50,
      `${fromName} is calling (${callType})`,
      { fontSize: "16px", color: "#000" }
    );
    title.setOrigin(0.5);
    this.incomingCallModal.add(title);

    const acceptBtn = this.add.text(-50, 20, "Accept", {
      fontSize: "14px",
      color: "#00ff00",
    });
    acceptBtn.setInteractive();
    acceptBtn.on("pointerdown", () => this.acceptCall());
    this.incomingCallModal.add(acceptBtn);

    const declineBtn = this.add.text(50, 20, "Decline", {
      fontSize: "14px",
      color: "#ff0000",
    });
    declineBtn.setInteractive();
    declineBtn.on("pointerdown", () => this.declineCall());
    this.incomingCallModal.add(declineBtn);

    // Auto decline after 20s
    this.time.delayedCall(20000, () => {
      if (this.currentIncomingCall) {
        this.declineCall();
      }
    });
  }

  private async acceptCall() {
    if (this.currentIncomingCall) {
      const { from, callType } = this.currentIncomingCall;
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callType === "video",
        });
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        this.peerConnections.set(from, pc);

        this.localStream
          .getTracks()
          .forEach((track) => pc.addTrack(track, this.localStream!));

        pc.onicecandidate = (event) => {
          if (
            event.candidate &&
            this.ws &&
            this.ws.readyState === WebSocket.OPEN
          ) {
            this.ws.send(
              JSON.stringify({
                type: "webrtc_signal",
                data: {
                  from: this.playerId,
                  to: from,
                  data: { type: "candidate", candidate: event.candidate },
                },
              })
            );
          }
        };

        pc.ontrack = (event) => {
          // TODO: Handle remote stream
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: "webrtc_signal",
              data: { from: this.playerId, to: from, data: offer },
            })
          );
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: "call_response",
              data: { from, to: this.playerId, accepted: true },
            })
          );
        }
        this.hideIncomingCallModal();
        this.activeCalls.set(from, callType);
      } catch (error) {
        console.error("Error accepting call:", error);
        this.declineCall();
      }
    }
  }

  private declineCall() {
    if (this.currentIncomingCall) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "call_response",
            data: {
              from: this.currentIncomingCall.from,
              to: this.playerId,
              accepted: false,
            },
          })
        );
      }
      this.hideIncomingCallModal();
    }
  }

  private hideIncomingCallModal() {
    if (this.incomingCallModal) {
      this.incomingCallModal.destroy();
      this.incomingCallModal = null;
    }
    this.currentIncomingCall = null;
  }

  private async handleCallResponse(data: any) {
    const { from, accepted } = data;
    if (accepted) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true, // Assume video for now
        });
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        this.peerConnections.set(from, pc);

        this.localStream
          .getTracks()
          .forEach((track) => pc.addTrack(track, this.localStream!));

        pc.onicecandidate = (event) => {
          if (
            event.candidate &&
            this.ws &&
            this.ws.readyState === WebSocket.OPEN
          ) {
            this.ws.send(
              JSON.stringify({
                type: "webrtc_signal",
                data: {
                  from: this.playerId,
                  to: from,
                  data: { type: "candidate", candidate: event.candidate },
                },
              })
            );
          }
        };

        pc.ontrack = (event) => {
          // TODO: Handle remote stream
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: "webrtc_signal",
              data: { from: this.playerId, to: from, data: offer },
            })
          );
        }
      } catch (error) {
        console.error("Error starting call:", error);
      }
      this.activeCalls.set(from, "video");
    }
  }

  private async handleWebRTCSignal(data: any) {
    const { from, data: signalData } = data;
    let pc = this.peerConnections.get(from);
    if (!pc) {
      // Create PC for caller
      pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      this.peerConnections.set(from, pc);

      pc.onicecandidate = (event) => {
        if (
          event.candidate &&
          this.ws &&
          this.ws.readyState === WebSocket.OPEN
        ) {
          this.ws.send(
            JSON.stringify({
              type: "webrtc_signal",
              data: {
                from: this.playerId,
                to: from,
                data: { type: "candidate", candidate: event.candidate },
              },
            })
          );
        }
      };

      pc.ontrack = (event) => {
        // TODO: Handle remote stream
      };
    }

    if (signalData.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(signalData));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "webrtc_signal",
            data: { from: this.playerId, to: from, data: answer },
          })
        );
      }
    } else if (signalData.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(signalData));
    } else if (signalData.type === "candidate") {
      await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
    }
  }

  private handleCallEnded(data: any) {
    const { from, to } = data;
    const pc = this.peerConnections.get(from) || this.peerConnections.get(to);
    if (pc) {
      pc.close();
      this.peerConnections.delete(from);
      this.peerConnections.delete(to);
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
  }

  public cleanup() {
    // Clean up WebSocket
    if (this.ws) {
      this.ws.close();
    }

    // Clean up WebRTC resources
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    // Clear active calls
    this.activeCalls.clear();
  }
}

export default PhaserGame;

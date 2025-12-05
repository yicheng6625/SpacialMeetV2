import * as Phaser from 'phaser';
import { WebSocketManager } from './WebSocketManager';

export class CallManager {
  private scene: Phaser.Scene;
  private wsManager: WebSocketManager;
  private playerId: string;
  private activeCalls: Map<string, string> = new Map(); // id -> callType
  private incomingCallModal: Phaser.GameObjects.Container | null = null;
  private currentIncomingCall: {
    from: string;
    fromName: string;
    callType: string;
  } | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;

  constructor(scene: Phaser.Scene, wsManager: WebSocketManager, playerId: string) {
    this.scene = scene;
    this.wsManager = wsManager;
    this.playerId = playerId;
  }

  initiateCall(toId: string, callType: string) {
    if (this.wsManager) {
      this.wsManager.send("request_call", { from: this.playerId, to: toId, callType });
    }
  }

  initiateChat(toId: string) {
    // TODO: Implement chat
  }

  handleIncomingCall(data: any) {
    const { from, fromName, callType } = data;
    this.currentIncomingCall = { from, fromName, callType };

    this.incomingCallModal = this.scene.add.container(640, 320);
    const bg = this.scene.add.rectangle(0, 0, 300, 150, 0xffffff);
    bg.setStrokeStyle(2, 0x000000);
    this.incomingCallModal.add(bg);

    const title = this.scene.add.text(0, -50, `${fromName} is calling (${callType})`, { fontSize: "16px", color: "#000" });
    title.setOrigin(0.5);
    this.incomingCallModal.add(title);

    const acceptBtn = this.scene.add.text(-50, 20, "Accept", { fontSize: "14px", color: "#00ff00" });
    acceptBtn.setInteractive();
    acceptBtn.on("pointerdown", () => this.acceptCall());
    this.incomingCallModal.add(acceptBtn);

    const declineBtn = this.scene.add.text(50, 20, "Decline", { fontSize: "14px", color: "#ff0000" });
    declineBtn.setInteractive();
    declineBtn.on("pointerdown", () => this.declineCall());
    this.incomingCallModal.add(declineBtn);

    // Auto decline after 20s
    this.scene.time.delayedCall(20000, () => {
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

        this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));

        pc.onicecandidate = (event) => {
          if (event.candidate && this.wsManager) {
            this.wsManager.send("webrtc_signal", {
              from: this.playerId,
              to: from,
              data: { type: "candidate", candidate: event.candidate },
            });
          }
        };

        pc.ontrack = (event) => {
          // TODO: Handle remote stream
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.wsManager) {
          this.wsManager.send("webrtc_signal", { from: this.playerId, to: from, data: offer });
        }

        if (this.wsManager) {
          this.wsManager.send("call_response", { from, to: this.playerId, accepted: true });
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
      if (this.wsManager) {
        this.wsManager.send("call_response", {
          from: this.currentIncomingCall.from,
          to: this.playerId,
          accepted: false,
        });
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

  handleCallResponse(data: any) {
    const { from, accepted } = data;
    if (accepted) {
      // Similar to acceptCall but for caller
      // Implementation needed
    }
  }

  handleWebRTCSignal(data: any) {
    // Implementation
  }

  handleCallEnded(data: any) {
    // Implementation
  }

  endCall(toId: string, reason: string) {
    if (this.wsManager) {
      this.wsManager.send("call_ended", { from: this.playerId, to: toId, reason });
    }
    this.activeCalls.delete(toId);

    const pc = this.peerConnections.get(toId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(toId);
    }

    if (this.activeCalls.size === 0 && this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
  }

  cleanup() {
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.activeCalls.clear();
  }
}
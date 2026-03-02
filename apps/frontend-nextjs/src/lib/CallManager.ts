import * as Phaser from "phaser";
import { WebSocketManager } from "./WebSocketManager";

interface ICEServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface CallState {
  peerId: string;
  peerName: string;
  callType: "audio" | "video";
  status: "connecting" | "connected" | "reconnecting";
  startTime: number;
}

export class CallManager {
  private scene: Phaser.Scene;
  private wsManager: WebSocketManager;
  private playerId: string;
  private activeCalls = new Map<string, CallState>();
  private currentIncomingCall: {
    from: string;
    fromName: string;
    callType: "audio" | "video";
  } | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private remoteStreams = new Map<string, MediaStream>();
  private micEnabled = true;
  private videoEnabled = true;
  private peerNames = new Map<string, string>();
  private iceServers: ICEServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

  constructor(
    scene: Phaser.Scene,
    wsManager: WebSocketManager,
    playerId: string,
  ) {
    this.scene = scene;
    this.wsManager = wsManager;
    this.playerId = playerId;
    this.setupEventListeners();
  }

  private setupEventListeners() {
    window.addEventListener("micToggle", ((e: CustomEvent) => {
      this.toggleMicrophone(e.detail.enabled);
    }) as EventListener);

    window.addEventListener("videoToggle", ((e: CustomEvent) => {
      this.toggleVideo(e.detail.enabled);
    }) as EventListener);

    window.addEventListener("leaveCall", (() => {
      this.endAllCalls();
    }) as EventListener);

    window.addEventListener("acceptCall", (() => {
      this.acceptCall();
    }) as EventListener);

    window.addEventListener("declineCall", (() => {
      this.declineCall();
    }) as EventListener);
  }

  async initiateCall(
    toId: string,
    callType: "audio" | "video",
    peerName?: string,
  ) {
    console.log(`[CallManager] initiateCall → to=${toId}, type=${callType}, peerName=${peerName}`);
    try {
      this.localStream = await this.getLocalStream(callType);
      console.log(`[CallManager] localStream tracks:`, this.localStream.getTracks().map(t => `${t.kind}(${t.readyState})`));
      this.peerNames.set(toId, peerName || "Unknown User");

      this.wsManager.send("request_call", {
        from: this.playerId,
        to: toId,
        callType,
      });
      console.log(`[CallManager] request_call sent → from=${this.playerId}, to=${toId}`);

      window.dispatchEvent(new CustomEvent("callStarted"));
    } catch (error) {
      console.error("Failed to initiate call:", error);
      window.dispatchEvent(
        new CustomEvent("callError", {
          detail: { error: "Failed to access media devices" },
        }),
      );
    }
  }

  private async getLocalStream(
    callType: "audio" | "video",
  ): Promise<MediaStream> {
    if (this.localStream) {
      const hasVideo = this.localStream.getVideoTracks().length > 0;
      if (
        (callType === "audio" && !hasVideo) ||
        (callType === "video" && hasVideo)
      ) {
        this.updateTrackStates(callType);
        return this.localStream;
      }
      this.localStream.getTracks().forEach((track) => track.stop());
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Media devices not supported");
    }

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video:
        callType === "video"
          ? {
              width: { ideal: 320 },
              height: { ideal: 240 },
              facingMode: "user",
            }
          : false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.updateTrackStates(callType);
    return stream;
  }

  private updateTrackStates(callType: "audio" | "video") {
    if (!this.localStream) return;
    this.localStream
      .getAudioTracks()
      .forEach((track) => (track.enabled = this.micEnabled));
    if (callType === "video") {
      this.localStream
        .getVideoTracks()
        .forEach((track) => (track.enabled = this.videoEnabled));
    }
  }

  initiateChat() {
    // Dispatch event to open chat panel
    window.dispatchEvent(new CustomEvent("openChat"));
  }

  handleIncomingCall(data: Record<string, unknown>) {
    const { from, fromName, callType } = data as {
      from: string;
      fromName: string;
      callType: "audio" | "video";
    };
    this.currentIncomingCall = { from, fromName, callType };

    window.dispatchEvent(
      new CustomEvent("incomingCall", { detail: { from, fromName, callType } }),
    );

    this.scene.time.delayedCall(30000, () => {
      if (this.currentIncomingCall) this.declineCall();
    });
  }

  private async acceptCall() {
    if (!this.currentIncomingCall) return;

    const { from, fromName, callType } = this.currentIncomingCall;
    console.log(`[CallManager] acceptCall → from=${from}, fromName=${fromName}, type=${callType}`);

    try {
      this.localStream = await this.getLocalStream(callType);
      console.log(`[CallManager] acceptCall localStream tracks:`, this.localStream.getTracks().map(t => `${t.kind}(${t.readyState})`));

      const pc = this.createPeerConnection(from);
      this.peerConnections.set(from, pc);

      this.localStream
        .getTracks()
        .forEach((track) => pc.addTrack(track, this.localStream!));
      console.log(`[CallManager] acceptCall tracks added to PC`);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log(`[CallManager] acceptCall offer created, sdpType=${offer.type}`);

      this.wsManager.send("webrtc_signal", {
        from: this.playerId,
        to: from,
        data: { type: "offer", sdp: offer.sdp },
      });

      this.wsManager.send("call_response", {
        from,
        to: this.playerId,
        accepted: true,
      });
      console.log(`[CallManager] acceptCall offer + call_response sent`);

      this.hideIncomingCallModal();

      this.activeCalls.set(from, {
        peerId: from,
        peerName: fromName,
        callType,
        status: "connecting",
        startTime: Date.now(),
      });

      this.peerNames.set(from, fromName);
      window.dispatchEvent(new CustomEvent("callStarted"));
    } catch (error) {
      console.error("Error accepting call:", error);
      window.dispatchEvent(
        new CustomEvent("callError", {
          detail: { error: "Failed to accept call" },
        }),
      );
      this.declineCall();
    }
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    console.log(`[CallManager] createPeerConnection → peerId=${peerId}`);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[CallManager] ICE candidate generated → to=${peerId}, type=${event.candidate.type}, protocol=${event.candidate.protocol}`);
        this.wsManager.send("webrtc_signal", {
          from: this.playerId,
          to: peerId,
          data: { type: "candidate", candidate: event.candidate.toJSON() },
        });
      } else {
        // null candidate 代表本地端 ICE 蒐集完成
        console.log(`[CallManager] ICE gathering complete → peerId=${peerId}`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[CallManager] ICE connection state changed → peerId=${peerId}, state=${pc.iceConnectionState}`);
      const callState = this.activeCalls.get(peerId);
      if (callState) {
        switch (pc.iceConnectionState) {
          case "connected":
          case "completed":
            callState.status = "connected";
            break;
          case "disconnected":
            callState.status = "reconnecting";
            break;
          case "failed":
          case "closed":
            this.endCall(peerId, "connection_lost");
            break;
        }
      }
    };

    // 監聽 SDP 協商狀態，有助於診斷 offer/answer 交換流程
    pc.onsignalingstatechange = () => {
      console.log(`[CallManager] signaling state changed → peerId=${peerId}, state=${pc.signalingState}`);
    };

    pc.ontrack = (event) => {
      console.log(`[CallManager] ontrack fired → peerId=${peerId}, kind=${event.track.kind}, readyState=${event.track.readyState}, streams.length=${event.streams.length}`);
      const stream = event.streams[0];
      if (stream) {
        console.log(`[CallManager] remote stream tracks:`, stream.getTracks().map(t => `${t.kind}(${t.readyState}, enabled=${t.enabled})`));
        this.remoteStreams.set(peerId, stream);
        this.createVideoElement(peerId, stream);
      } else {
        console.warn(`[CallManager] ontrack fired 但沒有可用的 stream → peerId=${peerId}`);
      }
    };

    return pc;
  }

  private createVideoElement(peerId: string, stream: MediaStream) {
    const peerName = this.peerNames.get(peerId) || "Unknown User";
    console.log(`[CallManager] createVideoElement → peerId=${peerId}, peerName=${peerName}, tracks:`, stream.getTracks().map(t => `${t.kind}(${t.readyState})`));
    window.dispatchEvent(
      new CustomEvent("remoteStreamAdded", {
        detail: { peerId, stream, peerName },
      }),
    );
  }

  private declineCall() {
    if (this.currentIncomingCall) {
      this.wsManager.send("call_response", {
        from: this.currentIncomingCall.from,
        to: this.playerId,
        accepted: false,
      });
      this.hideIncomingCallModal();
    }
  }

  private hideIncomingCallModal() {
    this.currentIncomingCall = null;
    window.dispatchEvent(new CustomEvent("incomingCallEnded"));
  }

  handleCallResponse(data: Record<string, unknown>) {
    const { from, accepted } = data as { from: string; accepted: boolean };
    console.log(`[CallManager] handleCallResponse → from=${from}, accepted=${accepted}`);
    if (!accepted) this.cleanupCall(from);
  }

  async handleWebRTCSignal(data: Record<string, unknown>) {
    const { from, data: signalData } = data as {
      from: string;
      data: { type: string; sdp?: string; candidate?: RTCIceCandidateInit };
    };
    console.log(`[CallManager] handleWebRTCSignal → from=${from}, type=${signalData.type}`);

    try {
      if (signalData.type === "offer") {
        console.log(`[CallManager] 收到 offer → from=${from}`);
        let pc = this.peerConnections.get(from);
        if (!pc) {
          pc = this.createPeerConnection(from);
          this.peerConnections.set(from, pc);
          if (this.localStream) {
            const tracks = this.localStream.getTracks();
            console.log(`[CallManager] offer: 加入本地 tracks → from=${from}, tracks:`, tracks.map(t => `${t.kind}(${t.readyState})`));
            tracks.forEach((track) => pc!.addTrack(track, this.localStream!));
          } else {
            console.warn(`[CallManager] offer: localStream 為 null，不加入任何 track！`);
          }
          // 發起通話方（Caller）在此才建立 PeerConnection，
          // 原本 initiateCall() 只發送信令而未加入 activeCalls，
          // 補上記錄確保 ICE 狀態更新與離開房間時的通話清理能正確運作
          if (!this.activeCalls.has(from)) {
            const callType =
              this.localStream && this.localStream.getVideoTracks().length > 0
                ? "video"
                : "audio";
            this.activeCalls.set(from, {
              peerId: from,
              peerName: this.peerNames.get(from) || "Unknown",
              callType,
              status: "connecting",
              startTime: Date.now(),
            });
            console.log(`[CallManager] offer: 補建 activeCalls → from=${from}, callType=${callType}`);
          }
        }

        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: "offer", sdp: signalData.sdp }),
        );
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`[CallManager] answer 已建立並設為 local description → to=${from}`);

        this.wsManager.send("webrtc_signal", {
          from: this.playerId,
          to: from,
          data: { type: "answer", sdp: answer.sdp },
        });
        console.log(`[CallManager] answer 已透過 WS 送出 → to=${from}`);
      } else if (signalData.type === "answer") {
        console.log(`[CallManager] 收到 answer → from=${from}`);
        const pc = this.peerConnections.get(from);
        if (pc) {
          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: "answer", sdp: signalData.sdp }),
          );
          console.log(`[CallManager] answer 設為 remote description 完成 → from=${from}`);
        } else {
          console.warn(`[CallManager] 收到 answer 但找不到 PeerConnection → from=${from}`);
        }
      } else if (signalData.type === "candidate" && signalData.candidate) {
        const pc = this.peerConnections.get(from);
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
          console.log(`[CallManager] ICE candidate 加入成功 → from=${from}`);
        } else {
          console.warn(`[CallManager] 收到 ICE candidate 但找不到 PeerConnection → from=${from}`);
        }
      }
    } catch (error) {
      console.error("Error handling WebRTC signal:", error);
    }
  }

  handleCallEnded(data: Record<string, unknown>) {
    const { from } = data as { from: string };
    this.cleanupCall(from);
  }

  private cleanupCall(peerId: string) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }

    this.activeCalls.delete(peerId);
    this.remoteStreams.delete(peerId);
    window.dispatchEvent(
      new CustomEvent("remoteStreamRemoved", { detail: { peerId } }),
    );

    if (this.activeCalls.size === 0) {
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
        this.localStream = null;
      }
      window.dispatchEvent(new CustomEvent("callEnded"));
    }
  }

  endCall(toId: string, reason: string) {
    if (this.wsManager) {
      this.wsManager.send("call_ended", {
        from: this.playerId,
        to: toId,
        reason,
      });
    }
    this.cleanupCall(toId);
  }

  private endAllCalls() {
    const callIds = Array.from(this.activeCalls.keys());
    callIds.forEach((id) => this.endCall(id, "user_hangup"));
  }

  toggleMicrophone(enabled: boolean) {
    this.micEnabled = enabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
        if (!enabled) track.stop();
      });
    } else if (enabled) {
      this.initializeAudioTracks();
    }
  }

  toggleVideo(enabled: boolean) {
    this.videoEnabled = enabled;
    if (this.localStream) {
      this.localStream
        .getVideoTracks()
        .forEach((track) => (track.enabled = enabled));
    } else if (enabled) {
      this.initializeVideoTracks();
    }
  }

  private async initializeTracks(type: "audio" | "video") {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;

      const constraints =
        type === "audio"
          ? {
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            }
          : {
              video: {
                width: { ideal: 320 },
                height: { ideal: 240 },
                facingMode: "user",
              },
            };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (this.localStream) {
        stream
          .getTracks()
          .forEach((track) => this.localStream!.addTrack(track));
      } else {
        this.localStream = stream;
        // Add the other type if enabled
        const otherType = type === "audio" ? "video" : "audio";
        if (
          (type === "audio" && this.videoEnabled) ||
          (type === "video" && this.micEnabled)
        ) {
          const otherStream = await navigator.mediaDevices.getUserMedia(
            otherType === "audio"
              ? {
                  audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                  },
                }
              : {
                  video: {
                    width: { ideal: 320 },
                    height: { ideal: 240 },
                    facingMode: "user",
                  },
                },
          );
          otherStream
            .getTracks()
            .forEach((track) => this.localStream!.addTrack(track));
        }
      }

      this.updateTrackStates(type === "video" ? "video" : "audio");
    } catch (error) {
      console.error(`Failed to initialize ${type} tracks:`, error);
    }
  }

  private async initializeVideoTracks() {
    await this.initializeTracks("video");
  }

  private async initializeAudioTracks() {
    await this.initializeTracks("audio");
  }
  isInCall(): boolean {
    return this.activeCalls.size > 0;
  }

  getActiveCalls(): CallState[] {
    return Array.from(this.activeCalls.values());
  }

  cleanup() {
    this.endAllCalls();
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.activeCalls.clear();
    this.remoteStreams.clear();
  }
}

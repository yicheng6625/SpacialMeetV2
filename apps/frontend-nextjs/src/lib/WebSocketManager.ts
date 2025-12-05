export interface WebSocketMessage {
  type: string;
  data: any;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private playerId: string;
  private name: string;
  private onMessageCallback?: (msg: WebSocketMessage) => void;

  constructor(playerId: string, name: string) {
    this.playerId = playerId;
    this.name = name;
  }

  setOnMessage(callback: (msg: WebSocketMessage) => void) {
    this.onMessageCallback = callback;
  }

  connect(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      console.log("WebSocket connected successfully");
      this.send("join", {
        spaceId: "default-space",
        token: "dummy-token-" + this.playerId,
        name: this.name,
      });
    };
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (this.onMessageCallback) {
        this.onMessageCallback(msg);
      }
    };
    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      console.error("Failed to connect to:", this.ws?.url);
    };
    this.ws.onclose = (event) => {
      console.log("WebSocket closed:", event.code, event.reason, "Clean:", event.wasClean);
      // Basic reconnection logic
      setTimeout(() => {
        this.connect(url);
      }, 3000);
    };
  }

  send(type: string, data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}
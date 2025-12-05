import * as Phaser from 'phaser';

export class PlayerManager {
  private scene: Phaser.Scene;
  private players: Map<string, Phaser.GameObjects.Container> = new Map();
  private playerLabels: Map<string, Phaser.GameObjects.Text> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  addPlayer(id: string, name: string, x: number, y: number, isCurrentPlayer: boolean = false) {
    if (this.players.has(id)) return;

    const container = this.scene.add.container(x, y);
    const avatar = this.scene.add.circle(0, 0, 12, isCurrentPlayer ? 0x00ff00 : 0xff0000);
    container.add(avatar);
    this.players.set(id, container);

    const label = this.scene.add.text(0, -20, name, {
      fontSize: "12px",
      color: "#000",
    });
    label.setOrigin(0.5);
    container.add(label);
    this.playerLabels.set(id, label);

    // Set depth for all players to render above map layers but below OverPlayer_Layer
    container.setDepth(10000);
  }

  updatePlayerPosition(id: string, x: number, y: number) {
    const container = this.players.get(id);
    if (container) {
      this.scene.tweens.add({
        targets: container,
        x: x,
        y: y,
        duration: 200,
        ease: "Linear",
      });
    }
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
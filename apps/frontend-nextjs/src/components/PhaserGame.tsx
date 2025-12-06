"use client";

import { useEffect, useRef } from "react";
import * as Phaser from "phaser";
import GameScene from "../scenes/GameScene";

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
            width: 1760,
            height: 800,
          },
        },
      };
      game.current = new Phaser.Game(config);
    }

    return () => {
      if (game.current) {
        const scene = game.current.scene.getScene("GameScene") as GameScene;
        if (scene) {
          scene.cleanup();
        }

        // Fix for audio context closure issues
        game.current.sound.removeAll();

        // Only attempt to close AudioContext if using WebAudio (not HTML5 Audio fallback)
        const soundManager = game.current.sound;
        if (soundManager instanceof Phaser.Sound.WebAudioSoundManager) {
          const ctx = soundManager.context;
          if (ctx && ctx.state !== "closed") {
            ctx.close().catch(() => {
              // Ignore errors if context is already closing/closed
            });
          }
        }

        game.current.destroy(true);
        game.current = null;
      }
    };
  }, [name]);

  return <div ref={gameRef} />;
};

export default PhaserGame;

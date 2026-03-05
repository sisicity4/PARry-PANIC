import Phaser from "phaser";
import "./style.css";
import { GAME_HEIGHT, GAME_WIDTH } from "./game/config";
import { GameScene } from "./game/scenes/GameScene";
import { MainMenuScene } from "./game/scenes/MainMenuScene";
import { ResultScene } from "./game/scenes/ResultScene";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app root");
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: appRoot,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#05070f",
  pixelArt: false,
  antialias: true,
  render: {
    preserveDrawingBuffer: true,
  },
  physics: {
    default: "arcade",
    arcade: {
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: [MainMenuScene, GameScene, ResultScene],
});

window.addEventListener("beforeunload", () => {
  game.destroy(true);
});

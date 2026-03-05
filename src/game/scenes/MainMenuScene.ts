import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../config";
import { runtime } from "../core/runtime";
import { SCENE_KEYS } from "./keys";

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.MAIN_MENU);
  }

  create(): void {
    this.drawBackdrop();

    const title = this.add
      .text(GAME_WIDTH / 2, 120, "LOUD DUNGEON\\nEncore", {
        fontFamily: "'Bebas Neue', 'Noto Sans JP', sans-serif",
        fontSize: "72px",
        lineSpacing: 8,
        align: "center",
        color: "#f5f7ff",
        stroke: "#140f28",
        strokeThickness: 8,
      })
      .setOrigin(0.5, 0);

    title.setShadow(0, 8, "#1b1f55", 12, false, true);

    const subtitle = this.add
      .text(
        GAME_WIDTH / 2,
        260,
        "音で歪むローグライク。パリィ成功で次の8拍を支配する。",
        {
          fontFamily: "'Noto Sans JP', sans-serif",
          fontSize: "22px",
          color: "#c8d3ff",
        },
      )
      .setOrigin(0.5, 0.5);

    subtitle.setAlpha(0.95);

    this.add.text(GAME_WIDTH / 2, 335, "WASD: 移動 / 右クリック or Shift: パリィ / Space: 叫び", {
      fontFamily: "'Noto Sans JP', sans-serif",
      fontSize: "18px",
      color: "#dfecff",
    }).setOrigin(0.5, 0.5);

    const button = this.add
      .rectangle(GAME_WIDTH / 2, 460, 290, 82, 0x63e3ff, 0.92)
      .setStrokeStyle(3, 0xffffff, 0.7)
      .setInteractive({ useHandCursor: true });

    const buttonLabel = this.add
      .text(button.x, button.y, "START RUN", {
        fontFamily: "'Bebas Neue', 'Noto Sans JP', sans-serif",
        fontSize: "46px",
        color: "#0b1940",
      })
      .setOrigin(0.5, 0.55);

    button.on("pointerover", () => {
      button.setFillStyle(0x8df2ff, 1);
      buttonLabel.setScale(1.03);
    });

    button.on("pointerout", () => {
      button.setFillStyle(0x63e3ff, 0.92);
      buttonLabel.setScale(1);
    });

    const startRun = async (): Promise<void> => {
      await runtime.audio.start();
      const runSeed = Date.now() >>> 0;
      this.scene.start(SCENE_KEYS.GAME, { runSeed });
    };

    button.on("pointerup", () => {
      void startRun();
    });

    this.input.keyboard?.once("keydown-ENTER", () => {
      void startRun();
    });

    const meta = runtime.meta.snapshot;
    this.add.text(GAME_WIDTH / 2, 560, `Total Runs: ${meta.totalRuns}  /  Total Points: ${meta.totalPoints}`, {
      fontFamily: "'Noto Sans JP', sans-serif",
      fontSize: "18px",
      color: "#b9c6ff",
    }).setOrigin(0.5, 0.5);
  }

  private drawBackdrop(): void {
    const backdrop = this.add.graphics();
    backdrop.fillGradientStyle(0x151229, 0x1a2151, 0x0b142b, 0x1b1033, 1, 1, 1, 1);
    backdrop.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    for (let index = 0; index < 24; index += 1) {
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(0, GAME_HEIGHT);
      const radius = Phaser.Math.Between(2, 5);
      const alpha = Phaser.Math.FloatBetween(0.15, 0.35);
      this.add.circle(x, y, radius, 0xa6c9ff, alpha);
    }
  }
}

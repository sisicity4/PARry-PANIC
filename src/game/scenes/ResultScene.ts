import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../config";
import { runtime } from "../core/runtime";
import { SCENE_KEYS } from "./keys";

export interface ResultData {
  won: boolean;
  score: number;
  parryCount: number;
  runSeed: number;
  survivedSeconds: number;
}

export class ResultScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.RESULT);
  }

  create(data: ResultData): void {
    const result = {
      won: data.won ?? false,
      score: data.score ?? 0,
      parryCount: data.parryCount ?? 0,
      runSeed: data.runSeed ?? 0,
      survivedSeconds: data.survivedSeconds ?? 0,
    };

    const pointsEarned = Math.max(0, Math.floor(result.score + result.parryCount * 3 + result.survivedSeconds));
    const updatedMeta = runtime.meta.commitRun(pointsEarned);

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0f1228, 0x111530, 0x080b1a, 0x150d26, 1, 1, 1, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    const heading = result.won ? "ENCORE CLEAR" : "RUN FAILED";
    const headingColor = result.won ? "#9fffe6" : "#ffc6d0";

    this.add.text(GAME_WIDTH / 2, 110, heading, {
      fontFamily: "'Bebas Neue', 'Noto Sans JP', sans-serif",
      fontSize: "74px",
      color: headingColor,
      stroke: "#13162d",
      strokeThickness: 8,
    }).setOrigin(0.5, 0.5);

    this.add.text(
      GAME_WIDTH / 2,
      250,
      [
        `Score: ${Math.floor(result.score)}`,
        `Parry: ${result.parryCount}`,
        `Survival: ${result.survivedSeconds.toFixed(1)}s`,
        `Run Seed: ${result.runSeed}`,
        `Points Earned: ${pointsEarned}`,
      ].join("\\n"),
      {
        fontFamily: "'Noto Sans JP', sans-serif",
        fontSize: "28px",
        lineSpacing: 14,
        color: "#e6edff",
        align: "center",
      },
    ).setOrigin(0.5, 0);

    this.add.text(
      GAME_WIDTH / 2,
      470,
      `Meta: Runs ${updatedMeta.totalRuns} / Points ${updatedMeta.totalPoints} / Weapons ${updatedMeta.unlockedWeapons.join(", ")}`,
      {
        fontFamily: "'Noto Sans JP', sans-serif",
        fontSize: "20px",
        color: "#b9c5ff",
        align: "center",
      },
    ).setOrigin(0.5, 0.5);

    const button = this.add.rectangle(GAME_WIDTH / 2, 590, 320, 78, 0x7de7ff, 0.95)
      .setStrokeStyle(3, 0xffffff, 0.7)
      .setInteractive({ useHandCursor: true });

    this.add.text(button.x, button.y, "BACK TO MENU", {
      fontFamily: "'Bebas Neue', 'Noto Sans JP', sans-serif",
      fontSize: "44px",
      color: "#101f45",
    }).setOrigin(0.5, 0.55);

    button.on("pointerup", () => {
      this.scene.start(SCENE_KEYS.MAIN_MENU);
    });

    this.input.keyboard?.once("keydown-ENTER", () => {
      this.scene.start(SCENE_KEYS.MAIN_MENU);
    });
  }
}

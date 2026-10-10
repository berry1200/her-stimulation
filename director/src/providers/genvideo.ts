// Generative video providers (text/image to video). The platform does not bundle a
// model: point GENVIDEO_COMMAND at any local or hosted generator, for example a Wan 2.2
// or LTX-2 script, a ComfyUI workflow runner, or a CLI for a hosted API.
//   GENVIDEO_PROVIDER=command
//   GENVIDEO_COMMAND='python gen.py --prompt {prompt} --seconds {seconds} --aspect {aspect} --image {image} --out {out}'
import type { Config } from "../config.ts";
import { runTemplate } from "./command.ts";

export interface GenVideoRequest {
  prompt: string;
  seconds: number;
  aspect: string;
  /** Optional first-frame image (absolute path). */
  image?: string;
}

export interface GenVideoProvider {
  id: string;
  ready: boolean;
  reason?: string;
  generate(req: GenVideoRequest, outFile: string): Promise<void>;
}

export function createGenVideo(config: Config): GenVideoProvider {
  if (config.genVideo.provider === "command") {
    const template = config.genVideo.command;
    return {
      id: "command",
      ready: Boolean(template),
      reason: template ? undefined : "set GENVIDEO_COMMAND (placeholders: {prompt} {seconds} {aspect} {image} {out})",
      async generate(req, outFile) {
        await runTemplate(template, { prompt: req.prompt, seconds: String(req.seconds), aspect: req.aspect, image: req.image ?? "", out: outFile }, 60 * 60 * 1000);
      },
    };
  }
  return {
    id: "none",
    ready: false,
    reason: "no video generator configured (GENVIDEO_PROVIDER=command); the director will use uploaded media and motion graphics",
    async generate() {
      throw new Error("no video generator configured");
    },
  };
}

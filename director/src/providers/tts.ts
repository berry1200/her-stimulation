// Text-to-speech providers. Each writes one audio file and returns its path.
//   none         narration stays as captions only
//   hyperframes  local Kokoro voices through `hyperframes tts` (downloads its model on first use)
//   elevenlabs   ElevenLabs HTTP API (ELEVENLABS_API_KEY)
//   command      any local tool that writes a WAV, e.g. TTS_COMMAND='./speak.sh {text} {out}' (a wrapper around Piper, Chatterbox, Qwen3-TTS...)
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config.ts";
import { tts as hyperframesTts } from "../render/hyperframes.ts";
import { runTemplate } from "./command.ts";

export interface TtsProvider {
  id: string;
  ready: boolean;
  /** Why the provider cannot run, when `ready` is false. */
  reason?: string;
  /** Synthesize `text` to a file next to `outBase` (extension chosen by the provider). */
  synthesize(text: string, outBase: string): Promise<string>;
}

export function createTts(config: Config): TtsProvider {
  const t = config.tts;
  switch (t.provider) {
    case "hyperframes":
      return {
        id: "hyperframes",
        ready: true,
        async synthesize(text, outBase) {
          const out = `${outBase}.wav`;
          await hyperframesTts(config, text, t.voice, out, path.dirname(out));
          return out;
        },
      };
    case "elevenlabs":
      return {
        id: "elevenlabs",
        ready: Boolean(t.elevenLabsKey),
        reason: t.elevenLabsKey ? undefined : "set ELEVENLABS_API_KEY",
        async synthesize(text, outBase) {
          const url = `${t.elevenLabsBaseUrl}/v1/text-to-speech/${encodeURIComponent(t.voice)}?output_format=mp3_44100_128`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "xi-api-key": t.elevenLabsKey, "content-type": "application/json", accept: "audio/mpeg" },
            body: JSON.stringify({ text, model_id: t.elevenLabsModel }),
          });
          if (!res.ok) throw new Error(`ElevenLabs returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
          const out = `${outBase}.mp3`;
          await writeFile(out, new Uint8Array(await res.arrayBuffer()));
          return out;
        },
      };
    case "command":
      return {
        id: "command",
        ready: Boolean(t.command),
        reason: t.command ? undefined : "set TTS_COMMAND (placeholders: {text} {out} {voice})",
        async synthesize(text, outBase) {
          const out = `${outBase}.wav`;
          await runTemplate(t.command, { text, out, voice: t.voice }, 10 * 60 * 1000);
          return out;
        },
      };
    default:
      return {
        id: "none",
        ready: false,
        reason: "no voice provider configured (TTS_PROVIDER=hyperframes|elevenlabs|command); upload a recorded voiceover instead",
        async synthesize() {
          throw new Error("no voice provider configured");
        },
      };
  }
}

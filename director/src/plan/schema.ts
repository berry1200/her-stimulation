// The storyboard ("plan") is the single source of truth for a video.
// The director agent writes it, the UI edits it, and the compiler turns it
// into a HyperFrames project. Everything here is validated before use.
import { z } from "zod";

export const FORMATS = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
} as const;
export type Format = keyof typeof FORMATS;

export const FONT_PRESETS = {
  sans: 'Inter, "Helvetica Neue", Arial, "DejaVu Sans", sans-serif',
  serif: 'Georgia, "Times New Roman", "DejaVu Serif", serif',
  mono: '"JetBrains Mono", "SFMono-Regular", Menlo, "DejaVu Sans Mono", monospace',
  rounded: 'Nunito, "Varela Round", "Arial Rounded MT Bold", "DejaVu Sans", sans-serif',
} as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "use a 6-digit hex colour like #ff5722");
const assetId = z.string().regex(/^a_[a-z0-9]{4,16}$/, "an asset id such as a_7f3k9q");
/** A font preset name, or "asset:<id>" for an uploaded font file. */
const font = z.union([z.enum(["sans", "serif", "mono", "rounded"]), z.string().regex(/^asset:a_[a-z0-9]{4,16}$/)]);

export const TEXT_MOTIONS = ["rise", "fade", "scale", "slide-left", "blur", "words", "none"] as const;
export const MEDIA_MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "dolly-in", "crash-zoom", "drift", "none"] as const;
export const TRANSITIONS = ["cut", "fade", "slide-up", "zoom", "wipe", "flash", "whip"] as const;
export const GRADES = ["none", "cinematic", "noir", "warm", "cool", "vivid", "matte"] as const;
export const SCENE_KINDS = ["title", "statement", "media", "list", "stat", "quote", "cta", "custom"] as const;

export const MediaSchema = z.object({
  assetId,
  /** Seconds into the source video to start from (video only). */
  start: z.number().min(0).optional(),
  fit: z.enum(["cover", "contain"]).optional(),
  motion: z.enum(MEDIA_MOTIONS).optional(),
  /** Play the clip's own audio (video only). Default false. */
  withAudio: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
});

export const SceneSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and dashes"),
  kind: z.enum(SCENE_KINDS),
  duration: z.number().min(0.5).max(120),
  heading: z.string().max(160).optional(),
  body: z.string().max(500).optional(),
  items: z.array(z.string().max(140)).max(6).optional(),
  stat: z
    .object({
      value: z.number(),
      prefix: z.string().max(4).optional(),
      suffix: z.string().max(8).optional(),
      label: z.string().max(120).optional(),
    })
    .optional(),
  attribution: z.string().max(120).optional(),
  media: MediaSchema.optional(),
  background: z
    .object({
      color: hex.optional(),
      assetId: assetId.optional(),
      /** 0-1 darkening layer over a background image/video so text stays readable. */
      overlay: z.number().min(0).max(1).optional(),
    })
    .optional(),
  textMotion: z.enum(TEXT_MOTIONS).optional(),
  transition: z.enum(TRANSITIONS).optional(),
  /** Narration for this scene. Captions are generated from it. */
  voiceover: z.string().max(800).optional(),
  /** Audio asset (generated or uploaded) that speaks the voiceover. */
  voiceoverAssetId: assetId.optional(),
  captions: z.boolean().optional(),
  /** Free-form director notes, never rendered. */
  notes: z.string().max(500).optional(),
});

export const StyleSchema = z.object({
  palette: z.object({
    background: hex,
    surface: hex,
    text: hex,
    muted: hex,
    accent: hex,
  }),
  fontHeading: font,
  fontBody: font,
  /** Corner radius for cards and panels, in px at 1080 wide. */
  radius: z.number().min(0).max(80).optional(),
  /** Film finish over the whole video: colour grade, grain, vignette and (16:9 only) 2.39:1 letterbox bars. */
  look: z
    .object({
      grade: z.enum(GRADES).optional(),
      grain: z.number().min(0).max(1).optional(),
      vignette: z.number().min(0).max(1).optional(),
      letterbox: z.boolean().optional(),
    })
    .optional(),
  mood: z.string().max(200).optional(),
});

export const PlanSchema = z.object({
  title: z.string().min(1).max(120),
  format: z.enum(["9:16", "16:9", "1:1", "4:5"]),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  style: StyleSchema,
  music: z
    .object({
      assetId,
      volume: z.number().min(0).max(1).optional(),
      /** Seconds into the track to start from. */
      start: z.number().min(0).optional(),
    })
    .optional(),
  scenes: z.array(SceneSchema).min(1).max(60),
});

export type Plan = z.infer<typeof PlanSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Style = z.infer<typeof StyleSchema>;

export interface PlanIssue {
  path: string;
  message: string;
}

/** Validate a plan, also checking rules Zod cannot express (unique ids, required fields per kind). */
export function validatePlan(input: unknown): { ok: true; plan: Plan } | { ok: false; issues: PlanIssue[] } {
  const parsed = PlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const plan = parsed.data;
  const issues: PlanIssue[] = [];
  const seen = new Set<string>();
  plan.scenes.forEach((s, i) => {
    const at = `scenes.${i}`;
    if (seen.has(s.id)) issues.push({ path: `${at}.id`, message: `duplicate scene id "${s.id}"` });
    seen.add(s.id);
    if (s.kind === "media" && !s.media) issues.push({ path: `${at}.media`, message: "media scenes need media.assetId" });
    if (s.kind === "list" && !(s.items && s.items.length)) issues.push({ path: `${at}.items`, message: "list scenes need items" });
    if (s.kind === "stat" && !s.stat) issues.push({ path: `${at}.stat`, message: "stat scenes need stat.value" });
    if ((s.kind === "title" || s.kind === "statement" || s.kind === "quote") && !s.heading && !s.body) {
      issues.push({ path: `${at}.heading`, message: `${s.kind} scenes need heading or body text` });
    }
  });
  return issues.length ? { ok: false, issues } : { ok: true, plan };
}

export function totalDuration(plan: Plan): number {
  return plan.scenes.reduce((sum, s) => sum + s.duration, 0);
}

/** Asset ids a plan depends on (for existence checks and copying into the build). */
export function referencedAssets(plan: Plan): string[] {
  const ids = new Set<string>();
  const fontAsset = (f: string) => (f.startsWith("asset:") ? f.slice(6) : null);
  for (const f of [plan.style.fontHeading, plan.style.fontBody]) {
    const id = fontAsset(f);
    if (id) ids.add(id);
  }
  if (plan.music) ids.add(plan.music.assetId);
  for (const s of plan.scenes) {
    if (s.media) ids.add(s.media.assetId);
    if (s.background?.assetId) ids.add(s.background.assetId);
    if (s.voiceoverAssetId) ids.add(s.voiceoverAssetId);
  }
  return [...ids];
}

/** JSON Schema for the plan, used as the agent tool's input schema. */
export function planJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(PlanSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export const DEFAULT_STYLE: Style = {
  palette: { background: "#0d0d0d", surface: "#1a1a1a", text: "#f5f5f5", muted: "#a3a3a3", accent: "#ff5722" },
  fontHeading: "sans",
  fontBody: "sans",
  radius: 24,
};

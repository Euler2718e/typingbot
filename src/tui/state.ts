import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { PromptPreferences, SessionSettings } from "../core/types";

export interface TuiFormState {
  assignment: string;
  performance: string;
  settings: SessionSettings;
  promptPreferences: PromptPreferences;
}

export const defaultSettings: SessionSettings = {
  durationMinutes: 60,
  wpm: 85,
  countdownSeconds: 7,
  planningPercent: 15,
  draftingPercent: 60,
  polishingPercent: 25,
  correctedTypos: true,
  rhythmProfile: "natural",
  variationPercent: 62,
  hesitationPercent: 54,
  typosPerThousand: 12,
  correctionDelayMs: 180,
  editPauseMs: 520,
  absorbKeystrokes: true,
  thinkingIntensity: 60,
  correctionNavMs: 26,
};

export const defaultFormState: TuiFormState = {
  assignment: "",
  performance: "",
  settings: defaultSettings,
  promptPreferences: { revisionDensity: "deep", writingStyle: null },
};

export function defaultStatePath(): string {
  const configRoot = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(configRoot, "typingbot", "state.json");
}

export async function loadFormState(path = defaultStatePath()): Promise<TuiFormState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<TuiFormState>;
    return normalizeFormState(parsed);
  } catch {
    return structuredClone(defaultFormState);
  }
}

export async function saveFormState(state: TuiFormState, path = defaultStatePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalizeFormState(state), null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export function normalizeFormState(state: Partial<TuiFormState>): TuiFormState {
  const settings = { ...defaultSettings, ...(state.settings ?? {}) };
  const rhythmProfile = settings.rhythmProfile;
  const revisionDensity = state.promptPreferences?.revisionDensity;
  const writingStyle = state.promptPreferences?.writingStyle;
  return {
    assignment: typeof state.assignment === "string" ? state.assignment : "",
    performance: typeof state.performance === "string" ? state.performance : "",
    settings: {
      durationMinutes: clamp(settings.durationMinutes, 1, 480),
      wpm: Math.round(clamp(settings.wpm, 20, 220)),
      countdownSeconds: Math.round(clamp(settings.countdownSeconds, 3, 30)),
      planningPercent: clamp(settings.planningPercent, 0, 100),
      draftingPercent: clamp(settings.draftingPercent, 0, 100),
      polishingPercent: clamp(settings.polishingPercent, 0, 100),
      correctedTypos: Boolean(settings.correctedTypos),
      rhythmProfile: rhythmProfile === "steady" || rhythmProfile === "reflective" ? rhythmProfile : "natural",
      variationPercent: Math.round(clamp(settings.variationPercent, 0, 100)),
      hesitationPercent: Math.round(clamp(settings.hesitationPercent, 0, 100)),
      typosPerThousand: Math.round(clamp(settings.typosPerThousand, 0, 50)),
      correctionDelayMs: Math.round(clamp(settings.correctionDelayMs, 40, 1200)),
      editPauseMs: Math.round(clamp(settings.editPauseMs, 0, 3000)),
      absorbKeystrokes: Boolean(settings.absorbKeystrokes),
      thinkingIntensity: Math.round(clamp(settings.thinkingIntensity, 0, 100)),
      correctionNavMs: Math.round(clamp(settings.correctionNavMs, 4, 200)),
    },
    promptPreferences: {
      revisionDensity: revisionDensity === "light" || revisionDensity === "balanced" ? revisionDensity : "deep",
      writingStyle: typeof writingStyle === "number" && Number.isInteger(writingStyle) && writingStyle >= 1 && writingStyle <= 30
        ? writingStyle
        : null,
    },
  };
}

function clamp(value: unknown, minimum: number, maximum: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

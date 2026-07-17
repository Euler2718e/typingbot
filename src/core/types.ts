export const SCRIPT_VERSION = "1.0" as const;

export type Phase = "planning" | "drafting" | "polishing";

export interface PerformanceScript {
  version: typeof SCRIPT_VERSION;
  title: string;
  finalText: string;
  actions: PerformanceAction[];
}

interface ActionBase {
  phase: Phase;
  effort?: number;
  note?: string;
}

export type PerformanceAction =
  | (ActionBase & { op: "append"; text: string })
  | (ActionBase & { op: "replace"; find: string; text: string })
  | (ActionBase & { op: "delete"; find: string })
  | (ActionBase & { op: "move"; find: string; after: string | null })
  | (ActionBase & { op: "clear" })
  | (ActionBase & { op: "pause" });

export interface SessionSettings {
  durationMinutes: number;
  wpm: number;
  countdownSeconds: number;
  planningPercent: number;
  draftingPercent: number;
  polishingPercent: number;
  correctedTypos: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    actions: number;
    finalCharacters: number;
    typedCharacters: number;
    phaseActions: Record<Phase, number>;
  };
}

export type SessionState = "idle" | "countdown" | "running" | "paused" | "completed" | "stopped" | "error";

export interface SessionStatus {
  state: SessionState;
  phase: Phase | null;
  actionIndex: number;
  actionCount: number;
  elapsedMs: number;
  targetDurationMs: number;
  message: string;
  targetApplication: string | null;
}

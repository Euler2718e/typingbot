import {
  SCRIPT_VERSION,
  type PerformanceAction,
  type PerformanceScript,
  type Phase,
  type SessionSettings,
  type ValidationResult,
} from "./types";

const phases: Phase[] = ["planning", "drafting", "polishing"];
const operations = new Set(["append", "replace", "delete", "move", "clear", "pause"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countOccurrences(source: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function applyAction(document: string, action: PerformanceAction): string {
  switch (action.op) {
    case "append":
      return document + action.text;
    case "clear":
      return "";
    case "pause":
      return document;
    case "replace": {
      const index = document.indexOf(action.find);
      return document.slice(0, index) + action.text + document.slice(index + action.find.length);
    }
    case "delete": {
      const index = document.indexOf(action.find);
      return document.slice(0, index) + document.slice(index + action.find.length);
    }
    case "move": {
      const sourceIndex = document.indexOf(action.find);
      let without = document.slice(0, sourceIndex) + document.slice(sourceIndex + action.find.length);
      if (action.after === null) return action.find + without;
      const anchorIndex = without.indexOf(action.after);
      const insertAt = anchorIndex + action.after.length;
      without = without.slice(0, insertAt) + action.find + without.slice(insertAt);
      return without;
    }
  }
}

export function parsePerformanceScript(raw: string): PerformanceScript {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`);
  }
  if (!isRecord(value)) throw new Error("The performance must be a JSON object");
  return value as unknown as PerformanceScript;
}

export function validatePerformanceScript(script: PerformanceScript, settings?: SessionSettings): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const phaseActions: Record<Phase, number> = { planning: 0, drafting: 0, polishing: 0 };
  let typedCharacters = 0;

  if (script.version !== SCRIPT_VERSION) errors.push(`version must be ${SCRIPT_VERSION}`);
  if (typeof script.title !== "string" || !script.title.trim()) errors.push("title is required");
  if (typeof script.finalText !== "string" || !script.finalText.length) errors.push("finalText is required");
  if (!Array.isArray(script.actions) || script.actions.length < 3) errors.push("at least three actions are required");
  if (Array.isArray(script.actions) && script.actions.length > 250) errors.push("actions may not exceed 250");

  let document = "";
  let lastPhaseIndex = 0;
  for (const [index, unknownAction] of (Array.isArray(script.actions) ? script.actions : []).entries()) {
    const label = `action ${index + 1}`;
    if (!isRecord(unknownAction)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const action = unknownAction as unknown as PerformanceAction;
    if (!operations.has(action.op)) {
      errors.push(`${label} has an unsupported op`);
      continue;
    }
    if (!phases.includes(action.phase)) {
      errors.push(`${label} has an invalid phase`);
      continue;
    }
    const phaseIndex = phases.indexOf(action.phase);
    if (phaseIndex < lastPhaseIndex) errors.push(`${label} moves backwards from ${phases[lastPhaseIndex]} to ${action.phase}`);
    lastPhaseIndex = Math.max(lastPhaseIndex, phaseIndex);
    phaseActions[action.phase] += 1;

    if (action.effort !== undefined && (!Number.isInteger(action.effort) || action.effort < 1 || action.effort > 5)) {
      errors.push(`${label} effort must be an integer from 1 to 5`);
    }
    if (action.op === "append") {
      if (typeof action.text !== "string" || !action.text) errors.push(`${label} text is required`);
      else typedCharacters += action.text.length;
    }
    if (action.op === "replace") {
      if (typeof action.find !== "string" || !action.find) errors.push(`${label} find is required`);
      if (typeof action.text !== "string") errors.push(`${label} text must be a string`);
      typedCharacters += typeof action.text === "string" ? action.text.length : 0;
    }
    if (action.op === "delete" || action.op === "move") {
      if (typeof action.find !== "string" || !action.find) errors.push(`${label} find is required`);
    }
    if (action.op === "move" && action.after !== null && typeof action.after !== "string") {
      errors.push(`${label} after must be a string or null`);
    }

    if (errors.some((error) => error.startsWith(label))) continue;
    if ("find" in action) {
      const occurrences = countOccurrences(document, action.find);
      if (occurrences !== 1) {
        errors.push(`${label} find must match exactly once, found ${occurrences}`);
        continue;
      }
    }
    if (action.op === "move" && action.after !== null) {
      const withoutSource = document.replace(action.find, "");
      const occurrences = countOccurrences(withoutSource, action.after);
      if (occurrences !== 1) {
        errors.push(`${label} after must match exactly once after removing find, found ${occurrences}`);
        continue;
      }
    }
    document = applyAction(document, action);
  }

  if (!errors.length && document !== script.finalText) {
    errors.push("the simulated document does not exactly equal finalText");
  }
  for (const phase of phases) {
    if (phaseActions[phase] === 0) warnings.push(`${phase} has no actions`);
  }
  if (settings) {
    const estimatedTypingSeconds = (typedCharacters / 5 / Math.max(settings.wpm, 1)) * 60;
    const targetSeconds = settings.durationMinutes * 60;
    if (estimatedTypingSeconds > targetSeconds * 0.9) {
      warnings.push("The performance is dense for this duration and WPM; increase time or speed for natural pauses");
    }
    const split = settings.planningPercent + settings.draftingPercent + settings.polishingPercent;
    if (Math.abs(split - 100) > 0.01) errors.push("phase percentages must total 100");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      actions: Array.isArray(script.actions) ? script.actions.length : 0,
      finalCharacters: typeof script.finalText === "string" ? script.finalText.length : 0,
      typedCharacters,
      phaseActions,
    },
  };
}

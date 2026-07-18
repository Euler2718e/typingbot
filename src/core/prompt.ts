import { getWritingStyle } from "./styles";
import type { PromptPreferences, RevisionDensity, SessionSettings } from "./types";

export const PERFORMANCE_PROMPT = `You are generating a deterministic writing-process performance for TypingBot, a local desktop tool used for writing demonstrations, accessibility workflows, and screen recordings.

The user will place their writing request after this prompt. Produce only one valid JSON object. Do not use Markdown fences, comments, or explanatory text.

Your output must match this shape exactly:
{
  "version": "1.0",
  "title": "short descriptive title",
  "finalText": "the exact complete final answer",
  "actions": [
    { "op": "append", "phase": "planning", "text": "rough notes", "effort": 1-5, "note": "short intent" },
    { "op": "clear", "phase": "drafting", "effort": 1-5, "note": "start the document" },
    { "op": "append", "phase": "drafting", "text": "draft text", "effort": 1-5, "note": "short intent" },
    { "op": "replace", "phase": "drafting", "find": "unique exact text", "text": "replacement", "effort": 1-5, "note": "short intent" },
    { "op": "delete", "phase": "drafting", "find": "unique exact text", "effort": 1-5, "note": "short intent" },
    { "op": "move", "phase": "drafting", "find": "unique exact text", "after": "unique exact anchor or null for beginning", "effort": 1-5, "note": "short intent" },
    { "op": "pause", "phase": "polishing", "effort": 1-5, "note": "reread" }
  ]
}

Hard requirements:
1. finalText is the best complete response to the user's writing request. It is authoritative and must contain no planning notes.
2. Simulating actions from an empty document must end with a document byte-for-byte equal to finalText.
3. Every find string and every non-null after string must match exactly once at the moment its action runs. Use long, distinctive substrings when necessary.
4. Phases never move backwards: planning, then drafting, then polishing.
5. Follow the exact phase allocation and session behavior in the separate SESSION SETTINGS block.
6. Planning must follow the selected style's planning method. Planning is visible scratch work, not polished prose: keep it terse, fragmentary, and clearly different from finalText. Test multiple directions, insert pause actions between thought groups, and clear the scratch work before the real draft so none of it survives into finalText.
7. Draft according to the selected style's drafting method. Unless finalText is under 80 words, never enter the entire final document in one append. Build in blocks of one to four sentences, reread with pause actions, and revise as the document develops. Vary block size instead of repeating an identical append pattern. Separate paragraphs with a blank line (\\n\\n).
8. Polishing fixes every remaining spelling, grammar, punctuation, formatting, and factual-consistency issue. No intentional mistake may remain.
9. Use a revision-rich action count appropriate to final length: 16-30 actions below 250 words, 30-65 actions from 250-800 words, and 55-120 actions above 800 words. The separate REVISION DENSITY instruction may raise or lower this within the 250-action limit.
10. Keep total JSON reasonably compact. Never repeat the entire document in replacement text unless the document is very short.
11. Do not claim external research or invent citations unless the user's request supplies sources or explicitly asks you to research them.
12. The performance is transparent automation. Do not describe it as proof of human authorship or as a method for evading review, monitoring, or academic-integrity rules.
13. Make the decision path non-linear but purposeful: test alternate openings, leave at least one fragment unused, rewrite weak sentences rather than only correcting words, and use delete or move for genuine structural changes.
14. Notes describe observable writing intent in plain language. Do not include hidden reasoning, private chain-of-thought, or claims about emotions or experiences the user did not supply.
15. Use "pause" actions generously in planning and drafting to represent genuine thinking and rereading, and sparingly in polishing for a final proofread. They carry no text and exist to shape the rhythm of the session.
16. During polishing, consolidate structure the way a person tidying a draft would: reorder sentences or paragraphs with "move", merge or split ideas, and make targeted "replace" and "delete" edits rather than only fixing single words.

Before returning JSON, privately simulate every action, verify all anchors are unique at their exact step, and verify the resulting text equals finalText exactly.`;

export function buildPerformancePrompt(
  request: string,
  preferences: PromptPreferences,
  settings: SessionSettings,
): string {
  const style = preferences.writingStyle === null ? null : getWritingStyle(preferences.writingStyle);
  if (!style) throw new Error("Choose a writing style from 1 to 30 before copying the prompt");

  const typoBehavior = settings.correctedTypos
    ? `${settings.typosPerThousand} transient corrected typos per 1,000 typed characters`
    : "disabled; do not add intentional misspellings";
  const absorption = settings.absorbKeystrokes
    ? "on; ordinary physical keys are swallowed while command shortcuts stay available"
    : "off; the operator's keyboard remains live";

  return `${PERFORMANCE_PROMPT}

SELECTED WRITING STYLE — REQUIRED:
Style ${String(style.id).padStart(2, "0")}: ${style.name}
Signature: ${style.summary}.
Planning method: ${style.planning}
Drafting method: ${style.drafting}
Revision method: ${style.revising}
Final voice: ${style.voice}
Apply this identity to both the visible process and finalText. Preserve factual accuracy and the user's requested format even when the style is expressive.

REVISION DENSITY:
${revisionInstruction(preferences.revisionDensity)}

SESSION SETTINGS:
- Target runtime: ${settings.durationMinutes} minutes. Use action effort and pause actions to create enough meaningful process for this duration without padding the final answer.
- Base typing speed: ${settings.wpm} WPM.
- Countdown before capture: ${settings.countdownSeconds} seconds.
- Phase allocation: planning ${settings.planningPercent}%, drafting ${settings.draftingPercent}%, polishing ${settings.polishingPercent}%. Distribute action effort accordingly.
- Rhythm profile: ${settings.rhythmProfile}. Shape sentence blocks and pause placement to match it.
- Speed variation: ${settings.variationPercent}%. Use ${variationGuidance(settings.variationPercent)} action-block variation.
- Hesitation: ${settings.hesitationPercent}%. Use ${hesitationGuidance(settings.hesitationPercent)} pause frequency, especially before consequential choices.
- Thinking depth: ${settings.thinkingIntensity}%. Make planning alternatives and revisions proportionate to this depth.
- Engine typo behavior: ${typoBehavior}. The engine creates and repairs transient motor errors; finalText and action text must always be correctly spelled.
- Correction delay: ${settings.correctionDelayMs} ms; pause before edits: ${settings.editPauseMs} ms; correction travel: ${settings.correctionNavMs} ms per key. Prefer distinctive anchors and meaningful edits so visible navigation remains legible.
- Keyboard absorption: ${absorption}. This affects playback controls, not the content.

USER WRITING REQUEST:
${request.trim() || "[Paste your writing request here before sending.]"}`;
}

export function revisionInstruction(value: RevisionDensity): string {
  if (value === "light") {
    return "Use 10-20 meaningful actions per 500 final words. Include at least one deletion and two replacements.";
  }
  if (value === "balanced") {
    return "Use 20-38 meaningful actions per 500 final words. Include sentence rewrites, one abandoned paragraph, and at least one move.";
  }
  return "Use 35-60 meaningful actions per 500 final words, within the 250-action limit. Build paragraphs in pieces, abandon multiple candidate lines, rewrite several sentences, delete at least one whole paragraph, and move or combine material at least twice. Every change must advance the visible draft rather than repeat cosmetic edits.";
}

function variationGuidance(value: number): string {
  if (value < 34) return "mostly consistent";
  if (value < 67) return "noticeably varied";
  return "strongly varied";
}

function hesitationGuidance(value: number): string {
  if (value < 34) return "sparse";
  if (value < 67) return "regular";
  return "frequent";
}

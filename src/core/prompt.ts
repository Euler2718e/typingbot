import type { RevisionDensity } from "./types";

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
5. Planning is around 15 percent of effort. Drafting is around 60 percent. Polishing is around 25 percent.
6. Planning notes are visibly typed first, entirely lowercase, terse, fragmentary, and imperfect. Include questions, alternatives, and ideas that are later abandoned. Clear them before the real draft begins.
7. Draft recursively in blocks of one to four sentences. Unless finalText is under 80 words, never enter the entire final document in one append. Establish a rough section, reread it, then revise or continue. Vary block size instead of repeating an identical append pattern.
8. Polishing fixes every remaining spelling, grammar, punctuation, formatting, and factual-consistency issue. No intentional mistake may remain.
9. Use a revision-rich action count appropriate to final length: 16-30 actions below 250 words, 30-65 actions from 250-800 words, and 55-120 actions above 800 words. The separate REVISION DENSITY instruction may raise or lower this within the 250-action limit.
10. Keep total JSON reasonably compact. Never repeat the entire document in replacement text unless the document is very short.
11. Do not claim external research or invent citations unless the user's request supplies sources or explicitly asks you to research them.
12. The performance is transparent automation. Do not describe it as proof of human authorship or as a method for evading review, monitoring, or academic-integrity rules.
13. Make the decision path non-linear but purposeful: test alternate openings, leave at least one fragment unused, rewrite weak sentences rather than only correcting words, and use delete or move for genuine structural changes.
14. Notes describe observable writing intent in plain language. Do not include hidden reasoning, private chain-of-thought, or claims about emotions or experiences the user did not supply.

Before returning JSON, privately simulate every action, verify all anchors are unique at their exact step, and verify the resulting text equals finalText exactly.`;

export function revisionInstruction(value: RevisionDensity): string {
  if (value === "light") {
    return "Use 10-20 meaningful actions per 500 final words. Include at least one deletion and two replacements.";
  }
  if (value === "balanced") {
    return "Use 20-38 meaningful actions per 500 final words. Include sentence rewrites, one abandoned paragraph, and at least one move.";
  }
  return "Use 35-60 meaningful actions per 500 final words, within the 250-action limit. Build paragraphs in pieces, abandon multiple candidate lines, rewrite several sentences, delete at least one whole paragraph, and move or combine material at least twice. Every change must advance the visible draft rather than repeat cosmetic edits.";
}

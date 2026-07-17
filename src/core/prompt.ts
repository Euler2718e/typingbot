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
7. Draft recursively. Do not merely type the final text in one append. Build sections, reconsider wording, remove at least one unused idea, and make at least two meaningful structural or sentence-level revisions.
8. Polishing fixes every remaining spelling, grammar, punctuation, formatting, and factual-consistency issue. No intentional mistake may remain.
9. Include 12 to 60 actions depending on text length. Prefer fewer meaningful edits over repetitive cosmetic operations.
10. Keep total JSON reasonably compact. Never repeat the entire document in replacement text unless the document is very short.
11. Do not claim external research or invent citations unless the user's request supplies sources or explicitly asks you to research them.
12. The performance is transparent automation. Do not describe it as proof of human authorship or as a method for evading review, monitoring, or academic-integrity rules.

Before returning JSON, privately simulate every action, verify all anchors are unique at their exact step, and verify the resulting text equals finalText exactly.`;

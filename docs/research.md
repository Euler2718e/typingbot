# Design research

TypingBot models a visible composition process for demonstrations and accessibility workflows. It does not claim to reproduce a particular person's cognition or prove human authorship.

## Composition model

Writing research describes planning, text production, and reviewing as recursive processes, not a clean linear pipeline. TypingBot keeps three broad time budgets for a legible session while allowing multiple edits inside drafting and polishing.

- Hayes and Flower's influential model separates planning, transcribing, and reviewing, with planning itself covering goal setting, idea generation, and organization. Later work emphasizes that these processes interact recursively: [review of writing-process models](https://pmc.ncbi.nlm.nih.gov/articles/PMC10150652/)
- Sentence boundaries are common locations for evaluation and forward planning, and revision shifts from surface corrections toward deeper content changes as writers develop: [keystroke-process discussion](https://pmc.ncbi.nlm.nih.gov/articles/PMC10203585/)
- Writing strategy research distinguishes thinking, planning, revision, and monitoring while treating their interaction as cognitively demanding: [writing-strategy validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC8287024/)

These findings informed the recursive action language, phase-weighted pauses, paragraph-level replacement and movement, and additional delays around punctuation and line breaks. They do not justify pretending the playback is evidence of human work.

## Pausing and structure

Keystroke-logging research finds that pauses at sentence boundaries reflect global planning and last longer than word-boundary pauses, which reflect lexical access, and that longer or more frequent pauses signal higher cognitive load. Writers also read the prompt and plan before producing text, and word-processor writing tends to be fragmentary with early revision rather than a single linear pass.

- [Understanding the keystroke log: the effect of writing task on keystroke features](https://link.springer.com/article/10.1007/s11145-019-09953-8)
- [Using keystroke logging to understand writers' processes](https://link.springer.com/article/10.1186/s40468-017-0040-5)

TypingBot applies this by drawing its longest in-typing pauses at sentence-ending punctuation and line breaks, taking long deliberate "thinking" pauses in planning and drafting, typing planning notes in a quicker, low-hesitation "jotting" cadence, and prompting the model to lay planning out as a short structured outline and to draft section by section rather than as one unstructured run of text. Newlines are entered as Shift+Enter so soft line breaks never submit a chat form.

## Typing errors

Studies of keystroke data describe a small set of error types that account for most human typos: substitution (an adjacent key), transposition (two adjacent letters swapped, often across hands), insertion, and doubling. Adjacent-key substitution is the single most frequent error. On a physical keyboard, spaces between words are rarely omitted; missing spaces are mainly a touchscreen phenomenon. Typists usually notice a slip within a keystroke or two and backspace to repair it.

- [Simulating Errors in Touchscreen Typing](https://arxiv.org/abs/2502.03560)
- [Types of Typing Errors and What Causes Each One](https://likelytypo.com/articles/types-of-typing-errors.html)

TypingBot's error model reflects this: transient mistakes land only on letters (never spaces), mix adjacent-key substitution, transposition, and doubling, and are noticed either immediately or after a letter or two before being backspaced and retyped. Every planned error sequence is unit tested to net back exactly to the intended text.

## Terminal architecture

- OpenTUI supplies the terminal renderer, responsive layout primitives, text inputs, and keyboard events: [OpenTUI repository](https://github.com/sst/opentui)
- Enigo supplies local keyboard-event simulation on Windows, macOS, and Linux: [Enigo documentation](https://docs.rs/enigo/latest/enigo/)
- rdev installs the global keyboard grab that absorbs the operator's real keystrokes and keeps the pause, resume, and stop controls live from anywhere. It runs on the engine's main thread and also serves the global toggle shortcut: [rdev documentation](https://docs.rs/rdev/latest/rdev/)
- The terminal frontend and native engine communicate over newline-delimited JSON on local standard input and output. The release contains ordinary executables, not an application bundle or WebView.

## Safety choices

- The destination is captured after a countdown.
- Playback pauses when the foreground application changes, and a transient window-query failure never aborts a run.
- Global shortcuts toggle pause and resume and stop the performance from any application.
- Physical keyboard input may be absorbed during playback so it cannot reach the destination document. Absorbed keystrokes are discarded locally and never recorded, stored, or transmitted; absorption can be disabled per session.
- The complete script is simulated locally before the first external input event.
- The app contains no HTTP client and makes no runtime network requests.

# Design research

TypingBot models a visible composition process for demonstrations and accessibility workflows. It does not claim to reproduce a particular person's cognition or prove human authorship.

## Composition model

Writing research describes planning, text production, and reviewing as recursive processes, not a clean linear pipeline. TypingBot keeps three broad time budgets for a legible session while allowing multiple edits inside drafting and polishing.

- Hayes and Flower's influential model separates planning, transcribing, and reviewing, with planning itself covering goal setting, idea generation, and organization. Later work emphasizes that these processes interact recursively: [review of writing-process models](https://pmc.ncbi.nlm.nih.gov/articles/PMC10150652/)
- Sentence boundaries are common locations for evaluation and forward planning, and revision shifts from surface corrections toward deeper content changes as writers develop: [keystroke-process discussion](https://pmc.ncbi.nlm.nih.gov/articles/PMC10203585/)
- Writing strategy research distinguishes thinking, planning, revision, and monitoring while treating their interaction as cognitively demanding: [writing-strategy validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC8287024/)

These findings informed the recursive action language, phase-weighted pauses, paragraph-level replacement and movement, and additional delays around punctuation and line breaks. They do not justify pretending the playback is evidence of human work.

## Desktop architecture

- Tauri provides native system-tray APIs and desktop packaging: [Tauri system tray](https://v2.tauri.app/learn/system-tray/)
- Tauri's global-shortcut plugin supports Windows, macOS, and Linux: [global shortcut documentation](https://v2.tauri.app/plugin/global-shortcut/)
- Enigo supplies local keyboard-event simulation on Windows, macOS, and Linux: [Enigo documentation](https://docs.rs/enigo/latest/enigo/)
- The release matrix follows Tauri's documented GitHub Actions distribution path: [Tauri GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/)

## Safety choices

- The destination is captured after a countdown.
- Playback pauses when the foreground application changes.
- A global shortcut toggles pause and resume.
- Physical keyboard input is not captured or suppressed.
- The complete script is simulated locally before the first external input event.
- The app contains no HTTP client and makes no runtime network requests.

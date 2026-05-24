import Foundation

// Research-backed human typing simulator.
//
// Key sources:
//   - "Observations on Typing from 136M Keystrokes" (Aalto 2018): log-logistic IKI distribution
//   - "Prosodic Boundaries in Writing" (Frontiers 2016): +13-23% pause at clause/sentence breaks
//   - "Digraph cost estimation for keyboard layouts" (IJHCS 2015): same-hand ~22% slower
//   - Averaged error rate ~2.5-3% adjacent-key; ~1.5% transposition; 60% immediate / 40% delayed

private let adjacent: [Character: String] = [
    "q": "wa",    "w": "qase",  "e": "wsdr",  "r": "edft",  "t": "rfgy",
    "y": "tghu",  "u": "yhji",  "i": "ujko",  "o": "iklp",  "p": "ol",
    "a": "qwsz",  "s": "awedxz","d": "serfcx","f": "drtgvc","g": "ftyhbv",
    "h": "gyujnb","j": "huikmn","k": "jiolm", "l": "kop",
    "z": "asx",   "x": "zsdc",  "c": "xdfv",  "v": "cfgb",  "b": "vghn",
    "n": "bhjm",  "m": "njk",
    "1": "2q",    "2": "1qw3",  "3": "2we4",  "4": "3er5",  "5": "4rt6",
    "6": "5ty7",  "7": "6yu8",  "8": "7ui9",  "9": "8io0",  "0": "9op",
]

// Common short function words typed faster (muscle memory, high frequency)
private let shortWords: Set<String> = [
    "a","an","the","is","it","in","on","at","to","of","or",
    "and","but","so","do","go","he","she","we","be","as","by",
    "up","if","no","my","me","us","its","for","not","are","was",
]

private let sentenceEnd: Set<Character> = [".", "!", "?"]
private let clauseBreak: Set<Character> = [",", ";", ":"]
private let wordSeparators: Set<Character> = [" ", "\n", "\t", ".", ",", ";", ":", "!", "?", "\"", "'", "(", ")", "[", "]", "{", "}"]

// QWERTY left-hand keys (home row + upper + lower rows, left side).
// Used for digraph timing: same-hand pairs are measurably slower.
private let leftHand: Set<Character> = [
    "q","w","e","r","t","a","s","d","f","g","z","x","c","v","b",
    "Q","W","E","R","T","A","S","D","F","G","Z","X","C","V","B",
    "1","2","3","4","5","!","@","#","$","%",
]

struct HumanSim {
    let settings: Settings

    private struct WordProfile {
        let word: String
        let difficulty: Double

        var isEasy: Bool { difficulty <= 0.28 }
        var typingFactor: Double {
            if isEasy { return 0.58 }
            return 0.82 + (difficulty * 0.72)
        }

        var errorFactor: Double {
            if isEasy { return 0.18 }
            return 0.35 + (difficulty * 1.85)
        }
    }

    struct BurstState {
        var charsLeft:      Int       = 0
        var countdown:      Int       = Int.random(in: 8...20)
        var afterBurstPause: Bool     = false   // inject recovery pause on next char
        var prevChar:       Character? = nil    // for digraph timing
    }

    // ── Timing ─────────────────────────────────────────────────────────────────

    private func baseDelay() -> Double {
        60.0 / Double(max(10, min(300, settings.wpm)) * 5)
    }

    // Log-normal IKI: median at 1.0, heavy right tail (occasional 2-4× outliers).
    // Empirical data (136M keystrokes study) shows log-logistic/log-normal fits
    // far better than Gaussian for real keystroke inter-key intervals.
    private func sleep(factor: Double = 1.0, digraph: Double = 1.0) async throws {
        var delay = baseDelay() * factor * digraph
        if settings.variableSpeed {
            let u1    = Double.random(in: Double.ulpOfOne...1.0)
            let u2    = Double.random(in: 0.0...1.0)
            let gauss = sqrt(-2.0 * log(u1)) * cos(2.0 * .pi * u2)
            // σ=0.40 keeps median at 1.0 but produces the visible long-tail
            // swings that characterize real typing (occasional ~3× slowdowns)
            let jitter = min(4.2, max(0.18, exp(0.40 * gauss)))
            delay *= jitter
        }
        try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
    }

    // Prosodic boundary pauses (Frontiers 2016):
    //   sentence-end: +180-420ms  (β coefficient +23%)
    //   clause-break: +80-200ms   (β coefficient +13%)
    private func prosodicSleep(for ch: Character) async throws {
        if sentenceEnd.contains(ch) {
            let p = Double.random(in: 0.18...0.42)
            try await Task.sleep(nanoseconds: UInt64(p * 1_000_000_000))
        } else if clauseBreak.contains(ch) {
            let p = Double.random(in: 0.08...0.20)
            try await Task.sleep(nanoseconds: UInt64(p * 1_000_000_000))
        }
    }

    // Digraph timing (IJHCS 2015):
    //   same-hand   → ~22% slower  (finger contention, no parallel preparation)
    //   alt-hand    → ~8% faster   (next finger prepares while current key releases)
    //   word-start / after space → no adjustment (fresh start timing)
    private func digraphFactor(prev: Character?, curr: Character) -> Double {
        guard let p = prev, p != " ", curr != " ", settings.variableSpeed else { return 1.0 }
        return (leftHand.contains(p) == leftHand.contains(curr)) ? 1.22 : 0.92
    }

    private func speedErrorFactor() -> Double {
        let wpm = Double(max(20, min(250, settings.wpm)))
        let factor = 1.15 - ((wpm - 20.0) / 230.0) * 0.75
        return min(1.15, max(0.40, factor))
    }

    private func adjacentTypoChance(for profile: WordProfile) -> Double {
        0.010 * profile.errorFactor * speedErrorFactor()
    }

    private func transpositionChance(for profile: WordProfile) -> Double {
        0.004 * profile.errorFactor * speedErrorFactor()
    }

    // Burst mode: track fast-typing streaks; signal a recovery pause on exit.
    private func isBurst(char: Character, state: inout BurstState) -> Bool {
        guard settings.burstMode else { return false }
        if char == " " {
            state.countdown -= 1
            if state.countdown <= 0 {
                state.charsLeft = Int.random(in: 6...18)
                state.countdown = Int.random(in: 8...22)
            }
        }
        if state.charsLeft > 0 {
            state.charsLeft -= 1
            if state.charsLeft == 0 { state.afterBurstPause = true }
            return true
        }
        return false
    }

    // ── Main entry point ───────────────────────────────────────────────────────
    // Returns extra positions consumed (0 normally; 1 or 2 for delayed corrections
    // that absorb the next 1-2 characters and retype them after fixing the error).

    func typeNext(
        text:       [Character],
        pos:        Int,
        burstState: inout BurstState,
        typeChar:   (Character) async throws -> Void,
        backspace:  ()          async throws -> Void
    ) async throws -> Int {

        let char = text[pos]
        let df   = digraphFactor(prev: burstState.prevChar, curr: char)
        let profile = wordProfile(in: text, at: pos)

        // Track last-typed char for the next digraph calculation.
        // Updated explicitly at each return site.
        var lastTyped = char
        defer { burstState.prevChar = lastTyped }

        // ── Post-burst recovery pause (200-450ms) ─────────────────────────────
        // Simulates the natural slowdown when a fast burst ends and the typist
        // drops back to their base rhythm.
        if burstState.afterBurstPause {
            burstState.afterBurstPause = false
            let r = Double.random(in: 0.20...0.45)
            try await Task.sleep(nanoseconds: UInt64(r * 1_000_000_000))
        }

        // ── Transposition (1.5%) ──────────────────────────────────────────────
        // Realistic sequence: type BOTH chars in wrong order (mistake visible on
        // screen), pause to "notice", delete both, retype correctly.
        if settings.transpositions,
           pos + 1 < text.count,
           text[pos + 1] != "\n",
           !sentenceEnd.contains(char), !clauseBreak.contains(char),
           Double.random(in: 0..<1) < transpositionChance(for: profile) {

            let next = text[pos + 1]
            try await sleep(digraph: df)
            try await typeChar(next)              // wrong: next typed first (mistake visible)
            try await sleep(factor: 0.55)
            try await typeChar(char)              // wrong: char typed second
            // "Noticing" pause: 150-450ms (research: detection lag for transpositions)
            let notice = Double.random(in: 0.15...0.45)
            try await Task.sleep(nanoseconds: UInt64(notice * 1_000_000_000))
            try await backspace()                 // delete char
            try await sleep(factor: 0.22)
            try await backspace()                 // delete next
            try await sleep(factor: 0.28)
            try await typeChar(char)              // correct order
            try await sleep(factor: 0.22)
            try await typeChar(next)              // correct order
            try await sleep()
            lastTyped = next
            return 1
        }

        // ── Adjacent-key typo (2.5%) ──────────────────────────────────────────
        // Error detection literature: ~60% caught immediately, ~25% after 1 more
        // char, ~15% after 2 more chars. Each variant: mistake visible first,
        // then correction — never silently replaced.
        let lower = Character(char.lowercased())
        if settings.typos,
           let nbrs = adjacent[lower],
           Double.random(in: 0..<1) < adjacentTypoChance(for: profile) {

            let wrongLower = Character(String(nbrs.randomElement()!))
            let wrong: Character = char.isUppercase
                ? Character(wrongLower.uppercased()) : wrongLower
            let inBurst   = isBurst(char: char, state: &burstState)
            let errorRoll = Double.random(in: 0..<1)

            // Delayed by 2 chars (~15%)
            if errorRoll >= 0.85,
               pos + 2 < text.count,
               text[pos + 1] != "\n", text[pos + 2] != "\n" {
                let n1 = text[pos + 1], n2 = text[pos + 2]
                try await sleep(factor: inBurst ? 0.50 : 1.0, digraph: df)
                try await typeChar(wrong)         // mistake typed
                try await sleep(factor: 0.88)
                try await typeChar(n1)            // 1st char after mistake (still typing)
                try await sleep(factor: 0.85)
                try await typeChar(n2)            // 2nd char after mistake (still typing)
                let notice = Double.random(in: 0.25...0.65)
                try await Task.sleep(nanoseconds: UInt64(notice * 1_000_000_000))
                try await backspace(); try await sleep(factor: 0.18)   // delete n2
                try await backspace(); try await sleep(factor: 0.18)   // delete n1
                try await backspace(); try await sleep(factor: 0.30)   // delete wrong
                try await typeChar(char)
                try await sleep(factor: 0.42); try await typeChar(n1)
                try await sleep(factor: 0.42); try await typeChar(n2)
                try await prosodicSleep(for: n2)
                lastTyped = n2
                return 2
            }

            // Delayed by 1 char (~25%)
            if errorRoll >= 0.60,
               pos + 1 < text.count,
               text[pos + 1] != "\n" {
                let n1 = text[pos + 1]
                try await sleep(factor: inBurst ? 0.50 : 1.0, digraph: df)
                try await typeChar(wrong)         // mistake typed
                try await sleep(factor: 0.88)
                try await typeChar(n1)            // next char typed before noticing
                let notice = Double.random(in: 0.20...0.55)
                try await Task.sleep(nanoseconds: UInt64(notice * 1_000_000_000))
                try await backspace(); try await sleep(factor: 0.22)   // delete n1
                try await backspace(); try await sleep(factor: 0.30)   // delete wrong
                try await typeChar(char)
                try await sleep(factor: 0.45); try await typeChar(n1)
                try await prosodicSleep(for: n1)
                lastTyped = n1
                return 1
            }

            // Immediate correction (~60%)
            try await sleep(factor: inBurst ? 0.50 : 1.0, digraph: df)
            try await typeChar(wrong)             // mistake visible
            let notice = Double.random(in: 0.08...0.28)
            try await Task.sleep(nanoseconds: UInt64(notice * 1_000_000_000))
            try await backspace()
            try await sleep(factor: 0.35)
            try await typeChar(char)
            try await prosodicSleep(for: char)
            return 0
        }

        // ── Normal typing ─────────────────────────────────────────────────────
        let inBurst = isBurst(char: char, state: &burstState)
        var factor: Double = inBurst ? 0.48 : 1.0
        factor *= profile.typingFactor

        if char == " " {
            // Short function-word speedup: these words are heavily over-learned,
            // so they're typed faster (like a single motor chunk)
            let ws   = wordStart(in: text, before: pos)
            let word = String(text[ws..<pos]).lowercased()
                .trimmingCharacters(in: CharacterSet(charactersIn: ".,!?;:"))
            if shortWords.contains(word) { factor *= 0.70 }

        } else if !inBurst, settings.variableSpeed {
            // Pre-long-word hesitation (40% chance for words ≥8 chars):
            // the brain reads ahead and momentarily pauses before tackling a
            // long unfamiliar word (like "approximately" or "implementation")
            if isStartOfLongWord(in: text, at: pos) && Double.random(in: 0..<1) < (0.18 + profile.difficulty * 0.35) {
                let pre = Double.random(in: 0.05...0.16)
                try await Task.sleep(nanoseconds: UInt64(pre * 1_000_000_000))
            }
        }

        try await sleep(factor: factor, digraph: df)
        try await typeChar(char)

        // Post-space hesitation (5%): simulates reading-ahead getting stuck —
        // the brain hits the space bar but hasn't pre-buffered the next word yet
        if char == " ", settings.variableSpeed, Double.random(in: 0..<1) < 0.05 {
            let h = Double.random(in: 0.28...0.85)
            try await Task.sleep(nanoseconds: UInt64(h * 1_000_000_000))
        }

        try await prosodicSleep(for: char)
        return 0
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private func wordStart(in text: [Character], before pos: Int) -> Int {
        var i = pos - 1
        while i > 0 && text[i - 1] != " " { i -= 1 }
        return max(0, i)
    }

    private func wordProfile(in text: [Character], at pos: Int) -> WordProfile {
        let bounds = wordBounds(in: text, at: pos)
        guard bounds.start < bounds.end else {
            return WordProfile(word: "", difficulty: 0.25)
        }

        let raw = String(text[bounds.start..<bounds.end])
        let word = raw.lowercased()
        let length = word.count

        if shortWords.contains(word) {
            return WordProfile(word: word, difficulty: 0.08)
        }

        let uncommon = word.filter { ch in
            "qzxjkvw".contains(ch)
        }.count
        let mixedCase = raw.dropFirst().contains { $0.isUppercase }
        let hasDigit = raw.contains { $0.isNumber }
        let longScore = min(1.0, max(0.0, Double(length - 4) / 9.0))
        let uncommonScore = min(0.45, Double(uncommon) * 0.12)
        let shapeScore = (mixedCase ? 0.12 : 0.0) + (hasDigit ? 0.18 : 0.0)
        let difficulty = min(1.0, max(0.0, longScore + uncommonScore + shapeScore))

        return WordProfile(word: word, difficulty: difficulty)
    }

    private func wordBounds(in text: [Character], at pos: Int) -> (start: Int, end: Int) {
        guard pos >= 0, pos < text.count else { return (0, 0) }
        if wordSeparators.contains(text[pos]) {
            return (pos, pos)
        }

        var start = pos
        while start > 0 && !wordSeparators.contains(text[start - 1]) {
            start -= 1
        }

        var end = pos
        while end < text.count && !wordSeparators.contains(text[end]) {
            end += 1
        }

        return (start, end)
    }

    private func isStartOfLongWord(in text: [Character], at pos: Int) -> Bool {
        guard pos == 0 || wordSeparators.contains(text[pos - 1]) else { return false }
        var end = pos
        while end < text.count && !wordSeparators.contains(text[end]) {
            end += 1
        }
        return (end - pos) >= 8
    }
}

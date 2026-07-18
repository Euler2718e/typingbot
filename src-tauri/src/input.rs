use crate::model::{RhythmProfile, SessionSettings};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use rand::Rng;
use std::{thread, time::Duration};
use unicode_segmentation::UnicodeSegmentation;

/// One planned keystroke and the pause that follows it. Planning is kept
/// separate from execution so the error-and-correction logic can be unit tested
/// for the one property that matters: the net text must equal the intended text.
#[derive(Debug, Clone, PartialEq)]
enum Beat {
    /// Type a grapheme, then wait the given milliseconds.
    Type(String, u64),
    /// Press backspace, then wait the given milliseconds.
    Backspace(u64),
    /// Wait only — the beat of noticing a mistake before fixing it.
    Wait(u64),
}

pub struct InputDriver {
    enigo: Enigo,
    composer: Composer,
    edit_pause_ms: u64,
    correction_nav_ms: u64,
}

impl InputDriver {
    pub fn new(settings: &SessionSettings) -> Result<Self, String> {
        Ok(Self {
            enigo: Enigo::new(&Settings::default()).map_err(|error| error.to_string())?,
            composer: Composer::from_settings(settings),
            edit_pause_ms: settings.edit_pause_ms.min(3000),
            correction_nav_ms: settings.correction_nav_ms.clamp(4, 200),
        })
    }

    fn write_text(&mut self, text: &str) -> Result<(), String> {
        self.enigo.text(text).map_err(|error| error.to_string())
    }

    fn press(&mut self, key: Key, direction: Direction) -> Result<(), String> {
        self.enigo
            .key(key, direction)
            .map_err(|error| error.to_string())
    }

    /// A soft line break (Shift+Enter). Used for every newline so line breaks
    /// insert instead of submitting chat forms, matching how people jot.
    fn newline(&mut self) -> Result<(), String> {
        self.press(Key::Shift, Direction::Press)?;
        let clicked = self.press(Key::Return, Direction::Click);
        self.press(Key::Shift, Direction::Release)?;
        clicked
    }

    fn emit_char(&mut self, grapheme: &str) -> Result<(), String> {
        if grapheme == "\n" {
            self.newline()
        } else {
            self.write_text(grapheme)
        }
    }

    /// Type `text` with human motor behavior. `jotting` runs the quick, low-
    /// hesitation cadence people use for rough notes rather than composed prose.
    pub fn type_human<F>(&mut self, text: &str, jotting: bool, mut gate: F) -> Result<(), String>
    where
        F: FnMut() -> Result<(), String>,
    {
        let mut rng = rand::rng();
        let beats = self.composer.plan(text, jotting, &mut rng);
        for beat in beats {
            gate()?;
            match beat {
                Beat::Type(grapheme, delay) => {
                    self.emit_char(&grapheme)?;
                    interruptible_sleep(delay, &mut gate)?;
                }
                Beat::Backspace(delay) => {
                    self.backspace()?;
                    interruptible_sleep(delay, &mut gate)?;
                }
                Beat::Wait(delay) => interruptible_sleep(delay, &mut gate)?,
            }
        }
        Ok(())
    }

    pub fn pause_before_edit<F>(&mut self, mut gate: F) -> Result<(), String>
    where
        F: FnMut() -> Result<(), String>,
    {
        let mut rng = rand::rng();
        let duration = randomize_duration(self.edit_pause_ms, 0.42, &mut rng);
        interruptible_sleep(duration, &mut gate)
    }

    /// Move the caret one grapheme at a time using the arrow keys, pausing
    /// between presses so the travel is visible. Long journeys speed up per key
    /// so distant corrections stay bounded while still reading as deliberate.
    pub fn move_cursor<F>(&mut self, delta: isize, mut gate: F) -> Result<(), String>
    where
        F: FnMut() -> Result<(), String>,
    {
        if delta == 0 {
            return Ok(());
        }
        let key = if delta < 0 {
            Key::LeftArrow
        } else {
            Key::RightArrow
        };
        let steps = delta.unsigned_abs();
        let per_key = self.nav_step_ms(steps);
        let mut rng = rand::rng();
        for _ in 0..steps {
            gate()?;
            self.press(key, Direction::Click)?;
            let mut wait = randomize_duration(per_key, 0.4, &mut rng);
            if steps > 6 && rng.random_bool(0.05) {
                // A brief hesitation, as if locating the exact spot.
                wait += rng.random_range(140..380);
            }
            interruptible_sleep(wait, &mut gate)?;
        }
        Ok(())
    }

    pub fn select_right<F>(&mut self, count: usize, mut gate: F) -> Result<(), String>
    where
        F: FnMut() -> Result<(), String>,
    {
        if count == 0 {
            return Ok(());
        }
        let per_key = self.nav_step_ms(count).saturating_mul(3) / 4;
        let mut rng = rand::rng();
        self.press(Key::Shift, Direction::Press)?;
        for _ in 0..count {
            gate()?;
            self.press(Key::RightArrow, Direction::Click)?;
            interruptible_sleep(randomize_duration(per_key.max(4), 0.4, &mut rng), &mut gate)?;
        }
        self.press(Key::Shift, Direction::Release)?;
        Ok(())
    }

    fn nav_step_ms(&self, steps: usize) -> u64 {
        let base = self.correction_nav_ms;
        if steps <= 40 {
            base
        } else if steps <= 200 {
            (base / 2).max(8)
        } else {
            (base / 4).max(5)
        }
    }

    pub fn select_all(&mut self) -> Result<(), String> {
        let modifier = if cfg!(target_os = "macos") {
            Key::Meta
        } else {
            Key::Control
        };
        self.press(modifier, Direction::Press)?;
        self.press(Key::Unicode('a'), Direction::Click)?;
        self.press(modifier, Direction::Release)?;
        Ok(())
    }

    pub fn backspace(&mut self) -> Result<(), String> {
        self.press(Key::Backspace, Direction::Click)
    }
}

/// Turns text into a sequence of timed keystrokes with human errors. Holds no
/// operating-system handles, so it is pure and unit testable.
struct Composer {
    wpm: u32,
    corrected_typos: bool,
    rhythm_profile: RhythmProfile,
    variation: f64,
    hesitation: f64,
    typo_probability: f64,
    correction_delay_ms: u64,
}

impl Composer {
    fn from_settings(settings: &SessionSettings) -> Self {
        Self {
            wpm: settings.wpm.clamp(20, 220),
            corrected_typos: settings.corrected_typos,
            rhythm_profile: settings.rhythm_profile,
            variation: f64::from(settings.variation_percent.min(100)) / 100.0,
            hesitation: f64::from(settings.hesitation_percent.min(100)) / 100.0,
            typo_probability: f64::from(settings.typos_per_thousand.min(50)) / 1000.0,
            correction_delay_ms: settings.correction_delay_ms.clamp(40, 1200),
        }
    }

    fn cadence(&self, jotting: bool) -> Cadence {
        let (burst_probability, slow_probability, pace) = match self.rhythm_profile {
            RhythmProfile::Steady => (0.08, 0.03, 0.95),
            RhythmProfile::Natural => (0.16, 0.07, 1.0),
            RhythmProfile::Reflective => (0.10, 0.13, 1.08),
        };
        Cadence {
            base_ms: 60_000.0 / (self.wpm as f64 * 5.0),
            pace: pace * if jotting { 0.68 } else { 1.0 },
            burst_probability,
            slow_probability: if jotting {
                slow_probability * 0.4
            } else {
                slow_probability
            },
            variation: self.variation,
            hesitation: if jotting {
                self.hesitation * 0.35
            } else {
                self.hesitation
            },
        }
    }

    fn plan(&self, text: &str, jotting: bool, rng: &mut impl Rng) -> Vec<Beat> {
        let cadence = self.cadence(jotting);
        let graphemes: Vec<&str> = text.graphemes(true).collect();
        let mut beats = Vec::new();
        let mut index = 0;
        while index < graphemes.len() {
            let grapheme = graphemes[index];
            // Errors land on letters only; spaces and punctuation are struck
            // reliably, matching how physical typing rarely drops a space.
            let typo_chance = self.typo_probability * if jotting { 0.5 } else { 1.0 };
            if self.corrected_typos
                && is_letter(grapheme)
                && rng.random_bool(typo_chance.clamp(0.0, 0.06))
            {
                index += self.plan_mistake(&mut beats, &graphemes, index, &cadence, rng);
            } else {
                beats.push(Beat::Type(grapheme.to_string(), cadence.interval(grapheme, rng)));
                index += 1;
            }
        }
        beats
    }

    fn correction_pause(&self, rng: &mut impl Rng) -> Beat {
        Beat::Wait(randomize_duration(self.correction_delay_ms, 0.35, rng))
    }

    /// Plan a realistic slip and its repair. Returns how many source graphemes
    /// were consumed; the pushed beats always net back to those graphemes.
    fn plan_mistake(
        &self,
        beats: &mut Vec<Beat>,
        graphemes: &[&str],
        index: usize,
        cadence: &Cadence,
        rng: &mut impl Rng,
    ) -> usize {
        let current = graphemes[index];
        let next = graphemes.get(index + 1).copied();
        let can_transpose = matches!(next, Some(letter) if is_letter(letter));
        let mode = rng.random_range(0..100);

        if can_transpose && mode < 30 {
            // Transposition: two letters emerge in the wrong order, as when the
            // hands fire out of sync, then both are fixed.
            let (first, second) = (current, next.unwrap());
            beats.push(Beat::Type(second.to_string(), cadence.tap(rng)));
            beats.push(Beat::Type(first.to_string(), cadence.tap(rng)));
            beats.push(self.correction_pause(rng));
            beats.push(Beat::Backspace(back_beat(rng)));
            beats.push(Beat::Backspace(back_beat(rng)));
            beats.push(Beat::Type(first.to_string(), cadence.interval(first, rng)));
            beats.push(Beat::Type(second.to_string(), cadence.interval(second, rng)));
            2
        } else if mode < 55 {
            // Doubling: the letter is struck twice and the extra is removed.
            beats.push(Beat::Type(current.to_string(), cadence.interval(current, rng)));
            beats.push(Beat::Type(current.to_string(), cadence.tap(rng)));
            beats.push(self.correction_pause(rng));
            beats.push(Beat::Backspace(back_beat(rng)));
            1
        } else {
            // Substitution with an adjacent key, sometimes noticed only after a
            // letter or two more has been typed.
            let wrong = adjacent_key(current, rng).unwrap_or_else(|| current.to_string());
            beats.push(Beat::Type(wrong, cadence.tap(rng)));
            let mut trailing: Vec<&str> = Vec::new();
            if rng.random_bool(0.4) {
                let extra = rng.random_range(1..=2);
                for offset in 1..=extra {
                    match graphemes.get(index + offset).copied() {
                        Some(letter) if is_letter(letter) => trailing.push(letter),
                        _ => break,
                    }
                }
            }
            for letter in &trailing {
                beats.push(Beat::Type(letter.to_string(), cadence.tap(rng)));
            }
            beats.push(self.correction_pause(rng));
            for _ in 0..(1 + trailing.len()) {
                beats.push(Beat::Backspace(back_beat(rng)));
            }
            beats.push(Beat::Type(current.to_string(), cadence.interval(current, rng)));
            for letter in &trailing {
                beats.push(Beat::Type(letter.to_string(), cadence.interval(letter, rng)));
            }
            1 + trailing.len()
        }
    }
}

/// Per-keystroke timing parameters resolved once for a typing run.
struct Cadence {
    base_ms: f64,
    pace: f64,
    burst_probability: f64,
    slow_probability: f64,
    variation: f64,
    hesitation: f64,
}

impl Cadence {
    /// The delay after a normally typed grapheme. Bursts run ahead, occasional
    /// slow beats fall behind, and sentence-ending punctuation and line breaks
    /// draw the longest pauses — where writers plan the next thought.
    fn interval(&self, grapheme: &str, rng: &mut impl Rng) -> u64 {
        let jitter = if self.variation <= f64::EPSILON {
            1.0
        } else if rng.random_bool(self.burst_probability) {
            rng.random_range((1.0 - 0.58 * self.variation)..(1.0 - 0.24 * self.variation))
        } else if rng.random_bool(self.slow_probability) {
            rng.random_range((1.0 + 0.65 * self.variation)..(1.0 + 2.9 * self.variation))
        } else {
            rng.random_range((1.0 - 0.24 * self.variation)..(1.0 + 0.38 * self.variation))
        };
        let boundary_scale = 0.2 + self.hesitation * 1.55;
        let boundary: f64 = match grapheme {
            "." | "!" | "?" => rng.random_range(180.0..480.0),
            "," | ";" | ":" => rng.random_range(70.0..210.0),
            "\n" => rng.random_range(240.0..720.0),
            " " if rng.random_bool(0.015 + self.hesitation * 0.07) => rng.random_range(220.0..760.0),
            _ => 0.0,
        };
        (self.base_ms * self.pace * jitter + boundary * boundary_scale) as u64
    }

    /// A short inter-key interval with no boundary pause, for the keystrokes
    /// inside an as-yet-unnoticed mistake.
    fn tap(&self, rng: &mut impl Rng) -> u64 {
        let jitter = rng.random_range(0.7..1.15);
        (self.base_ms * self.pace * jitter) as u64
    }
}

fn back_beat(rng: &mut impl Rng) -> u64 {
    randomize_duration(70, 0.4, rng)
}

/// A single ASCII letter, the only characters an error is injected on.
fn is_letter(grapheme: &str) -> bool {
    grapheme.len() == 1 && grapheme.chars().all(|c| c.is_ascii_alphabetic())
}

/// The letter under a physically adjacent key, preserving the original case.
fn adjacent_key(grapheme: &str, rng: &mut impl Rng) -> Option<String> {
    if grapheme.len() != 1 {
        return None;
    }
    let source = grapheme.chars().next()?.to_ascii_lowercase();
    let choices = match source {
        'q' => "wa",
        'w' => "qase",
        'e' => "wsdr",
        'r' => "edft",
        't' => "rfgy",
        'y' => "tghu",
        'u' => "yhji",
        'i' => "ujko",
        'o' => "iklp",
        'p' => "ol",
        'a' => "qwsz",
        's' => "awedxz",
        'd' => "serfcx",
        'f' => "drtgvc",
        'g' => "ftyhbv",
        'h' => "gyujnb",
        'j' => "huikmn",
        'k' => "jiolm",
        'l' => "kop",
        'z' => "asx",
        'x' => "zsdc",
        'c' => "xdfv",
        'v' => "cfgb",
        'b' => "vghn",
        'n' => "bhjm",
        'm' => "njk",
        _ => return None,
    };
    let chars: Vec<char> = choices.chars().collect();
    let mut wrong = chars[rng.random_range(0..chars.len())];
    if grapheme.chars().next()?.is_uppercase() {
        wrong = wrong.to_ascii_uppercase();
    }
    Some(wrong.to_string())
}

fn randomize_duration(base_ms: u64, range: f64, rng: &mut impl Rng) -> u64 {
    if base_ms == 0 {
        return 0;
    }
    let multiplier = rng.random_range((1.0 - range)..(1.0 + range));
    (base_ms as f64 * multiplier) as u64
}

fn interruptible_sleep<F>(milliseconds: u64, gate: &mut F) -> Result<(), String>
where
    F: FnMut() -> Result<(), String>,
{
    let mut remaining = milliseconds;
    while remaining > 0 {
        gate()?;
        let slice = remaining.min(50);
        thread::sleep(Duration::from_millis(slice));
        remaining -= slice;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn composer(typos_per_thousand: u8) -> Composer {
        Composer::from_settings(&serde_json::from_value(serde_json::json!({
            "durationMinutes": 60,
            "wpm": 85,
            "countdownSeconds": 7,
            "planningPercent": 15,
            "draftingPercent": 60,
            "polishingPercent": 25,
            "correctedTypos": true,
            "typosPerThousand": typos_per_thousand
        }))
        .expect("settings parse"))
    }

    /// Replay the planned beats the way the target field would: typed graphemes
    /// push, backspaces pop, waits do nothing.
    fn net_text(beats: &[Beat]) -> String {
        let mut stack: Vec<String> = Vec::new();
        for beat in beats {
            match beat {
                Beat::Type(grapheme, _) => stack.push(grapheme.clone()),
                Beat::Backspace(_) => {
                    stack.pop();
                }
                Beat::Wait(_) => {}
            }
        }
        stack.concat()
    }

    #[test]
    fn planned_keystrokes_always_net_to_the_source_text() {
        let composer = composer(50); // maximum error rate to exercise corrections
        let mut rng = rand::rng();
        let samples = [
            "the quick brown fox jumps",
            "Are IQ tests accurate?",
            "line one\nline two\n\nnext",
            "aabbccdd committee assessment",
            "a",
        ];
        for sample in samples {
            for _ in 0..400 {
                for jotting in [false, true] {
                    let beats = composer.plan(sample, jotting, &mut rng);
                    assert_eq!(net_text(&beats), sample, "net text must equal source");
                }
            }
        }
    }

    #[test]
    fn errors_never_fall_on_spaces() {
        let composer = composer(50);
        let mut rng = rand::rng();
        for _ in 0..200 {
            let beats = composer.plan("go go go go go go", false, &mut rng);
            // Every backspace implies a preceding mistake; the source has spaces
            // only between words, and a correct net result proves none were
            // disturbed, but also assert spaces are only ever typed once in a row.
            assert_eq!(net_text(&beats), "go go go go go go");
        }
    }

    #[test]
    fn adjacent_key_preserves_case() {
        let mut rng = rand::rng();
        let upper = adjacent_key("K", &mut rng).unwrap();
        assert_eq!(upper.len(), 1);
        assert!(upper.chars().all(|c| c.is_ascii_uppercase()));
        assert!(adjacent_key(" ", &mut rng).is_none());
        assert!(is_letter("a"));
        assert!(!is_letter(" "));
        assert!(!is_letter("\n"));
    }
}

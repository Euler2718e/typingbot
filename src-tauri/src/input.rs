use crate::model::{RhythmProfile, SessionSettings};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use rand::Rng;
use std::{thread, time::Duration};
use unicode_segmentation::UnicodeSegmentation;

pub struct InputDriver {
    enigo: Enigo,
    wpm: u32,
    corrected_typos: bool,
    rhythm_profile: RhythmProfile,
    variation: f64,
    hesitation: f64,
    typo_probability: f64,
    correction_delay_ms: u64,
    edit_pause_ms: u64,
}

impl InputDriver {
    pub fn new(settings: &SessionSettings) -> Result<Self, String> {
        Ok(Self {
            enigo: Enigo::new(&Settings::default()).map_err(|error| error.to_string())?,
            wpm: settings.wpm.clamp(20, 220),
            corrected_typos: settings.corrected_typos,
            rhythm_profile: settings.rhythm_profile.clone(),
            variation: f64::from(settings.variation_percent.min(100)) / 100.0,
            hesitation: f64::from(settings.hesitation_percent.min(100)) / 100.0,
            typo_probability: f64::from(settings.typos_per_thousand.min(50)) / 1000.0,
            correction_delay_ms: settings.correction_delay_ms.clamp(40, 1200),
            edit_pause_ms: settings.edit_pause_ms.min(3000),
        })
    }

    pub fn type_human<F>(&mut self, text: &str, mut gate: F) -> Result<(), String>
    where
        F: FnMut() -> Result<(), String>,
    {
        let base_ms = 60_000.0 / (self.wpm as f64 * 5.0);
        let mut rng = rand::rng();
        let (burst_probability, slow_probability, pace) = match self.rhythm_profile {
            RhythmProfile::Steady => (0.08, 0.03, 0.95),
            RhythmProfile::Natural => (0.16, 0.07, 1.0),
            RhythmProfile::Reflective => (0.10, 0.13, 1.08),
        };
        for grapheme in text.graphemes(true) {
            gate()?;
            if self.corrected_typos {
                if let Some(wrong) = adjacent_typo(grapheme, self.typo_probability, &mut rng) {
                    self.enigo.text(&wrong).map_err(|error| error.to_string())?;
                    let correction_delay =
                        randomize_duration(self.correction_delay_ms, 0.35, &mut rng);
                    interruptible_sleep(correction_delay, &mut gate)?;
                    self.backspace()?;
                    interruptible_sleep(randomize_duration(70, 0.35, &mut rng), &mut gate)?;
                }
            }
            self.enigo
                .text(grapheme)
                .map_err(|error| error.to_string())?;

            let burst = rng.random_bool(burst_probability);
            let jitter = if self.variation <= f64::EPSILON {
                1.0
            } else if burst {
                rng.random_range((1.0 - 0.58 * self.variation)..(1.0 - 0.24 * self.variation))
            } else if rng.random_bool(slow_probability) {
                rng.random_range((1.0 + 0.65 * self.variation)..(1.0 + 2.9 * self.variation))
            } else {
                rng.random_range((1.0 - 0.24 * self.variation)..(1.0 + 0.38 * self.variation))
            };
            let boundary_scale = 0.2 + self.hesitation * 1.55;
            let boundary: f64 = match grapheme {
                "." | "!" | "?" => rng.random_range(180.0..480.0),
                "," | ";" | ":" => rng.random_range(70.0..210.0),
                "\n" => rng.random_range(240.0..720.0),
                " " if rng.random_bool(0.015 + self.hesitation * 0.07) => {
                    rng.random_range(220.0..760.0)
                }
                _ => 0.0,
            };
            interruptible_sleep(
                (base_ms * pace * jitter + boundary * boundary_scale) as u64,
                &mut gate,
            )?;
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

    pub fn move_cursor(&mut self, delta: isize) -> Result<(), String> {
        let key = if delta < 0 {
            Key::LeftArrow
        } else {
            Key::RightArrow
        };
        for _ in 0..delta.unsigned_abs() {
            self.enigo
                .key(key, Direction::Click)
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub fn select_right(&mut self, count: usize) -> Result<(), String> {
        self.enigo
            .key(Key::Shift, Direction::Press)
            .map_err(|error| error.to_string())?;
        for _ in 0..count {
            self.enigo
                .key(Key::RightArrow, Direction::Click)
                .map_err(|error| error.to_string())?;
        }
        self.enigo
            .key(Key::Shift, Direction::Release)
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn select_all(&mut self) -> Result<(), String> {
        let modifier = if cfg!(target_os = "macos") {
            Key::Meta
        } else {
            Key::Control
        };
        self.enigo
            .key(modifier, Direction::Press)
            .map_err(|error| error.to_string())?;
        self.enigo
            .key(Key::Unicode('a'), Direction::Click)
            .map_err(|error| error.to_string())?;
        self.enigo
            .key(modifier, Direction::Release)
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn backspace(&mut self) -> Result<(), String> {
        self.enigo
            .key(Key::Backspace, Direction::Click)
            .map_err(|error| error.to_string())
    }
}

fn adjacent_typo(grapheme: &str, probability: f64, rng: &mut impl Rng) -> Option<String> {
    if !rng.random_bool(probability.clamp(0.0, 0.05)) || grapheme.len() != 1 {
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

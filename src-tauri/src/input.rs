use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use rand::Rng;
use std::{thread, time::Duration};
use unicode_segmentation::UnicodeSegmentation;

pub struct InputDriver {
    enigo: Enigo,
    wpm: u32,
    corrected_typos: bool,
}

impl InputDriver {
    pub fn new(wpm: u32, corrected_typos: bool) -> Result<Self, String> {
        Ok(Self {
            enigo: Enigo::new(&Settings::default()).map_err(|error| error.to_string())?,
            wpm: wpm.clamp(20, 220),
            corrected_typos,
        })
    }

    pub fn type_human<F>(&mut self, text: &str, mut gate: F) -> Result<(), String>
    where
        F: FnMut() -> Result<(), String>,
    {
        let base_ms = 60_000.0 / (self.wpm as f64 * 5.0);
        let mut rng = rand::rng();
        for grapheme in text.graphemes(true) {
            gate()?;
            if self.corrected_typos {
                if let Some(wrong) = adjacent_typo(grapheme, &mut rng) {
                    self.enigo.text(&wrong).map_err(|error| error.to_string())?;
                    thread::sleep(Duration::from_millis(rng.random_range(90..260)));
                    self.backspace()?;
                    thread::sleep(Duration::from_millis(rng.random_range(35..95)));
                }
            }
            self.enigo
                .text(grapheme)
                .map_err(|error| error.to_string())?;

            let burst = rng.random_bool(0.16);
            let jitter = if burst {
                rng.random_range(0.42..0.72)
            } else if rng.random_bool(0.07) {
                rng.random_range(1.8..3.8)
            } else {
                rng.random_range(0.72..1.42)
            };
            let boundary = match grapheme {
                "." | "!" | "?" => rng.random_range(180.0..480.0),
                "," | ";" | ":" => rng.random_range(70.0..210.0),
                "\n" => rng.random_range(240.0..720.0),
                " " if rng.random_bool(0.045) => rng.random_range(220.0..760.0),
                _ => 0.0,
            };
            thread::sleep(Duration::from_millis((base_ms * jitter + boundary) as u64));
        }
        Ok(())
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

fn adjacent_typo(grapheme: &str, rng: &mut impl Rng) -> Option<String> {
    if !rng.random_bool(0.012) || grapheme.len() != 1 {
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

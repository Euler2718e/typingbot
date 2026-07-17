use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceScript {
    pub version: String,
    pub title: String,
    pub final_text: String,
    pub actions: Vec<Action>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Planning,
    Drafting,
    Polishing,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RhythmProfile {
    Steady,
    Natural,
    Reflective,
}

impl Default for RhythmProfile {
    fn default() -> Self {
        Self::Natural
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Action {
    Append {
        phase: Phase,
        text: String,
        effort: Option<u8>,
        note: Option<String>,
    },
    Replace {
        phase: Phase,
        find: String,
        text: String,
        effort: Option<u8>,
        note: Option<String>,
    },
    Delete {
        phase: Phase,
        find: String,
        effort: Option<u8>,
        note: Option<String>,
    },
    Move {
        phase: Phase,
        find: String,
        after: Option<String>,
        effort: Option<u8>,
        note: Option<String>,
    },
    Clear {
        phase: Phase,
        effort: Option<u8>,
        note: Option<String>,
    },
    Pause {
        phase: Phase,
        effort: Option<u8>,
        note: Option<String>,
    },
}

impl Action {
    pub fn phase(&self) -> &Phase {
        match self {
            Self::Append { phase, .. }
            | Self::Replace { phase, .. }
            | Self::Delete { phase, .. }
            | Self::Move { phase, .. }
            | Self::Clear { phase, .. }
            | Self::Pause { phase, .. } => phase,
        }
    }

    pub fn effort(&self) -> u64 {
        match self {
            Self::Append { effort, .. }
            | Self::Replace { effort, .. }
            | Self::Delete { effort, .. }
            | Self::Move { effort, .. }
            | Self::Clear { effort, .. }
            | Self::Pause { effort, .. } => effort.unwrap_or(2).clamp(1, 5) as u64,
        }
    }

    pub fn note(&self) -> Option<&str> {
        match self {
            Self::Append { note, .. }
            | Self::Replace { note, .. }
            | Self::Delete { note, .. }
            | Self::Move { note, .. }
            | Self::Clear { note, .. }
            | Self::Pause { note, .. } => note.as_deref(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSettings {
    pub duration_minutes: f64,
    pub wpm: u32,
    pub countdown_seconds: u64,
    pub planning_percent: f64,
    pub drafting_percent: f64,
    pub polishing_percent: f64,
    pub corrected_typos: bool,
    #[serde(default)]
    pub rhythm_profile: RhythmProfile,
    #[serde(default = "default_variation_percent")]
    pub variation_percent: u8,
    #[serde(default = "default_hesitation_percent")]
    pub hesitation_percent: u8,
    #[serde(default = "default_typos_per_thousand")]
    pub typos_per_thousand: u8,
    #[serde(default = "default_correction_delay_ms")]
    pub correction_delay_ms: u64,
    #[serde(default = "default_edit_pause_ms")]
    pub edit_pause_ms: u64,
}

fn default_variation_percent() -> u8 {
    62
}

fn default_hesitation_percent() -> u8 {
    54
}

fn default_typos_per_thousand() -> u8 {
    12
}

fn default_correction_delay_ms() -> u64 {
    180
}

fn default_edit_pause_ms() -> u64 {
    520
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub state: String,
    pub phase: Option<Phase>,
    pub action_index: usize,
    pub action_count: usize,
    pub elapsed_ms: u64,
    pub target_duration_ms: u64,
    pub message: String,
    pub target_application: Option<String>,
}

pub fn validate_and_simulate(script: &PerformanceScript) -> Result<(), String> {
    if script.version != "1.0" {
        return Err("unsupported performance version".into());
    }
    if script.actions.len() < 3 || script.actions.len() > 250 {
        return Err("a performance must contain 3 to 250 actions".into());
    }
    let mut document = String::new();
    let mut last_phase = 0;
    for (index, action) in script.actions.iter().enumerate() {
        let phase_index = match action.phase() {
            Phase::Planning => 0,
            Phase::Drafting => 1,
            Phase::Polishing => 2,
        };
        if phase_index < last_phase {
            return Err(format!(
                "action {} moves backwards between phases",
                index + 1
            ));
        }
        last_phase = phase_index;
        match action {
            Action::Append { text, .. } => document.push_str(text),
            Action::Clear { .. } => document.clear(),
            Action::Pause { .. } => {}
            Action::Replace { find, text, .. } => {
                replace_unique(&mut document, find, text, index)?;
            }
            Action::Delete { find, .. } => {
                replace_unique(&mut document, find, "", index)?;
            }
            Action::Move { find, after, .. } => {
                replace_unique(&mut document, find, "", index)?;
                let insert_at = match after {
                    None => 0,
                    Some(anchor) => unique_index(&document, anchor, index)? + anchor.len(),
                };
                document.insert_str(insert_at, find);
            }
        }
    }
    if document != script.final_text {
        return Err("the performance does not resolve exactly to finalText".into());
    }
    Ok(())
}

pub fn unique_index(document: &str, needle: &str, action_index: usize) -> Result<usize, String> {
    if needle.is_empty() {
        return Err(format!(
            "action {} contains an empty anchor",
            action_index + 1
        ));
    }
    let mut matches = document.match_indices(needle);
    let first = matches.next().map(|item| item.0);
    if first.is_none() || matches.next().is_some() {
        return Err(format!(
            "action {} anchor must match exactly once",
            action_index + 1
        ));
    }
    Ok(first.unwrap())
}

fn replace_unique(
    document: &mut String,
    find: &str,
    replacement: &str,
    action_index: usize,
) -> Result<(), String> {
    let start = unique_index(document, find, action_index)?;
    document.replace_range(start..start + find.len(), replacement);
    Ok(())
}

pub fn grapheme_index(document: &str, byte_index: usize) -> usize {
    document[..byte_index].graphemes(true).count()
}

pub fn grapheme_count(value: &str) -> usize {
    value.graphemes(true).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example() -> PerformanceScript {
        PerformanceScript {
            version: "1.0".into(),
            title: "example".into(),
            final_text: "A clear line.".into(),
            actions: vec![
                Action::Append {
                    phase: Phase::Planning,
                    text: "idea".into(),
                    effort: None,
                    note: None,
                },
                Action::Clear {
                    phase: Phase::Drafting,
                    effort: None,
                    note: None,
                },
                Action::Append {
                    phase: Phase::Drafting,
                    text: "A rough line.".into(),
                    effort: None,
                    note: None,
                },
                Action::Replace {
                    phase: Phase::Polishing,
                    find: "rough".into(),
                    text: "clear".into(),
                    effort: None,
                    note: None,
                },
            ],
        }
    }

    #[test]
    fn validates_exact_result() {
        assert_eq!(validate_and_simulate(&example()), Ok(()));
    }

    #[test]
    fn rejects_ambiguous_anchor() {
        let mut script = example();
        script.actions[3] = Action::Replace {
            phase: Phase::Polishing,
            find: "A".into(),
            text: "a".into(),
            effort: None,
            note: None,
        };
        assert!(validate_and_simulate(&script).is_err());
    }

    #[test]
    fn counts_graphemes_for_cursor_navigation() {
        assert_eq!(grapheme_count("a👨‍👩‍👧‍👦b"), 3);
        assert_eq!(grapheme_index("aé", 1), 1);
    }

    #[test]
    fn supplies_cadence_defaults_for_saved_legacy_settings() {
        let settings: SessionSettings = serde_json::from_value(serde_json::json!({
            "durationMinutes": 60,
            "wpm": 85,
            "countdownSeconds": 7,
            "planningPercent": 15,
            "draftingPercent": 60,
            "polishingPercent": 25,
            "correctedTypos": true
        }))
        .expect("legacy settings should remain readable");

        assert_eq!(settings.rhythm_profile, RhythmProfile::Natural);
        assert_eq!(settings.variation_percent, 62);
        assert_eq!(settings.typos_per_thousand, 12);
        assert_eq!(settings.edit_pause_ms, 520);
    }
}

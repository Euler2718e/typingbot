use crate::model::{PerformanceScript, SessionSettings, SessionStatus};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum EngineCommand {
    Validate {
        id: u64,
        script: PerformanceScript,
    },
    Start {
        id: u64,
        script: PerformanceScript,
        settings: SessionSettings,
    },
    Pause {
        id: u64,
    },
    Resume {
        id: u64,
    },
    Stop {
        id: u64,
    },
    Quit {
        id: u64,
    },
}

impl EngineCommand {
    pub fn id(&self) -> u64 {
        match self {
            Self::Validate { id, .. }
            | Self::Start { id, .. }
            | Self::Pause { id }
            | Self::Resume { id }
            | Self::Stop { id }
            | Self::Quit { id } => *id,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    Ready {
        protocol: u8,
        global_shortcut: bool,
        warning: Option<String>,
    },
    Response {
        id: u64,
        ok: bool,
        error: Option<String>,
    },
    Status {
        status: SessionStatus,
    },
    Control {
        state: String,
    },
}

impl EngineEvent {
    pub fn success(id: u64) -> Self {
        Self::Response {
            id,
            ok: true,
            error: None,
        }
    }

    pub fn failure(id: u64, error: impl Into<String>) -> Self {
        Self::Response {
            id,
            ok: false,
            error: Some(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pause_command() {
        let command: EngineCommand = serde_json::from_str(r#"{"command":"pause","id":7}"#).unwrap();
        assert_eq!(command.id(), 7);
        assert!(matches!(command, EngineCommand::Pause { .. }));
    }

    #[test]
    fn serializes_response_without_protocol_noise() {
        let event = EngineEvent::failure(3, "nope");
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"type":"response","id":3,"ok":false,"error":"nope"}"#
        );
    }
}

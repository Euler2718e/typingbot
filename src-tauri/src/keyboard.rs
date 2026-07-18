//! Global keyboard absorption.
//!
//! While a performance is running the engine swallows the operator's real
//! keystrokes so nothing they type reaches the destination document. The
//! engine's own synthetic keystrokes are recognised through the controller's
//! inject guard and always pass through. A small set of controls stay live from
//! anywhere:
//!
//! - `Ctrl+X` stops (kills) the running performance.
//! - `Esc` pauses until `Ctrl+Enter` resumes it.
//! - `Cmd/Ctrl+Alt+Space` toggles pause and resume.
//!
//! Grabbing the keyboard needs the same Accessibility permission as typing. If
//! the grab cannot start the caller treats it as non-fatal and the engine keeps
//! running without absorption.

use crate::session::{ControlState, SessionController};
use rdev::{grab, Event, EventType, Key};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[derive(Default)]
struct Modifiers {
    ctrl: AtomicBool,
    alt: AtomicBool,
    meta: AtomicBool,
}

impl Modifiers {
    fn update(&self, key: Key, pressed: bool) {
        match key {
            Key::ControlLeft | Key::ControlRight => self.ctrl.store(pressed, Ordering::SeqCst),
            Key::Alt | Key::AltGr => self.alt.store(pressed, Ordering::SeqCst),
            Key::MetaLeft | Key::MetaRight => self.meta.store(pressed, Ordering::SeqCst),
            _ => {}
        }
    }

    fn ctrl(&self) -> bool {
        self.ctrl.load(Ordering::SeqCst)
    }

    fn alt(&self) -> bool {
        self.alt.load(Ordering::SeqCst)
    }

    fn meta(&self) -> bool {
        self.meta.load(Ordering::SeqCst)
    }
}

/// Runs the global keyboard grab. This blocks the calling thread for the life of
/// the process, so it must own the main thread on macOS. Returns an error if the
/// grab cannot be installed (for example without Accessibility permission).
pub fn run_absorb_grab(
    controller: SessionController,
    on_control: Arc<dyn Fn(ControlState) + Send + Sync>,
) -> Result<(), String> {
    let inject_guard = controller.inject_guard();
    let absorb_enabled = controller.absorb_enabled();
    let modifiers = Arc::new(Modifiers::default());

    grab(move |event: Event| {
        let (key, pressed) = match event.event_type {
            EventType::KeyPress(key) => (key, true),
            EventType::KeyRelease(key) => (key, false),
            // Mouse and wheel events are never absorbed.
            _ => return Some(event),
        };
        modifiers.update(key, pressed);

        // The engine's own synthetic keystrokes always pass through.
        if inject_guard.load(Ordering::SeqCst) {
            return Some(event);
        }

        let state = controller.state().unwrap_or(ControlState::Idle);
        let toggle_combo = if cfg!(target_os = "macos") {
            modifiers.meta() && modifiers.alt()
        } else {
            modifiers.ctrl() && modifiers.alt()
        };

        match state {
            ControlState::Running => {
                if pressed {
                    if key == Key::Space && toggle_combo {
                        if let Ok(next) = controller.toggle_pause() {
                            on_control(next);
                        }
                        return None;
                    }
                    if key == Key::Escape {
                        let _ = controller.pause();
                        on_control(ControlState::Paused);
                        return None;
                    }
                    if key == Key::KeyX && modifiers.ctrl() {
                        let _ = controller.stop();
                        on_control(ControlState::Stopped);
                        return None;
                    }
                }
                if absorb_enabled.load(Ordering::SeqCst) {
                    // Swallow everything the operator types.
                    None
                } else {
                    // Absorption is off: only the live controls are swallowed,
                    // and Ctrl+X / Escape were already handled above.
                    Some(event)
                }
            }
            ControlState::Paused => {
                if pressed {
                    if key == Key::Space && toggle_combo {
                        if let Ok(next) = controller.toggle_pause() {
                            on_control(next);
                        }
                        return None;
                    }
                    if key == Key::Return && modifiers.ctrl() {
                        let _ = controller.resume();
                        on_control(ControlState::Running);
                        return None;
                    }
                    if key == Key::KeyX && modifiers.ctrl() {
                        let _ = controller.stop();
                        on_control(ControlState::Stopped);
                        return None;
                    }
                }
                // While paused the operator has their keyboard back.
                Some(event)
            }
            ControlState::Idle | ControlState::Stopped => Some(event),
        }
    })
    .map_err(|error| format!("{error:?}"))
}

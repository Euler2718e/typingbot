use crate::{
    input::InputDriver,
    model::{
        grapheme_count, grapheme_index, unique_index, Action, PerformanceScript, Phase,
        SessionSettings, SessionStatus,
    },
};
use active_win_pos_rs::{get_active_window, ActiveWindow};
use rand::Rng;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

/// Sentinel error used to distinguish a deliberate stop from a genuine failure
/// so the engine can report "stopped" instead of "error".
const STOP_SIGNAL: &str = "__typingbot_stopped__";

/// How long the inject guard stays raised after the last synthetic event in an
/// emission span, letting the OS deliver those events to the keyboard grab
/// before absorption resumes. CGEvent delivery to a tap is asynchronous, so this
/// margin — not a per-keystroke toggle — is what keeps the engine from ever
/// swallowing its own keystrokes.
const GUARD_DRAIN_MS: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlState {
    Idle,
    Running,
    Paused,
    Stopped,
}

pub type StatusEmitter = Arc<dyn Fn(SessionStatus) + Send + Sync + 'static>;

#[derive(Clone)]
pub struct SessionController {
    shared: Arc<(Mutex<ControlState>, Condvar)>,
    /// Raised by the input driver around every synthetic keystroke so the global
    /// keyboard grab can pass the engine's own events through while absorbing the
    /// operator's real keystrokes.
    inject_guard: Arc<AtomicBool>,
    /// Whether the current session absorbs real keystrokes. Mirrors the active
    /// session's `absorbKeystrokes` setting for the keyboard grab to read.
    absorb_enabled: Arc<AtomicBool>,
}

impl Default for SessionController {
    fn default() -> Self {
        Self {
            shared: Arc::new((Mutex::new(ControlState::Idle), Condvar::new())),
            inject_guard: Arc::new(AtomicBool::new(false)),
            absorb_enabled: Arc::new(AtomicBool::new(true)),
        }
    }
}

impl SessionController {
    /// Shared flag the input driver raises while emitting its own keystrokes.
    pub fn inject_guard(&self) -> Arc<AtomicBool> {
        self.inject_guard.clone()
    }

    /// Shared flag reflecting whether the active session absorbs real keystrokes.
    pub fn absorb_enabled(&self) -> Arc<AtomicBool> {
        self.absorb_enabled.clone()
    }

    /// Raise the inject guard for the duration of an emission span so the
    /// keyboard grab lets the engine's own keystrokes and arrow presses through.
    fn absorb_arm(&self) {
        self.inject_guard.store(true, Ordering::SeqCst);
    }

    /// Lower the inject guard after letting in-flight synthetic events drain, so
    /// absorption of the operator's keystrokes resumes only once the engine has
    /// gone quiet.
    fn absorb_release(&self) {
        thread::sleep(Duration::from_millis(GUARD_DRAIN_MS));
        self.inject_guard.store(false, Ordering::SeqCst);
    }

    pub fn start(
        &self,
        emitter: StatusEmitter,
        script: PerformanceScript,
        settings: SessionSettings,
    ) -> Result<(), String> {
        {
            let (lock, _) = &*self.shared;
            let mut state = lock.lock().map_err(|_| "session lock is poisoned")?;
            if matches!(*state, ControlState::Running | ControlState::Paused) {
                return Err("a session is already active".into());
            }
            *state = ControlState::Running;
        }
        self.absorb_enabled
            .store(settings.absorb_keystrokes, Ordering::SeqCst);
        self.inject_guard.store(false, Ordering::SeqCst);
        let controller = self.clone();
        thread::spawn(move || {
            match controller.run(&emitter, script, settings) {
                Ok(()) => {}
                Err(error) if error == STOP_SIGNAL => {
                    controller.emit(
                        &emitter,
                        "stopped",
                        None,
                        0,
                        0,
                        0,
                        0,
                        "Session stopped".into(),
                        None,
                    );
                }
                Err(error) => {
                    controller.emit(&emitter, "error", None, 0, 0, 0, 0, error, None);
                }
            }
            controller.inject_guard.store(false, Ordering::SeqCst);
            let (lock, _) = &*controller.shared;
            if let Ok(mut state) = lock.lock() {
                *state = ControlState::Idle;
            }
        });
        Ok(())
    }

    pub fn pause(&self) -> Result<(), String> {
        let (lock, _) = &*self.shared;
        let mut state = lock.lock().map_err(|_| "session lock is poisoned")?;
        if *state == ControlState::Running {
            *state = ControlState::Paused;
        }
        Ok(())
    }

    pub fn resume(&self) -> Result<(), String> {
        let (lock, signal) = &*self.shared;
        let mut state = lock.lock().map_err(|_| "session lock is poisoned")?;
        if *state == ControlState::Paused {
            *state = ControlState::Running;
            signal.notify_all();
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let (lock, signal) = &*self.shared;
        let mut state = lock.lock().map_err(|_| "session lock is poisoned")?;
        *state = ControlState::Stopped;
        signal.notify_all();
        Ok(())
    }

    pub fn state(&self) -> Result<ControlState, String> {
        let (lock, _) = &*self.shared;
        lock.lock()
            .map(|state| *state)
            .map_err(|_| "session lock is poisoned".into())
    }

    pub fn toggle_pause(&self) -> Result<ControlState, String> {
        match self.state()? {
            ControlState::Running => {
                self.pause()?;
                Ok(ControlState::Paused)
            }
            ControlState::Paused => {
                self.resume()?;
                Ok(ControlState::Running)
            }
            state => Ok(state),
        }
    }

    fn run(
        &self,
        emitter: &StatusEmitter,
        script: PerformanceScript,
        settings: SessionSettings,
    ) -> Result<(), String> {
        let action_count = script.actions.len();
        let target_ms = (settings.duration_minutes * 60_000.0) as u64;
        for second in (1..=settings.countdown_seconds).rev() {
            self.ensure_running()?;
            self.emit(
                emitter,
                "countdown",
                None,
                0,
                action_count,
                0,
                target_ms,
                format!("Focus the destination. Starting in {second}"),
                None,
            );
            thread::sleep(Duration::from_secs(1));
        }

        let target = get_active_window()
            .map_err(|_| "Could not identify the focused destination application")?;
        if target.app_name.to_lowercase().contains("typingbot") {
            return Err("Focus a destination textbox before the countdown ends".into());
        }

        let started = Instant::now();
        let phase_budgets = phase_budgets(&settings, target_ms);
        let phase_efforts = phase_efforts(&script.actions);
        let mut used_effort: HashMap<Phase, u64> = HashMap::new();
        let mut phase_started = started;
        let mut current_phase = script.actions[0].phase().clone();
        let mut document = String::new();
        let mut cursor = 0usize;
        let mut input = InputDriver::new(&settings)?;

        for (index, action) in script.actions.iter().enumerate() {
            if *action.phase() != current_phase {
                current_phase = action.phase().clone();
                phase_started = Instant::now();
            }
            self.wait_until_ready(
                emitter,
                &target,
                action.phase(),
                index,
                action_count,
                started,
                target_ms,
            )?;
            self.emit(
                emitter,
                "running",
                Some(action.phase().clone()),
                index,
                action_count,
                started.elapsed().as_millis() as u64,
                target_ms,
                action
                    .note()
                    .unwrap_or("Working through the next edit")
                    .to_string(),
                Some(target.app_name.clone()),
            );

            self.apply_action(
                &mut input,
                action,
                &settings,
                &mut document,
                &mut cursor,
                || {
                    self.wait_until_ready(
                        emitter,
                        &target,
                        action.phase(),
                        index,
                        action_count,
                        started,
                        target_ms,
                    )
                },
            )?;

            let cumulative = used_effort.entry(action.phase().clone()).or_default();
            *cumulative += action.effort();
            let total_effort = *phase_efforts.get(action.phase()).unwrap_or(&1);
            let budget = *phase_budgets.get(action.phase()).unwrap_or(&0);
            let desired = budget.saturating_mul(*cumulative) / total_effort.max(1);
            let elapsed = phase_started.elapsed().as_millis() as u64;
            self.interruptible_sleep(
                desired.saturating_sub(elapsed),
                emitter,
                &target,
                action.phase(),
                index,
                action_count,
                started,
                target_ms,
            )?;
        }

        if document != script.final_text {
            return Err("Internal document mirror diverged before completion".into());
        }

        // Occupy the remaining requested time with a final read-through so the
        // session lasts the full duration instead of ending as soon as the last
        // edit lands.
        let elapsed = started.elapsed().as_millis() as u64;
        if target_ms > elapsed {
            self.emit(
                emitter,
                "running",
                Some(Phase::Polishing),
                action_count.saturating_sub(1),
                action_count,
                elapsed,
                target_ms,
                "Reading the finished piece one more time".into(),
                Some(target.app_name.clone()),
            );
            self.interruptible_sleep(
                target_ms - elapsed,
                emitter,
                &target,
                &Phase::Polishing,
                action_count.saturating_sub(1),
                action_count,
                started,
                target_ms,
            )?;
        }

        self.emit(
            emitter,
            "completed",
            Some(Phase::Polishing),
            action_count,
            action_count,
            started.elapsed().as_millis() as u64,
            target_ms,
            "Performance completed and final text verified".into(),
            Some(target.app_name),
        );
        Ok(())
    }

    fn apply_action<F>(
        &self,
        input: &mut InputDriver,
        action: &Action,
        settings: &SessionSettings,
        document: &mut String,
        cursor: &mut usize,
        mut gate: F,
    ) -> Result<(), String>
    where
        F: FnMut() -> Result<(), String>,
    {
        match action {
            Action::Append { text, .. } => {
                let jotting = matches!(action.phase(), Phase::Planning);
                self.absorb_arm();
                move_to(input, cursor, grapheme_count(document), &mut gate)?;
                input.type_human(text, jotting, &mut gate)?;
                self.absorb_release();
                *cursor += grapheme_count(text);
                document.push_str(text);
            }
            Action::Clear { .. } => {
                input.pause_before_edit(&mut gate)?;
                self.absorb_arm();
                input.select_all()?;
                input.backspace()?;
                self.absorb_release();
                document.clear();
                *cursor = 0;
            }
            Action::Pause { .. } => {
                self.think_pause(action.phase(), action.effort(), settings, &mut gate)?;
            }
            Action::Replace { find, text, .. } => {
                input.pause_before_edit(&mut gate)?;
                self.absorb_arm();
                replace_visible(input, document, cursor, find, text, &mut gate)?;
                return_to_end(input, document, cursor, &mut gate)?;
                self.absorb_release();
            }
            Action::Delete { find, .. } => {
                input.pause_before_edit(&mut gate)?;
                self.absorb_arm();
                replace_visible(input, document, cursor, find, "", &mut gate)?;
                return_to_end(input, document, cursor, &mut gate)?;
                self.absorb_release();
            }
            Action::Move { find, after, .. } => {
                input.pause_before_edit(&mut gate)?;
                self.absorb_arm();
                let moved = find.clone();
                replace_visible(input, document, cursor, find, "", &mut gate)?;
                let byte_index = match after {
                    None => 0,
                    Some(anchor) => unique_index(document, anchor, 0)? + anchor.len(),
                };
                let target = grapheme_index(document, byte_index);
                move_to(input, cursor, target, &mut gate)?;
                input.type_human(&moved, false, &mut gate)?;
                document.insert_str(byte_index, &moved);
                *cursor += grapheme_count(&moved);
                return_to_end(input, document, cursor, &mut gate)?;
                self.absorb_release();
            }
        }
        Ok(())
    }

    /// A visible thinking pause. Planning and drafting linger the longest because
    /// that is where a writer stares at the page; polishing pauses are shorter.
    fn think_pause<F>(
        &self,
        phase: &Phase,
        effort: u64,
        settings: &SessionSettings,
        gate: &mut F,
    ) -> Result<(), String>
    where
        F: FnMut() -> Result<(), String>,
    {
        let intensity = f64::from(settings.thinking_intensity.min(100)) / 100.0;
        let base = match phase {
            Phase::Planning | Phase::Drafting => 3500.0 + 9000.0 * intensity,
            Phase::Polishing => 1200.0 + 3000.0 * intensity,
        };
        let effort_scale = 0.6 + 0.2 * effort as f64;
        let mut rng = rand::rng();
        let jitter = rng.random_range(0.75..1.3);
        let dwell = (base * effort_scale * jitter) as u64;
        gated_sleep(dwell, gate)
    }

    fn ensure_running(&self) -> Result<(), String> {
        let (lock, signal) = &*self.shared;
        let mut state = lock.lock().map_err(|_| "session lock is poisoned")?;
        loop {
            match *state {
                ControlState::Running => return Ok(()),
                ControlState::Paused => {
                    state = signal.wait(state).map_err(|_| "session lock is poisoned")?
                }
                ControlState::Stopped => return Err(STOP_SIGNAL.into()),
                ControlState::Idle => return Err("Session is not active".into()),
            }
        }
    }

    /// True only when a reliable window read shows a different application. A
    /// failed read is treated as "still focused" so a transient query error can
    /// never abort the performance.
    fn focus_lost(&self, target: &ActiveWindow) -> bool {
        match get_active_window() {
            Ok(window) => {
                window.process_id != target.process_id
                    && !window.app_name.to_lowercase().contains("typingbot")
            }
            Err(_) => false,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn wait_until_ready(
        &self,
        emitter: &StatusEmitter,
        target: &ActiveWindow,
        phase: &Phase,
        action_index: usize,
        action_count: usize,
        started: Instant,
        target_ms: u64,
    ) -> Result<(), String> {
        self.ensure_running()?;
        if !self.focus_lost(target) {
            return Ok(());
        }
        // Confirm the change with a brief recheck to ignore momentary blips
        // (focus rings, input methods) that would otherwise pause needlessly.
        thread::sleep(Duration::from_millis(160));
        if !self.focus_lost(target) {
            return Ok(());
        }
        {
            let (lock, _) = &*self.shared;
            let mut state = lock.lock().map_err(|_| "session lock is poisoned")?;
            if *state == ControlState::Running {
                *state = ControlState::Paused;
            }
        }
        self.emit(
            emitter,
            "paused",
            Some(phase.clone()),
            action_index,
            action_count,
            started.elapsed().as_millis() as u64,
            target_ms,
            format!("Paused because focus left {}", target.app_name),
            Some(target.app_name.clone()),
        );
        self.ensure_running()?;
        if self.focus_lost(target) {
            return self.wait_until_ready(
                emitter,
                target,
                phase,
                action_index,
                action_count,
                started,
                target_ms,
            );
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn interruptible_sleep(
        &self,
        milliseconds: u64,
        emitter: &StatusEmitter,
        target: &ActiveWindow,
        phase: &Phase,
        action_index: usize,
        action_count: usize,
        started: Instant,
        target_ms: u64,
    ) -> Result<(), String> {
        let until = Instant::now() + Duration::from_millis(milliseconds);
        while Instant::now() < until {
            self.wait_until_ready(
                emitter,
                target,
                phase,
                action_index,
                action_count,
                started,
                target_ms,
            )?;
            let remaining = until.saturating_duration_since(Instant::now());
            thread::sleep(remaining.min(Duration::from_millis(250)));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn emit(
        &self,
        emitter: &StatusEmitter,
        state: &str,
        phase: Option<Phase>,
        action_index: usize,
        action_count: usize,
        elapsed_ms: u64,
        target_duration_ms: u64,
        message: String,
        target_application: Option<String>,
    ) {
        emitter(SessionStatus {
            state: state.into(),
            phase,
            action_index,
            action_count,
            elapsed_ms,
            target_duration_ms,
            message,
            target_application,
        });
    }
}

fn move_to<F>(
    input: &mut InputDriver,
    cursor: &mut usize,
    target: usize,
    gate: &mut F,
) -> Result<(), String>
where
    F: FnMut() -> Result<(), String>,
{
    let delta = target as isize - *cursor as isize;
    input.move_cursor(delta, gate)?;
    *cursor = target;
    Ok(())
}

/// After a visible correction, travel back to the end of the document so the
/// writer visibly returns to where composition left off.
fn return_to_end<F>(
    input: &mut InputDriver,
    document: &str,
    cursor: &mut usize,
    gate: &mut F,
) -> Result<(), String>
where
    F: FnMut() -> Result<(), String>,
{
    move_to(input, cursor, grapheme_count(document), gate)
}

fn replace_visible<F>(
    input: &mut InputDriver,
    document: &mut String,
    cursor: &mut usize,
    find: &str,
    replacement: &str,
    gate: &mut F,
) -> Result<(), String>
where
    F: FnMut() -> Result<(), String>,
{
    let byte_index = unique_index(document, find, 0)?;
    let start = grapheme_index(document, byte_index);
    let selection = grapheme_count(find);
    move_to(input, cursor, start, &mut *gate)?;
    input.select_right(selection, &mut *gate)?;
    if replacement.is_empty() {
        input.backspace()?;
    } else {
        input.type_human(replacement, false, &mut *gate)?;
    }
    document.replace_range(byte_index..byte_index + find.len(), replacement);
    *cursor = start + grapheme_count(replacement);
    Ok(())
}

fn gated_sleep<F>(milliseconds: u64, gate: &mut F) -> Result<(), String>
where
    F: FnMut() -> Result<(), String>,
{
    let mut remaining = milliseconds;
    while remaining > 0 {
        gate()?;
        let slice = remaining.min(100);
        thread::sleep(Duration::from_millis(slice));
        remaining -= slice;
    }
    Ok(())
}

fn phase_budgets(settings: &SessionSettings, total: u64) -> HashMap<Phase, u64> {
    HashMap::from([
        (
            Phase::Planning,
            (total as f64 * settings.planning_percent / 100.0) as u64,
        ),
        (
            Phase::Drafting,
            (total as f64 * settings.drafting_percent / 100.0) as u64,
        ),
        (
            Phase::Polishing,
            (total as f64 * settings.polishing_percent / 100.0) as u64,
        ),
    ])
}

fn phase_efforts(actions: &[Action]) -> HashMap<Phase, u64> {
    let mut result = HashMap::new();
    for action in actions {
        *result.entry(action.phase().clone()).or_default() += action.effort();
    }
    result
}

use crate::{
    input::InputDriver,
    model::{
        grapheme_count, grapheme_index, unique_index, Action, PerformanceScript, Phase,
        SessionSettings, SessionStatus,
    },
};
use active_win_pos_rs::{get_active_window, ActiveWindow};
use std::{
    collections::HashMap,
    sync::{Arc, Condvar, Mutex},
    thread,
    time::{Duration, Instant},
};

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
}

impl Default for SessionController {
    fn default() -> Self {
        Self {
            shared: Arc::new((Mutex::new(ControlState::Idle), Condvar::new())),
        }
    }
}

impl SessionController {
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
        let controller = self.clone();
        thread::spawn(move || {
            if let Err(error) = controller.run(&emitter, script, settings) {
                controller.emit(&emitter, "error", None, 0, 0, 0, 0, error, None);
            }
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

            self.apply_action(&mut input, action, &mut document, &mut cursor, || {
                self.wait_until_ready(
                    emitter,
                    &target,
                    action.phase(),
                    index,
                    action_count,
                    started,
                    target_ms,
                )
            })?;

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
        document: &mut String,
        cursor: &mut usize,
        mut gate: F,
    ) -> Result<(), String>
    where
        F: FnMut() -> Result<(), String>,
    {
        match action {
            Action::Append { text, .. } => {
                move_to(input, cursor, grapheme_count(document))?;
                input.type_human(text, &mut gate)?;
                *cursor += grapheme_count(text);
                document.push_str(text);
            }
            Action::Clear { .. } => {
                input.pause_before_edit(&mut gate)?;
                input.select_all()?;
                input.backspace()?;
                document.clear();
                *cursor = 0;
            }
            Action::Pause { .. } => {}
            Action::Replace { find, text, .. } => {
                input.pause_before_edit(&mut gate)?;
                replace_visible(input, document, cursor, find, text, &mut gate)?;
            }
            Action::Delete { find, .. } => {
                input.pause_before_edit(&mut gate)?;
                replace_visible(input, document, cursor, find, "", &mut gate)?;
            }
            Action::Move { find, after, .. } => {
                input.pause_before_edit(&mut gate)?;
                let moved = find.clone();
                replace_visible(input, document, cursor, find, "", &mut gate)?;
                let byte_index = match after {
                    None => 0,
                    Some(anchor) => unique_index(document, anchor, 0)? + anchor.len(),
                };
                let target = grapheme_index(document, byte_index);
                move_to(input, cursor, target)?;
                input.type_human(&moved, &mut gate)?;
                document.insert_str(byte_index, &moved);
                *cursor += grapheme_count(&moved);
            }
        }
        Ok(())
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
                ControlState::Stopped => return Err("Session stopped".into()),
                ControlState::Idle => return Err("Session is not active".into()),
            }
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
        let focused = get_active_window().map_err(|_| "Could not read the focused application")?;
        if focused.process_id != target.process_id {
            {
                let (lock, _) = &*self.shared;
                let mut state = lock.lock().map_err(|_| "session lock is poisoned")?;
                *state = ControlState::Paused;
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
            let refocused =
                get_active_window().map_err(|_| "Could not read the focused application")?;
            if refocused.process_id != target.process_id {
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

fn move_to(input: &mut InputDriver, cursor: &mut usize, target: usize) -> Result<(), String> {
    let delta = target as isize - *cursor as isize;
    input.move_cursor(delta)?;
    *cursor = target;
    Ok(())
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
    move_to(input, cursor, start)?;
    input.select_right(selection)?;
    if replacement.is_empty() {
        input.backspace()?;
    } else {
        input.type_human(replacement, gate)?;
    }
    document.replace_range(byte_index..byte_index + find.len(), replacement);
    *cursor = start + grapheme_count(replacement);
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

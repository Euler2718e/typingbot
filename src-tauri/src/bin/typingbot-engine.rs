use std::{
    io::{self, BufRead, BufReader, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use typingbot_lib::{
    keyboard::run_absorb_grab,
    model::{validate_and_simulate, validate_settings},
    protocol::{EngineCommand, EngineEvent},
    session::{ControlState, SessionController, StatusEmitter},
};

type EventWriter = Arc<Mutex<io::Stdout>>;

fn main() {
    let writer = Arc::new(Mutex::new(io::stdout()));
    let controller = SessionController::default();

    // The keyboard grab reports its own pause/resume/stop back to the terminal.
    let control_writer = writer.clone();
    let on_control: Arc<dyn Fn(ControlState) + Send + Sync> = Arc::new(move |state| {
        emit_event(
            &control_writer,
            &EngineEvent::Control {
                state: control_state_name(state).into(),
            },
        );
    });

    // Commands arrive as newline-delimited JSON on stdin and are handled on a
    // dedicated thread so the main thread is free to own the keyboard grab.
    spawn_command_reader(controller.clone(), writer.clone());

    // The grab blocks for the life of the process on success and returns
    // immediately on failure. Announce readiness from a short-lived probe so the
    // reported state reflects whether the grab actually installed.
    let grab_failed = Arc::new(AtomicBool::new(false));
    spawn_ready_probe(writer.clone(), grab_failed.clone());

    match run_absorb_grab(controller, on_control) {
        Ok(()) => {
            // The grab loop ended unexpectedly; keep the process alive so the
            // command reader can still drive validation and playback.
            park_forever();
        }
        Err(error) => {
            grab_failed.store(true, Ordering::SeqCst);
            emit_event(
                &writer,
                &EngineEvent::Ready {
                    protocol: 1,
                    global_shortcut: false,
                    warning: Some(format!(
                        "keyboard absorption and global controls unavailable: {error}"
                    )),
                },
            );
            park_forever();
        }
    }
}

fn spawn_command_reader(controller: SessionController, writer: EventWriter) {
    thread::spawn(move || {
        let input = BufReader::new(io::stdin());
        for line in input.lines() {
            match line {
                Ok(line) if line.trim().is_empty() => continue,
                Ok(line) => match serde_json::from_str::<EngineCommand>(&line) {
                    Ok(command) => {
                        if handle_command(&controller, &writer, command) {
                            output_flush(&writer);
                            std::process::exit(0);
                        }
                    }
                    Err(error) => emit_event(
                        &writer,
                        &EngineEvent::failure(0, format!("invalid command: {error}")),
                    ),
                },
                Err(error) => {
                    emit_event(
                        &writer,
                        &EngineEvent::failure(0, format!("input error: {error}")),
                    );
                    break;
                }
            }
        }
        let _ = controller.stop();
        output_flush(&writer);
        std::process::exit(0);
    });
}

fn spawn_ready_probe(writer: EventWriter, grab_failed: Arc<AtomicBool>) {
    thread::spawn(move || {
        // The grab installs (or fails) synchronously; give it a moment, then if
        // it did not fail, report the keyboard controls as armed.
        thread::sleep(Duration::from_millis(300));
        if !grab_failed.load(Ordering::SeqCst) {
            emit_event(
                &writer,
                &EngineEvent::Ready {
                    protocol: 1,
                    global_shortcut: true,
                    warning: None,
                },
            );
        }
    });
}

fn park_forever() -> ! {
    loop {
        thread::sleep(Duration::from_secs(3600));
    }
}

fn handle_command(
    controller: &SessionController,
    writer: &EventWriter,
    command: EngineCommand,
) -> bool {
    let id = command.id();
    let result = match command {
        EngineCommand::Validate { script, .. } => validate_and_simulate(&script),
        EngineCommand::Start {
            script, settings, ..
        } => validate_and_simulate(&script)
            .and_then(|_| validate_settings(&settings))
            .and_then(|_| {
                let status_writer = writer.clone();
                let emitter: StatusEmitter = Arc::new(move |status| {
                    emit_event(&status_writer, &EngineEvent::Status { status });
                });
                controller.start(emitter, script, settings)
            }),
        EngineCommand::Pause { .. } => controller.pause(),
        EngineCommand::Resume { .. } => controller.resume(),
        EngineCommand::Stop { .. } => controller.stop(),
        EngineCommand::Quit { .. } => {
            let result = controller.stop();
            emit_result(writer, id, result);
            return true;
        }
    };
    emit_result(writer, id, result);
    false
}

fn emit_result(writer: &EventWriter, id: u64, result: Result<(), String>) {
    let event = match result {
        Ok(()) => EngineEvent::success(id),
        Err(error) => EngineEvent::failure(id, error),
    };
    emit_event(writer, &event);
}

fn emit_event(writer: &EventWriter, event: &EngineEvent) {
    if let Ok(mut output) = writer.lock() {
        if serde_json::to_writer(&mut *output, event).is_ok() {
            let _ = writeln!(output);
            let _ = output.flush();
        }
    }
}

fn output_flush(writer: &EventWriter) {
    if let Ok(mut output) = writer.lock() {
        let _ = output.flush();
    }
}

fn control_state_name(state: ControlState) -> &'static str {
    match state {
        ControlState::Idle => "idle",
        ControlState::Running => "running",
        ControlState::Paused => "paused",
        ControlState::Stopped => "stopped",
    }
}

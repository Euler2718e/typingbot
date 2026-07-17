use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState,
};
use std::{
    io::{self, BufRead, BufReader, Write},
    sync::{Arc, Mutex},
    thread,
};
use tao::{
    event::Event,
    event_loop::{ControlFlow, EventLoopBuilder},
};
use typingbot_lib::{
    model::{validate_and_simulate, validate_settings},
    protocol::{EngineCommand, EngineEvent},
    session::{ControlState, SessionController, StatusEmitter},
};

#[derive(Debug)]
enum RuntimeEvent {
    Command(EngineCommand),
    InvalidCommand(String),
    InputClosed,
}

type EventWriter = Arc<Mutex<io::Stdout>>;

fn main() {
    let writer = Arc::new(Mutex::new(io::stdout()));
    let controller = SessionController::default();
    let mut event_loop = EventLoopBuilder::<RuntimeEvent>::with_user_event().build();

    #[cfg(target_os = "macos")]
    {
        use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
        event_loop.set_activation_policy(ActivationPolicy::Accessory);
        event_loop.set_dock_visibility(false);
        event_loop.set_activate_ignoring_other_apps(false);
    }

    let proxy = event_loop.create_proxy();
    thread::spawn(move || {
        let input = BufReader::new(io::stdin());
        for line in input.lines() {
            let event = match line {
                Ok(line) if line.trim().is_empty() => continue,
                Ok(line) => match serde_json::from_str::<EngineCommand>(&line) {
                    Ok(command) => RuntimeEvent::Command(command),
                    Err(error) => RuntimeEvent::InvalidCommand(error.to_string()),
                },
                Err(error) => RuntimeEvent::InvalidCommand(error.to_string()),
            };
            if proxy.send_event(event).is_err() {
                return;
            }
        }
        let _ = proxy.send_event(RuntimeEvent::InputClosed);
    });

    let (hotkey_manager, shortcut_registered, warning) =
        register_global_shortcut(controller.clone(), writer.clone());
    emit_event(
        &writer,
        &EngineEvent::Ready {
            protocol: 1,
            global_shortcut: shortcut_registered,
            warning,
        },
    );

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        let Event::UserEvent(runtime_event) = event else {
            return;
        };
        match runtime_event {
            RuntimeEvent::Command(command) => {
                let should_exit = handle_command(&controller, &writer, command);
                if should_exit {
                    *control_flow = ControlFlow::Exit;
                }
            }
            RuntimeEvent::InvalidCommand(error) => {
                emit_event(
                    &writer,
                    &EngineEvent::failure(0, format!("invalid command: {error}")),
                );
            }
            RuntimeEvent::InputClosed => {
                let _ = controller.stop();
                *control_flow = ControlFlow::Exit;
            }
        }
        let _keep_manager_alive = &hotkey_manager;
    });
}

fn register_global_shortcut(
    controller: SessionController,
    writer: EventWriter,
) -> (Option<GlobalHotKeyManager>, bool, Option<String>) {
    let manager = match GlobalHotKeyManager::new() {
        Ok(manager) => manager,
        Err(error) => {
            return (
                None,
                false,
                Some(format!("global pause shortcut unavailable: {error}")),
            )
        }
    };
    let modifiers = if cfg!(target_os = "macos") {
        Modifiers::SUPER | Modifiers::ALT
    } else {
        Modifiers::CONTROL | Modifiers::ALT
    };
    let shortcut = HotKey::new(Some(modifiers), Code::Space);
    if let Err(error) = manager.register(shortcut) {
        return (
            Some(manager),
            false,
            Some(format!("global pause shortcut unavailable: {error}")),
        );
    }
    GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
        if event.id == shortcut.id() && event.state == HotKeyState::Pressed {
            if let Ok(state) = controller.toggle_pause() {
                emit_event(
                    &writer,
                    &EngineEvent::Control {
                        state: control_state_name(state).into(),
                    },
                );
            }
        }
    }));
    (Some(manager), true, None)
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

fn control_state_name(state: ControlState) -> &'static str {
    match state {
        ControlState::Idle => "idle",
        ControlState::Running => "running",
        ControlState::Paused => "paused",
        ControlState::Stopped => "stopped",
    }
}

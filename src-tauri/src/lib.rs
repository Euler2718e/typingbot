pub mod input;
pub mod model;
pub mod protocol;
pub mod session;

use model::{
    validate_and_simulate, validate_settings, PerformanceScript, SessionSettings, SessionStatus,
};
use session::{SessionController, StatusEmitter};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, Rect,
};

const TRAY_ID: &str = "typingbot-status";

#[tauri::command]
fn validate_performance(script: PerformanceScript) -> Result<(), String> {
    validate_and_simulate(&script)
}

#[tauri::command]
fn start_session(
    app: tauri::AppHandle,
    controller: tauri::State<SessionController>,
    script: PerformanceScript,
    settings: SessionSettings,
) -> Result<(), String> {
    validate_and_simulate(&script)?;
    validate_settings(&settings)?;
    let status_app = app.clone();
    let emitter: StatusEmitter = Arc::new(move |status| emit_tauri_status(&status_app, status));
    controller.start(emitter, script, settings)
}

#[tauri::command]
fn pause_session(
    app: tauri::AppHandle,
    controller: tauri::State<SessionController>,
) -> Result<(), String> {
    controller.pause()?;
    set_control_tray_state(&app, "hold", "TypingBot is paused")
}

#[tauri::command]
fn resume_session(
    app: tauri::AppHandle,
    controller: tauri::State<SessionController>,
) -> Result<(), String> {
    controller.resume()?;
    set_control_tray_state(&app, "run", "TypingBot is resuming")
}

#[tauri::command]
fn stop_session(
    app: tauri::AppHandle,
    controller: tauri::State<SessionController>,
) -> Result<(), String> {
    controller.stop()?;
    set_control_tray_state(&app, "stop", "TypingBot was stopped")
}

fn set_control_tray_state(
    app: &tauri::AppHandle,
    title: &str,
    tooltip: &str,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_title(Some(format!(" {title}")))
            .map_err(|error| error.to_string())?;
        tray.set_tooltip(Some(tooltip))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn emit_tauri_status(app: &tauri::AppHandle, status: SessionStatus) {
    update_tray_status(app, &status);
    let _ = app.emit("session-status", status);
}

fn update_tray_status(app: &tauri::AppHandle, status: &SessionStatus) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let title = tray_status_title(&status.state, status.elapsed_ms, status.target_duration_ms);
    let tooltip = match status.state.as_str() {
        "running" => format!("TypingBot is active: {}", status.message),
        "paused" => format!("TypingBot is paused: {}", status.message),
        "countdown" => "TypingBot is waiting for a destination".into(),
        "completed" => "TypingBot finished successfully".into(),
        "error" => format!("TypingBot needs attention: {}", status.message),
        _ => "TypingBot is ready".into(),
    };
    let _ = tray.set_title(title.as_deref());
    let _ = tray.set_tooltip(Some(tooltip));
}

fn tray_status_title(state: &str, elapsed_ms: u64, target_duration_ms: u64) -> Option<String> {
    match state {
        "countdown" => Some(" wait".into()),
        "running" => {
            let percent = if target_duration_ms == 0 {
                0
            } else {
                (elapsed_ms.saturating_mul(100) / target_duration_ms).min(100)
            };
            Some(format!(" {percent}%"))
        }
        "paused" => Some(" hold".into()),
        "completed" => Some(" done".into()),
        "error" => Some(" err".into()),
        _ => None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SessionController::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            validate_performance,
            start_session,
            pause_session,
            resume_session,
            stop_session,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory)?;

            let show = MenuItem::with_id(app, "show", "Open panel", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id(TRAY_ID)
                .tooltip("TypingBot is ready")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        rect,
                        ..
                    } = event
                    {
                        let _ = toggle_panel(tray.app_handle(), rect, position);
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.center();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            tauri::WindowEvent::Focused(false) => {
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running TypingBot");
}

fn toggle_panel(
    app: &tauri::AppHandle,
    rect: Rect,
    click: PhysicalPosition<f64>,
) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    if window.is_visible()? {
        window.hide()?;
        return Ok(());
    }

    let scale = window.scale_factor()?;
    let tray_position = rect.position.to_physical::<i32>(scale);
    let tray_size = rect.size.to_physical::<u32>(scale);
    let panel_size = window.outer_size()?;

    if let Some(monitor) = window.monitor_from_point(click.x, click.y)? {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let margin = (8.0 * scale) as i32;
        let centered_x = tray_position.x + tray_size.width as i32 / 2 - panel_size.width as i32 / 2;
        let max_x =
            monitor_position.x + monitor_size.width as i32 - panel_size.width as i32 - margin;
        let x = centered_x.clamp(monitor_position.x + margin, max_x);
        let tray_is_below_center =
            tray_position.y > monitor_position.y + monitor_size.height as i32 / 2;
        let y = if tray_is_below_center {
            tray_position.y - panel_size.height as i32 - margin
        } else {
            tray_position.y + tray_size.height as i32 + margin
        };
        window.set_position(PhysicalPosition::new(x, y))?;
    }

    window.show()?;
    window.set_focus()?;
    Ok(())
}

mod input;
mod model;
mod session;

use model::{validate_and_simulate, PerformanceScript, SessionSettings};
use session::SessionController;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

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
    let split = settings.planning_percent + settings.drafting_percent + settings.polishing_percent;
    if (split - 100.0).abs() > 0.01 {
        return Err("phase percentages must total 100".into());
    }
    if !(1.0..=480.0).contains(&settings.duration_minutes) {
        return Err("duration must be between 1 and 480 minutes".into());
    }
    controller.start(app, script, settings)
}

#[tauri::command]
fn pause_session(controller: tauri::State<SessionController>) -> Result<(), String> {
    controller.pause()
}

#[tauri::command]
fn resume_session(controller: tauri::State<SessionController>) -> Result<(), String> {
    controller.resume()
}

#[tauri::command]
fn stop_session(controller: tauri::State<SessionController>) -> Result<(), String> {
    controller.stop()
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
            let show = MenuItem::with_id(app, "show", "Show TypingBot", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .tooltip("TypingBot")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running TypingBot");
}

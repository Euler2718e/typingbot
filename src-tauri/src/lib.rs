mod input;
mod model;
mod session;

use model::{validate_and_simulate, PerformanceScript, SessionSettings};
use session::SessionController;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition, Rect,
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
    controller.start(app, script, settings)
}

fn validate_settings(settings: &SessionSettings) -> Result<(), String> {
    let split = settings.planning_percent + settings.drafting_percent + settings.polishing_percent;
    if (split - 100.0).abs() > 0.01 {
        return Err("phase percentages must total 100".into());
    }
    if !(1.0..=480.0).contains(&settings.duration_minutes) {
        return Err("duration must be between 1 and 480 minutes".into());
    }
    if !(20..=220).contains(&settings.wpm) {
        return Err("typing speed must be between 20 and 220 WPM".into());
    }
    if settings.variation_percent > 100 || settings.hesitation_percent > 100 {
        return Err("variation and hesitation must be between 0 and 100".into());
    }
    if settings.typos_per_thousand > 50 {
        return Err("typo frequency must be between 0 and 50 per thousand characters".into());
    }
    if !(40..=1200).contains(&settings.correction_delay_ms) || settings.edit_pause_ms > 3000 {
        return Err("correction and edit pause timing is outside the supported range".into());
    }
    Ok(())
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
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let _ = window.hide();
                    api.prevent_close();
                }
                tauri::WindowEvent::Focused(false) => {
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running TypingBot");
}

fn toggle_panel(app: &tauri::AppHandle, rect: Rect, click: PhysicalPosition<f64>) -> tauri::Result<()> {
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
        let max_x = monitor_position.x + monitor_size.width as i32 - panel_size.width as i32 - margin;
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

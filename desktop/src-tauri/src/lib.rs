mod audio;
mod capture;
mod encoders;
mod ffmpeg;
mod hotkey;
mod icon;
mod modkeys;
mod sources;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(capture::CaptureState::default())
        .manage(hotkey::HotkeyState::default())
        .invoke_handler(tauri::generate_handler![
            sources::list_sources,
            sources::capture_thumbnail,
            icon::window_icon,
            encoders::detect_encoders,
            capture::start_capture,
            capture::stop_capture,
            hotkey::set_hotkey,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.app_handle().state::<capture::CaptureState>().stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o app desktop");
}

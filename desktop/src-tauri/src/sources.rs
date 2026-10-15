use serde::Serialize;
use tauri::AppHandle;
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
    GWL_EXSTYLE, WS_EX_TOOLWINDOW,
};

#[derive(Serialize)]
pub struct MonitorSource {
    pub index: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize)]
pub struct WindowSource {
    pub hwnd: u64,
    pub title: String,
}

#[derive(Serialize)]
pub struct Sources {
    pub monitors: Vec<MonitorSource>,
    pub windows: Vec<WindowSource>,
}

unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam.0 as *mut Vec<WindowSource>);
    if !IsWindowVisible(hwnd).as_bool() {
        return true.into();
    }
    if GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
        return true.into();
    }
    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return true.into();
    }
    let mut buf = vec![0u16; len as usize + 1];
    let copied = GetWindowTextW(hwnd, &mut buf);
    if copied > 0 {
        windows.push(WindowSource {
            hwnd: hwnd.0 as usize as u64,
            title: String::from_utf16_lossy(&buf[..copied as usize]),
        });
    }
    true.into()
}

fn enumerate_windows() -> Vec<WindowSource> {
    let mut windows: Vec<WindowSource> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect_window), LPARAM(&mut windows as *mut _ as isize));
    }
    windows
}

/// Monitores (índice = `output_idx` do ddagrab) e janelas capturáveis (gfxcapture por HWND).
#[tauri::command]
pub fn list_sources(app: AppHandle) -> Result<Sources, String> {
    let monitors = app
        .available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .enumerate()
        .map(|(i, m)| MonitorSource {
            index: i as u32,
            name: m.name().cloned().unwrap_or_else(|| format!("Monitor {}", i + 1)),
            width: m.size().width,
            height: m.size().height,
        })
        .collect();
    Ok(Sources { monitors, windows: enumerate_windows() })
}

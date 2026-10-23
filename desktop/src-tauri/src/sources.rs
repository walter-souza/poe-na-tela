use crate::capture::Source;
use crate::ffmpeg;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::io::Read;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW, IsIconic, IsWindowVisible,
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
    pub minimized: bool,
}

#[derive(Serialize)]
pub struct Sources {
    pub monitors: Vec<MonitorSource>,
    pub windows: Vec<WindowSource>,
}

/// Janelas de apps UWP em segundo plano ou em outra area de trabalho existem e ficam "visiveis", mas sao ocultadas pelo DWM.
unsafe fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, std::mem::size_of::<u32>() as u32).is_ok() && cloaked != 0
}

unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam.0 as *mut Vec<WindowSource>);
    if !IsWindowVisible(hwnd).as_bool() {
        return true.into();
    }
    if GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
        return true.into();
    }
    if is_cloaked(hwnd) {
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
            minimized: IsIconic(hwnd).as_bool(),
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

const THUMBNAIL_WIDTH: u32 = 320;
const THUMBNAIL_TIMEOUT: Duration = Duration::from_secs(4);

/// Um quadro da fonte como `data:image/jpeg;base64,...`, para a grade de seleção. Falha (sem quadro ou
/// timeout) em janelas minimizadas ou protegidas; o front mostra um marcador no lugar.
#[tauri::command]
pub async fn capture_thumbnail(source: Source) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || grab_thumbnail(&source))
        .await
        .map_err(|e| e.to_string())?
}

fn grab_thumbnail(source: &Source) -> Result<String, String> {
    let graph = format!(
        "{},hwdownload,format=bgra,scale={THUMBNAIL_WIDTH}:-2:flags=fast_bilinear,format=yuvj420p",
        source.grab_filter(5)
    );
    let mut child = ffmpeg::command()
        .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", &graph])
        .args(["-frames:v", "1", "-q:v", "6", "-f", "mjpeg", "pipe:1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("sem saída do ffmpeg")?;
    let buffer: Arc<Mutex<Vec<u8>>> = Arc::default();
    let reader = {
        let buffer = buffer.clone();
        thread::spawn(move || {
            let mut chunk = [0u8; 16 * 1024];
            while let Ok(n) = stdout.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                buffer.lock().unwrap().extend_from_slice(&chunk[..n]);
            }
        })
    };

    // O ffmpeg demora a encerrar em janelas estáticas: basta o JPEG estar completo (marcador EOI).
    let deadline = Instant::now() + THUMBNAIL_TIMEOUT;
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) || buffer.lock().unwrap().ends_with(&[0xFF, 0xD9]) {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    let _ = child.kill();
    let _ = child.wait();
    let _ = reader.join();
    let bytes = std::mem::take(&mut *buffer.lock().unwrap());
    if bytes.is_empty() {
        return Err("sem imagem".into());
    }
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

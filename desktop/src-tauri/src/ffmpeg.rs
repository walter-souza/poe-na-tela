use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Localiza o ffmpeg: sidecar ao lado do executável (instalado) ou ffmpeg do PATH (dev).
fn ffmpeg_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join("ffmpeg.exe");
            if sidecar.exists() {
                return sidecar;
            }
        }
    }
    PathBuf::from("ffmpeg")
}

pub fn command() -> Command {
    let mut cmd = Command::new(ffmpeg_path());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

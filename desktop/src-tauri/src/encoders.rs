use crate::ffmpeg;
use std::process::Stdio;
use std::thread;

/// Ordem de preferência: nunca cai em x264 (CPU), igual à recomendação do guia do OBS.
const CANDIDATES: [&str; 3] = ["h264_nvenc", "h264_qsv", "h264_amf"];

fn works(encoder: &str) -> bool {
    ffmpeg::command()
        .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "nullsrc=s=256x256:d=0.2"])
        .args(["-frames:v", "2", "-c:v", encoder, "-f", "null", "-"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Encoders de GPU que realmente inicializam nesta máquina (listar no `-encoders` não basta).
#[tauri::command]
pub async fn detect_encoders() -> Vec<String> {
    let handles: Vec<_> = CANDIDATES
        .iter()
        .map(|enc| {
            let enc = enc.to_string();
            thread::spawn(move || works(&enc).then_some(enc))
        })
        .collect();
    handles.into_iter().filter_map(|h| h.join().ok().flatten()).collect()
}

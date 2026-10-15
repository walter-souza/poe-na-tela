use crate::audio::{self, AudioQueue, SAMPLE_RATE};
use crate::ffmpeg;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const ENCODERS: [&str; 3] = ["h264_nvenc", "h264_qsv", "h264_amf"];
/// Falhas seguidas logo após iniciar (rede/servidor fora, encoder quebrado) antes de desistir.
const MAX_QUICK_FAILURES: u32 = 5;
const HEALTHY_RUN: Duration = Duration::from_secs(10);

#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Source {
    Monitor { index: u32 },
    Window { hwnd: u64 },
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptureConfig {
    pub source: Source,
    pub encoder: String,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub bitrate_kbps: u32,
    pub srt_url: String,
    pub system_audio: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CaptureStateEvent<'a> {
    state: &'a str,
    message: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct CaptureStats {
    fps: f32,
    bitrate_kbps: f32,
    dropped_frames: u64,
    speed: f32,
}

impl CaptureConfig {
    fn validate(&self) -> Result<(), String> {
        if !ENCODERS.contains(&self.encoder.as_str()) {
            return Err(format!("Encoder não permitido: {}", self.encoder));
        }
        if !matches!(self.fps, 30 | 60) {
            return Err("FPS deve ser 30 ou 60".into());
        }
        if !(320..=3840).contains(&self.width) || !(240..=2160).contains(&self.height) {
            return Err("Resolução fora do intervalo suportado".into());
        }
        if self.width % 2 != 0 || self.height % 2 != 0 {
            return Err("Largura e altura precisam ser pares".into());
        }
        if !(500..=50_000).contains(&self.bitrate_kbps) {
            return Err("Bitrate fora do intervalo (500–50000 kbps)".into());
        }
        if !self.srt_url.starts_with("srt://") {
            return Err("A URL de destino precisa começar com srt://".into());
        }
        Ok(())
    }

    fn video_graph(&self) -> String {
        let (w, h, fps) = (self.width, self.height, self.fps);
        let grab = match self.source {
            Source::Monitor { index } => {
                format!("ddagrab=framerate={fps}:output_idx={index}:draw_mouse=1")
            }
            Source::Window { hwnd } => {
                format!("gfxcapture=hwnd={hwnd}:max_framerate={fps}:capture_cursor=1")
            }
        };
        // gfxcapture só emite quadros quando a janela muda; `fps` mantém o ritmo constante.
        let cfr = if matches!(self.source, Source::Window { .. }) {
            format!(",fps={fps}")
        } else {
            String::new()
        };
        format!(
            "{grab},hwdownload,format=bgra{cfr},\
             scale={w}:{h}:force_original_aspect_ratio=decrease:flags=fast_bilinear,\
             pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,format=nv12"
        )
    }

    /// Receita equivalente ao guia do OBS: CBR, GOP de 1 s, sem B-frames, perfil high, baixa latência.
    fn encoder_args(&self) -> Vec<String> {
        let b = format!("{}k", self.bitrate_kbps);
        let g = self.fps.to_string();
        let mut args: Vec<String> = vec!["-c:v".into(), self.encoder.clone()];
        let extra: &[&str] = match self.encoder.as_str() {
            "h264_nvenc" => &["-preset", "p4", "-tune", "ll", "-rc", "cbr", "-zerolatency", "1"],
            "h264_qsv" => &["-preset", "veryfast", "-look_ahead", "0"],
            _ => &["-usage", "ultralowlatency", "-quality", "speed", "-rc", "cbr"],
        };
        args.extend(extra.iter().map(|s| s.to_string()));
        for (k, v) in [
            ("-b:v", b.as_str()),
            ("-maxrate", b.as_str()),
            ("-bufsize", b.as_str()),
            ("-g", g.as_str()),
            ("-bf", "0"),
            ("-profile:v", "high"),
        ] {
            args.push(k.into());
            args.push(v.into());
        }
        args
    }

    fn ffmpeg_args(&self, with_audio: bool) -> Vec<String> {
        let strs = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let mut args = strs(&["-hide_banner", "-loglevel", "warning", "-nostats", "-progress", "pipe:1", "-stats_period", "1"]);
        args.extend(strs(&["-f", "lavfi", "-i"]));
        args.push(self.video_graph());
        if with_audio {
            args.extend(strs(&["-use_wallclock_as_timestamps", "1", "-f", "f32le", "-ar"]));
            args.push(SAMPLE_RATE.to_string());
            args.extend(strs(&["-ac", "2", "-i", "pipe:0"]));
        }
        args.extend(strs(&["-map", "0:v"]));
        if with_audio {
            args.extend(strs(&["-map", "1:a"]));
        }
        // Taxa constante: o grab só entrega quadros novos quando a tela muda, e o espectador precisa de 60 reais.
        args.extend(strs(&["-fps_mode", "cfr", "-r"]));
        args.push(self.fps.to_string());
        args.extend(self.encoder_args());
        if with_audio {
            args.extend(strs(&["-c:a", "libopus", "-b:a", "160k", "-af", "aresample=async=1:first_pts=0"]));
        }
        args.extend(strs(&["-muxdelay", "0", "-f", "mpegts"]));
        args.push(self.srt_url.clone());
        args
    }
}

struct Running {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

#[derive(Default)]
pub struct CaptureState(Mutex<Option<Running>>);

impl CaptureState {
    pub fn stop(&self) {
        let running = self.0.lock().unwrap().take();
        if let Some(r) = running {
            r.stop.store(true, Ordering::SeqCst);
            let _ = r.handle.join();
        }
    }
}

fn emit_state(app: &AppHandle, state: &str, message: Option<String>) {
    let _ = app.emit("capture-state", CaptureStateEvent { state, message });
}

/// Envia o áudio capturado (ou silêncio) em ritmo de relógio: o loopback não emite nada quando está mudo.
fn pump_audio(mut stdin: ChildStdin, queue: AudioQueue, stop: Arc<AtomicBool>) {
    let started = Instant::now();
    let mut written_frames: u64 = 0;
    while !stop.load(Ordering::SeqCst) {
        let due = (started.elapsed().as_secs_f64() * SAMPLE_RATE as f64) as u64;
        if due > written_frames {
            let frames = (due - written_frames) as usize;
            let mut bytes = Vec::with_capacity(frames * 8);
            {
                let mut q = queue.lock().unwrap();
                for _ in 0..frames * 2 {
                    bytes.extend_from_slice(&q.pop_front().unwrap_or(0.0).to_le_bytes());
                }
            }
            if stdin.write_all(&bytes).is_err() {
                return;
            }
            written_frames = due;
        }
        thread::sleep(Duration::from_millis(5));
    }
}

fn parse_progress(app: &AppHandle, reader: impl BufRead, live: &AtomicBool) {
    let mut stats = CaptureStats::default();
    for line in reader.lines().map_while(Result::ok) {
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim();
        match key {
            "fps" => stats.fps = value.parse().unwrap_or(0.0),
            "bitrate" => stats.bitrate_kbps = value.trim_end_matches("kbits/s").trim().parse().unwrap_or(0.0),
            "drop_frames" => stats.dropped_frames = value.parse().unwrap_or(0),
            "speed" => stats.speed = value.trim_end_matches('x').trim().parse().unwrap_or(0.0),
            "progress" => {
                if stats.fps > 0.0 && !live.swap(true, Ordering::SeqCst) {
                    emit_state(app, "live", None);
                }
                let _ = app.emit("capture-stats", stats.clone());
            }
            _ => {}
        }
    }
}

fn spawn_ffmpeg(cfg: &CaptureConfig, with_audio: bool) -> Result<Child, String> {
    ffmpeg::command()
        .args(cfg.ffmpeg_args(with_audio))
        .stdin(if with_audio { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Não foi possível iniciar o ffmpeg: {e}"))
}

/// Mantém o ffmpeg rodando: reconecta se o SRT cair e desiste após falhas rápidas repetidas.
fn supervise(app: AppHandle, cfg: CaptureConfig, stop: Arc<AtomicBool>) {
    let queue: AudioQueue = Arc::new(Mutex::new(VecDeque::new()));
    let mut audio_error = None;
    // O Stream precisa viver até o fim da transmissão.
    let loopback = if cfg.system_audio {
        match audio::start_loopback(queue.clone()) {
            Ok(stream) => Some(stream),
            Err(e) => {
                audio_error = Some(e);
                None
            }
        }
    } else {
        None
    };
    let with_audio = loopback.is_some();
    emit_state(&app, "starting", audio_error.map(|e| format!("Transmitindo sem áudio do sistema: {e}")));

    let mut quick_failures = 0;
    while !stop.load(Ordering::SeqCst) {
        let started = Instant::now();
        let mut child = match spawn_ffmpeg(&cfg, with_audio) {
            Ok(c) => c,
            Err(e) => {
                emit_state(&app, "error", Some(e));
                return;
            }
        };
        let live = Arc::new(AtomicBool::new(false));
        let tail: Arc<Mutex<VecDeque<String>>> = Arc::default();

        let stdout = child.stdout.take().map(|out| {
            let (app, live) = (app.clone(), live.clone());
            thread::spawn(move || parse_progress(&app, BufReader::new(out), &live))
        });
        let stderr = child.stderr.take().map(|err| {
            let tail = tail.clone();
            thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    let mut t = tail.lock().unwrap();
                    if t.len() >= 6 {
                        t.pop_front();
                    }
                    t.push_back(line);
                }
            })
        });
        let audio_stop = Arc::new(AtomicBool::new(false));
        let audio_thread = child.stdin.take().map(|stdin| {
            let (queue, audio_stop) = (queue.clone(), audio_stop.clone());
            thread::spawn(move || pump_audio(stdin, queue, audio_stop))
        });

        let exit = loop {
            if stop.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(_) => break None,
            }
        };

        audio_stop.store(true, Ordering::SeqCst);
        for t in [stdout, stderr, audio_thread].into_iter().flatten() {
            let _ = t.join();
        }
        let Some(status) = exit else { break };

        if started.elapsed() >= HEALTHY_RUN {
            quick_failures = 0;
        } else {
            quick_failures += 1;
        }
        let reason = tail.lock().unwrap().iter().cloned().collect::<Vec<_>>().join(" | ");
        if quick_failures >= MAX_QUICK_FAILURES {
            emit_state(&app, "error", Some(format!("ffmpeg encerrou ({status}): {reason}")));
            return;
        }
        emit_state(&app, "reconnecting", Some(reason));
        // Espera interrompível: a parada do usuário não pode ficar presa no backoff.
        for _ in 0..20 {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
    drop(loopback);
    emit_state(&app, "stopped", None);
}

#[tauri::command]
pub fn start_capture(app: AppHandle, state: State<CaptureState>, config: CaptureConfig) -> Result<(), String> {
    config.validate()?;
    let mut slot = state.0.lock().unwrap();
    if slot.is_some() {
        return Err("Já existe uma transmissão em andamento".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let handle = {
        let stop = stop.clone();
        thread::spawn(move || supervise(app, config, stop))
    };
    *slot = Some(Running { stop, handle });
    Ok(())
}

#[tauri::command]
pub async fn stop_capture(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || app.state::<CaptureState>().stop())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(encoder: &str, source: Source) -> CaptureConfig {
        CaptureConfig {
            source,
            encoder: encoder.into(),
            fps: 60,
            width: 1920,
            height: 1080,
            bitrate_kbps: 6000,
            srt_url: "srt://host:8890?streamid=publish:sala/user&latency=250000".into(),
            system_audio: true,
        }
    }

    #[test]
    fn valida_entradas() {
        assert!(cfg("h264_nvenc", Source::Monitor { index: 0 }).validate().is_ok());
        assert!(cfg("libx264", Source::Monitor { index: 0 }).validate().is_err());
        let mut c = cfg("h264_nvenc", Source::Monitor { index: 0 });
        c.srt_url = "file:///etc/passwd".into();
        assert!(c.validate().is_err());
        c = cfg("h264_nvenc", Source::Monitor { index: 0 });
        c.height = 1081;
        assert!(c.validate().is_err());
    }

    #[test]
    fn receita_nvenc_igual_ao_guia_do_obs() {
        let args = cfg("h264_nvenc", Source::Monitor { index: 0 }).ffmpeg_args(true).join(" ");
        for expected in ["-rc cbr", "-b:v 6000k", "-g 60", "-fps_mode cfr -r 60", "-bf 0", "-profile:v high", "-c:a libopus", "-f mpegts srt://"] {
            assert!(args.contains(expected), "faltou '{expected}' em: {args}");
        }
    }

    #[test]
    fn janela_usa_gfxcapture_com_fps_constante() {
        let g = cfg("h264_nvenc", Source::Window { hwnd: 1234 }).video_graph();
        assert!(g.starts_with("gfxcapture=hwnd=1234"));
        assert!(g.contains(",fps=60,"));
    }

    #[test]
    fn config_do_frontend_desserializa() {
        let json = r#"{"source":{"kind":"window","hwnd":42},"encoder":"h264_nvenc","fps":60,"width":1920,"height":1080,"bitrateKbps":6000,"srtUrl":"srt://h:1","systemAudio":false}"#;
        let c: CaptureConfig = serde_json::from_str(json).unwrap();
        assert!(matches!(c.source, Source::Window { hwnd: 42 }));
    }

    /// Integração real: precisa de GPU NVIDIA, tela e ffmpeg. Rode com `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn captura_real_gera_h264_e_opus() {
        let out = std::env::temp_dir().join("poe_capture_test.ts");
        let _ = std::fs::remove_file(&out);
        let c = cfg("h264_nvenc", Source::Monitor { index: 0 });
        let mut args = c.ffmpeg_args(true);
        let sink = args.pop().unwrap();
        assert!(sink.starts_with("srt://"));
        args.extend(["-t".to_string(), "3".to_string()]);
        args.push(out.to_string_lossy().into_owned());
        let mut child = ffmpeg::command()
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let queue: AudioQueue = Arc::default();
        let pump = { let (q, s) = (queue.clone(), stop.clone()); thread::spawn(move || pump_audio(stdin, q, s)) };
        thread::sleep(Duration::from_secs(4));
        stop.store(true, Ordering::SeqCst);
        pump.join().unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let probe = ffmpeg::command().args(["-hide_banner", "-i"]).arg(&out).output().unwrap();
        let info = String::from_utf8_lossy(&probe.stderr);
        assert!(info.contains("Video: h264") && info.contains("1920x1080"), "{info}");
        assert!(info.contains("Audio: opus"), "{info}");
        println!("{info}");
    }
}

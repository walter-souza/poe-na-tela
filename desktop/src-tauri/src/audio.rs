//! Captura de áudio por WASAPI "process loopback". Monitor: tudo que toca no PC MENOS este app (e o WebView
//! dele). Janela: só o app dono da janela. Nos dois casos a voz dos amigos, tocada pelo chat da sala neste
//! app, não volta na transmissão. Requer Windows 10 2004+.
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use windows::core::{implement, Interface, Ref, HRESULT};
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, BLOB, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::VT_BLOB;

pub const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
/// Acima disso descartamos o áudio mais antigo para a latência não derivar.
const MAX_BUFFERED_SAMPLES: usize = SAMPLE_RATE as usize / 5 * CHANNELS as usize;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;

/// Fila de áudio estéreo intercalado (f32, 48 kHz).
pub type AudioQueue = Arc<Mutex<VecDeque<f32>>>;

fn push_samples(queue: &AudioQueue, samples: impl Iterator<Item = f32>) {
    let mut q = queue.lock().unwrap();
    q.extend(samples);
    if q.len() > MAX_BUFFERED_SAMPLES {
        let excess = q.len() - MAX_BUFFERED_SAMPLES;
        q.drain(..excess);
    }
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationDone(mpsc::Sender<()>);

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationDone_Impl {
    fn ActivateCompleted(&self, _op: Ref<IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
        let _ = self.0.send(());
        Ok(())
    }
}

/// PID do processo-raiz do WebView2 (filho direto do app), onde o Chromium toca o áudio da sala.
fn webview_root_pid(app_pid: u32) -> Option<u32> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = None;
        let mut ok = Process32FirstW(snapshot, &mut entry).is_ok();
        while ok {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            if entry.th32ParentProcessID == app_pid && name.eq_ignore_ascii_case("msedgewebview2.exe") {
                found = Some(entry.th32ProcessID);
                break;
            }
            ok = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
        found
    }
}

/// O que capturar.
#[derive(Clone, Copy)]
pub enum AudioTarget {
    /// Todo o áudio do PC, exceto este app.
    AllExceptApp,
    /// Apenas o áudio do app dono da janela.
    Window(u64),
}

/// Processo dono da janela; `None` se a janela não existe mais.
fn window_pid(hwnd: u64) -> Option<u32> {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(HWND(hwnd as usize as *mut _), Some(&mut pid)) };
    (pid != 0).then_some(pid)
}

/// Ativa o cliente de áudio da árvore de processos de `pid` (só ela, ou tudo menos ela).
unsafe fn activate(pid: u32, include: bool) -> Result<IAudioClient, String> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        ..Default::default()
    };
    params.Anonymous.ProcessLoopbackParams = AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
        TargetProcessId: pid,
        ProcessLoopbackMode: if include {
            PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
        } else {
            PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
        },
    };

    let mut variant = PROPVARIANT::default();
    {
        let inner = &mut *variant.Anonymous.Anonymous;
        inner.vt = VT_BLOB;
        inner.Anonymous.blob = BLOB {
            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            pBlobData: &mut params as *mut _ as *mut u8,
        };
    }

    let (tx, rx) = mpsc::channel();
    let handler: IActivateAudioInterfaceCompletionHandler = ActivationDone(tx).into();
    let operation = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(&variant),
        &handler,
    );
    // O blob aponta para a pilha: não pode passar por PropVariantClear.
    std::mem::forget(variant);
    let operation = operation.map_err(|e| format!("ActivateAudioInterfaceAsync: {e}"))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "tempo esgotado ativando a captura de áudio".to_string())?;

    let mut result = HRESULT(0);
    let mut activated = None;
    operation
        .GetActivateResult(&mut result, &mut activated)
        .map_err(|e| format!("GetActivateResult: {e}"))?;
    result.ok().map_err(|e| format!("captura de áudio por processo indisponível (Windows 10 2004+): {e}"))?;
    activated
        .ok_or_else(|| "o Windows não devolveu o cliente de áudio".to_string())?
        .cast::<IAudioClient>()
        .map_err(|e| e.to_string())
}

unsafe fn run(
    target: AudioTarget,
    queue: &AudioQueue,
    stop: &AtomicBool,
    ready: &mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    let app_pid = std::process::id();
    let exclude_app = || activate(webview_root_pid(app_pid).unwrap_or(app_pid), false);
    let client = match target {
        AudioTarget::AllExceptApp => exclude_app()?,
        AudioTarget::Window(hwnd) => match window_pid(hwnd) {
            // A janela é deste app: incluir o processo traria a sala de volta (eco).
            Some(pid) if pid != app_pid => activate(pid, true)?,
            Some(_) => exclude_app()?,
            None => return Err("a janela escolhida não existe mais".into()),
        },
    };
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
        nChannels: CHANNELS,
        nSamplesPerSec: SAMPLE_RATE,
        nAvgBytesPerSec: SAMPLE_RATE * CHANNELS as u32 * 4,
        nBlockAlign: CHANNELS * 4,
        wBitsPerSample: 32,
        cbSize: 0,
    };
    client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            2_000_000, // 200 ms em unidades de 100 ns
            0,
            &format,
            None,
        )
        .map_err(|e| format!("Initialize: {e}"))?;
    let capture: IAudioCaptureClient = client.GetService().map_err(|e| format!("GetService: {e}"))?;
    client.Start().map_err(|e| format!("Start: {e}"))?;
    let _ = ready.send(Ok(()));

    while !stop.load(Ordering::SeqCst) {
        loop {
            let packet = capture.GetNextPacketSize().map_err(|e| e.to_string())?;
            if packet == 0 {
                break;
            }
            let mut data = std::ptr::null_mut();
            let (mut frames, mut flags) = (0u32, 0u32);
            capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).map_err(|e| e.to_string())?;
            let count = frames as usize * CHANNELS as usize;
            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                push_samples(queue, std::iter::repeat_n(0.0, count));
            } else {
                push_samples(queue, std::slice::from_raw_parts(data as *const f32, count).iter().copied());
            }
            capture.ReleaseBuffer(frames).map_err(|e| e.to_string())?;
        }
        thread::sleep(Duration::from_millis(10));
    }
    let _ = client.Stop();
    Ok(())
}

/// Mantém a captura viva enquanto existir; ao descartar, para a thread.
pub struct Loopback {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Drop for Loopback {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Inicia a captura de áudio de `target` (nunca o próprio app) alimentando `queue`.
pub fn start_loopback(queue: AudioQueue, target: AudioTarget) -> Result<Loopback, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel();
    let handle = {
        let stop = stop.clone();
        thread::spawn(move || unsafe {
            if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
                let _ = ready_tx.send(Err("falha ao inicializar COM".to_string()));
                return;
            }
            if let Err(e) = run(target, &queue, &stop, &ready_tx) {
                // Falha durante a captura (ou na partida): quem espera `ready` recebe o motivo.
                let _ = ready_tx.send(Err(e));
            }
            CoUninitialize();
        })
    };
    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => Ok(Loopback { stop, handle: Some(handle) }),
        Ok(Err(e)) => {
            let _ = handle.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            Err("tempo esgotado iniciando a captura de áudio".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fila_descarta_o_mais_antigo_acima_do_limite() {
        let queue: AudioQueue = Arc::default();
        push_samples(&queue, (0..MAX_BUFFERED_SAMPLES + 10).map(|i| i as f32));
        let q = queue.lock().unwrap();
        assert_eq!(q.len(), MAX_BUFFERED_SAMPLES);
        assert_eq!(q.front().copied(), Some(10.0));
    }

    #[test]
    fn captura_real_sem_o_proprio_processo() {
        // Só verifica que a ativação do Windows funciona nesta máquina; o isolamento é coberto no E2E.
        let queue: AudioQueue = Arc::default();
        let capture = start_loopback(queue, AudioTarget::AllExceptApp).expect("process loopback indisponível");
        drop(capture);
    }
}

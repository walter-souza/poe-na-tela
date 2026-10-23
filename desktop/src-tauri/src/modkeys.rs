//! Atalhos de modificador sozinho (Shift/Ctrl/Alt esquerdo ou direito).
//!
//! `RegisterHotKey` (usado pelos demais atalhos) não aceita modificador isolado sem "engolir" a tecla no
//! sistema todo. Aqui usamos um gancho de teclado de baixo nível (WH_KEYBOARD_LL) que apenas observa e
//! sempre repassa a tecla. Como Shift/Ctrl/Alt são usados em combinações, o atalho vale como TOQUE:
//! dispara ao soltar a tecla, se nenhuma outra foi apertada enquanto ela estava pressionada.
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
    WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use crate::hotkey::HotkeyPressed;

/// Nome do atalho (igual a `KeyboardEvent.code`) -> código virtual da tecla.
pub fn modifier_vk(accelerator: &str) -> Option<u32> {
    Some(match accelerator {
        "ShiftLeft" => 0xA0,
        "ShiftRight" => 0xA1,
        "ControlLeft" => 0xA2,
        "ControlRight" => 0xA3,
        "AltLeft" => 0xA4,
        "AltRight" => 0xA5,
        _ => return None,
    })
}

/// Máquina de estados do "toque": pura, sem Windows, para poder testar.
#[derive(Default)]
pub struct TapDetector {
    bindings: HashMap<String, u32>,
    /// Teclas atualmente pressionadas (o toque só vale se a tecla vier sozinha).
    held: HashSet<u32>,
    armed: Option<u32>,
}

impl TapDetector {
    pub fn bind(&mut self, action: &str, vk: u32) {
        self.bindings.insert(action.to_string(), vk);
    }

    pub fn unbind(&mut self, action: &str) {
        self.bindings.remove(action);
        self.armed = None;
    }

    pub fn vk_of(&self, action: &str) -> Option<u32> {
        self.bindings.get(action).copied()
    }

    /// Ação que já usa esta tecla, se houver (para recusar duplicatas).
    pub fn owner_of(&self, vk: u32) -> Option<&str> {
        self.bindings.iter().find(|(_, v)| **v == vk).map(|(a, _)| a.as_str())
    }

    /// Esquece teclas que o sistema diz que já não estão pressionadas (um "soltar" perdido não pode travar o atalho).
    pub fn prune(&mut self, is_down: impl Fn(u32) -> bool) {
        self.held.retain(|vk| is_down(*vk));
    }

    /// Processa um evento de tecla; devolve a ação a disparar, se foi um toque completo.
    pub fn on_key(&mut self, vk: u32, down: bool) -> Option<String> {
        let bound = self.bindings.values().any(|v| *v == vk);
        if down {
            if self.armed == Some(vk) {
                return None; // autorrepetição da mesma tecla
            }
            let alone = self.held.is_empty();
            self.held.insert(vk);
            // Só arma com a tecla vindo sozinha; qualquer outra tecla cancela o toque em andamento.
            self.armed = (bound && alone).then_some(vk);
            return None;
        }
        self.held.remove(&vk);
        if self.armed == Some(vk) {
            self.armed = None;
            return self.bindings.iter().find(|(_, v)| **v == vk).map(|(a, _)| a.clone());
        }
        None
    }
}

struct Hook {
    detector: Mutex<TapDetector>,
    app: AppHandle,
}

static HOOK: OnceLock<Hook> = OnceLock::new();

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        if let Some(hook) = HOOK.get() {
            let vk = (*(lparam.0 as *const KBDLLHOOKSTRUCT)).vkCode;
            let down = match wparam.0 as u32 {
                WM_KEYDOWN | WM_SYSKEYDOWN => Some(true),
                WM_KEYUP | WM_SYSKEYUP => Some(false),
                _ => None,
            };
            if let Some(down) = down {
                let mut detector = hook.detector.lock().unwrap();
                if down {
                    detector.prune(|k| GetAsyncKeyState(k as i32) < 0);
                }
                let action = detector.on_key(vk, down);
                drop(detector);
                if let Some(action) = action {
                    let _ = hook.app.emit("hotkey-pressed", HotkeyPressed { action });
                }
            }
        }
    }
    // Nunca consome a tecla: o jogo e os outros apps continuam recebendo Shift/Ctrl/Alt normalmente.
    CallNextHookEx(None, code, wparam, lparam)
}

/// Instala o gancho uma única vez, numa thread própria com laço de mensagens (exigência do Windows).
fn ensure_installed(app: &AppHandle) {
    if HOOK.set(Hook { detector: Mutex::new(TapDetector::default()), app: app.clone() }).is_err() {
        return;
    }
    thread::spawn(|| unsafe {
        let module = GetModuleHandleW(None).ok();
        if SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module.map(|m| m.into()), 0).is_err() {
            eprintln!("não foi possível instalar o gancho de teclado");
            return;
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
    });
}

pub fn owner_of(vk: u32) -> Option<String> {
    HOOK.get()?.detector.lock().unwrap().owner_of(vk).map(str::to_string)
}

pub fn vk_of(action: &str) -> Option<u32> {
    HOOK.get()?.detector.lock().unwrap().vk_of(action)
}

pub fn bind(app: &AppHandle, action: &str, vk: u32) {
    ensure_installed(app);
    if let Some(hook) = HOOK.get() {
        hook.detector.lock().unwrap().bind(action, vk);
    }
}

pub fn unbind(action: &str) {
    if let Some(hook) = HOOK.get() {
        hook.detector.lock().unwrap().unbind(action);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LSHIFT: u32 = 0xA0;
    const RSHIFT: u32 = 0xA1;
    const KEY_A: u32 = 0x41;

    fn detector() -> TapDetector {
        let mut d = TapDetector::default();
        d.bind("mic", LSHIFT);
        d.bind("deafen", RSHIFT);
        d
    }

    #[test]
    fn toque_simples_dispara_ao_soltar() {
        let mut d = detector();
        assert_eq!(d.on_key(LSHIFT, true), None);
        assert_eq!(d.on_key(LSHIFT, false), Some("mic".into()));
    }

    #[test]
    fn autorrepeticao_nao_dispara_varias_vezes() {
        let mut d = detector();
        for _ in 0..5 {
            assert_eq!(d.on_key(LSHIFT, true), None);
        }
        assert_eq!(d.on_key(LSHIFT, false), Some("mic".into()));
        assert_eq!(d.on_key(LSHIFT, false), None);
    }

    #[test]
    fn shift_com_letra_nao_dispara() {
        let mut d = detector();
        d.on_key(LSHIFT, true);
        d.on_key(KEY_A, true);
        d.on_key(KEY_A, false);
        assert_eq!(d.on_key(LSHIFT, false), None);
    }

    #[test]
    fn letra_antes_do_shift_nao_dispara() {
        let mut d = detector();
        d.on_key(KEY_A, true);
        d.on_key(LSHIFT, true);
        assert_eq!(d.on_key(LSHIFT, false), None);
    }

    #[test]
    fn tecla_segurada_com_toque_de_shift_nao_dispara() {
        // Jogo: segura W e toca Shift para correr.
        let mut d = detector();
        d.on_key(0x57, true);
        d.on_key(LSHIFT, true);
        assert_eq!(d.on_key(LSHIFT, false), None);
    }

    #[test]
    fn soltar_perdido_nao_trava_o_atalho() {
        let mut d = detector();
        d.on_key(KEY_A, true); // o keyup de A nunca chegou
        d.prune(|_| false); // o sistema diz que nada está pressionado
        d.on_key(LSHIFT, true);
        assert_eq!(d.on_key(LSHIFT, false), Some("mic".into()));
    }

    #[test]
    fn esquerdo_e_direito_sao_acoes_distintas() {
        let mut d = detector();
        d.on_key(RSHIFT, true);
        assert_eq!(d.on_key(RSHIFT, false), Some("deafen".into()));
    }

    #[test]
    fn dois_shifts_juntos_cancelam() {
        let mut d = detector();
        d.on_key(LSHIFT, true);
        d.on_key(RSHIFT, true);
        assert_eq!(d.on_key(RSHIFT, false), None);
        assert_eq!(d.on_key(LSHIFT, false), None);
    }

    #[test]
    fn tecla_sem_atalho_e_ignorada_e_duplicata_detectada() {
        let mut d = detector();
        assert_eq!(d.on_key(0xA2, true), None);
        assert_eq!(d.on_key(0xA2, false), None);
        assert_eq!(d.owner_of(LSHIFT), Some("mic"));
        d.unbind("mic");
        assert_eq!(d.owner_of(LSHIFT), None);
    }

    #[test]
    fn nomes_de_modificador() {
        assert_eq!(modifier_vk("ShiftLeft"), Some(0xA0));
        assert_eq!(modifier_vk("AltRight"), Some(0xA5));
        assert_eq!(modifier_vk("KeyM"), None);
        assert_eq!(modifier_vk("MetaLeft"), None);
    }
}

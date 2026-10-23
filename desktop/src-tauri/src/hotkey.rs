use serde::Serialize;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex;
use crate::modkeys;
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcut, GlobalShortcutExt, Shortcut, ShortcutState};

/// Ações que podem ter atalho global. O front reage ao evento `hotkey-pressed` com o nome da ação.
const ACTIONS: [&str; 2] = ["mic", "deafen"];

#[derive(Serialize, Clone)]
pub struct HotkeyPressed {
    pub action: String,
}

/// Atalho atualmente registrado por ação, para trocar/remover um sem afetar o outro.
#[derive(Default)]
pub struct HotkeyState(Mutex<HashMap<String, Shortcut>>);

fn bind<R: Runtime>(shortcuts: &GlobalShortcut<R>, action: &str, shortcut: Shortcut) -> Result<(), tauri_plugin_global_shortcut::Error> {
    let action = action.to_string();
    shortcuts.on_shortcut(shortcut, move |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            let _ = app.emit("hotkey-pressed", HotkeyPressed { action: action.clone() });
        }
    })
}

/// Registra (ou troca) o atalho global de `action`. `accelerator` vazio apenas remove o atalho dela.
/// Modificador sozinho (ex.: `ShiftLeft`) usa o gancho de `modkeys`; os demais usam `RegisterHotKey`.
#[tauri::command]
pub fn set_hotkey(
    app: AppHandle,
    state: State<HotkeyState>,
    action: String,
    accelerator: String,
) -> Result<(), String> {
    if !ACTIONS.contains(&action.as_str()) {
        return Err(format!("Ação de atalho desconhecida: {action}"));
    }
    let shortcuts = app.global_shortcut();
    let mut registered = state.0.lock().unwrap();

    // Valida antes de mexer no que já está registrado, para um atalho inválido não apagar o atual.
    let accelerator = accelerator.trim();
    let modifier_vk = modkeys::modifier_vk(accelerator);
    let next = match accelerator {
        "" => None,
        _ if modifier_vk.is_some() => None,
        acc => Some(Shortcut::from_str(acc).map_err(|e| format!("Atalho inválido '{acc}': {e}"))?),
    };
    let taken_by = match (next, modifier_vk) {
        (Some(next), _) => registered.iter().find(|(a, s)| **a != action && **s == next).map(|(a, _)| a.clone()),
        (None, Some(vk)) => modkeys::owner_of(vk).filter(|a| *a != action),
        (None, None) => None,
    };
    if let Some(other) = taken_by {
        return Err(format!("Esse atalho já está em uso por outra ação ({other})"));
    }

    let previous = registered.remove(&action);
    if let Some(previous) = previous {
        let _ = shortcuts.unregister(previous);
    }
    let previous_modifier = modkeys::vk_of(&action);
    modkeys::unbind(&action);
    if let Some(vk) = modifier_vk {
        modkeys::bind(&app, &action, vk);
    }
    let Some(next) = next else { return Ok(()) };

    match bind(&shortcuts, &action, next) {
        Ok(()) => {
            registered.insert(action, next);
            Ok(())
        }
        Err(e) => {
            // Falhou (ex.: tecla já usada por outro programa): devolve o atalho que existia.
            if let Some(vk) = previous_modifier {
                modkeys::bind(&app, &action, vk);
            }
            if let Some(previous) = previous {
                if bind(&shortcuts, &action, previous).is_ok() {
                    registered.insert(action, previous);
                }
            }
            Err(format!("Não foi possível registrar o atalho (já em uso?): {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aceita_tecla_solta_e_combinacoes() {
        for acc in ["F8", "Ctrl+Shift+M", "KeyM", "Control+Alt+KeyK", "Digit1", "Backquote", "Ctrl+Shift+KeyM", "Alt+F9", "Super+Digit2"] {
            assert!(Shortcut::from_str(acc).is_ok(), "{acc} deveria ser válido");
        }
    }

    #[test]
    fn mesma_tecla_em_formatos_diferentes_e_igual() {
        assert_eq!(Shortcut::from_str("Ctrl+Shift+M").unwrap(), Shortcut::from_str("Control+Shift+KeyM").unwrap());
    }
}

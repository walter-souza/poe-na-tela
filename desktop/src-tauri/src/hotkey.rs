use std::str::FromStr;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Registra (ou troca) o atalho global que alterna o microfone. `accelerator` vazio apenas remove.
#[tauri::command]
pub fn set_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    if accelerator.trim().is_empty() {
        return Ok(());
    }
    let shortcut = Shortcut::from_str(accelerator.trim())
        .map_err(|e| format!("Atalho inválido '{accelerator}': {e}"))?;
    shortcuts
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = app.emit("toggle-mic", ());
            }
        })
        .map_err(|e| format!("Não foi possível registrar o atalho (já em uso?): {e}"))
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
}

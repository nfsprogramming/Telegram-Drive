use tauri::State;
use crate::commands::TelegramState;
use crate::crypto::derive_vault_key;

#[tauri::command]
pub async fn cmd_unlock_vault(
    folder_id: i64,
    password: &str,
    state: State<'_, TelegramState>,
) -> Result<(), String> {
    let key = derive_vault_key(password, folder_id)?;
    
    // Store the derived key in memory
    let mut keys = state.vault_keys.write().await;
    keys.insert(folder_id, key);
    
    Ok(())
}

#[tauri::command]
pub async fn cmd_lock_vault(
    folder_id: i64,
    state: State<'_, TelegramState>,
) -> Result<(), String> {
    let mut keys = state.vault_keys.write().await;
    keys.remove(&folder_id);
    
    Ok(())
}

#[tauri::command]
pub async fn cmd_is_vault_unlocked(
    folder_id: i64,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let keys = state.vault_keys.read().await;
    Ok(keys.contains_key(&folder_id))
}

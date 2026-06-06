use tauri::{State, Emitter};
use grammers_client::types::{Media, Peer};
use grammers_client::InputMessage;
use grammers_tl_types as tl;
use crate::TelegramState;
use crate::models::{FolderMetadata, FileMetadata};
use crate::bandwidth::BandwidthManager;
use crate::commands::utils::{resolve_peer, map_error};

#[tauri::command]
pub async fn cmd_create_folder(
    name: String,
    state: State<'_, TelegramState>,
) -> Result<FolderMetadata, String> {
    let client_opt = {
        state.client.lock().await.clone()
    };
    
    // --- MOCK ---
    if client_opt.is_none() {
        let mock_id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        log::info!("[MOCK] Created folder '{}' with ID {}", name, mock_id);
        return Ok(FolderMetadata {
            id: mock_id,
            name,
            parent_id: None,
        });
    }
    // -----------
    let client = client_opt.unwrap();
    log::info!("Creating Telegram Channel: {}", name);
    
    let result = client.invoke(&tl::functions::channels::CreateChannel {
        broadcast: true,
        megagroup: false,
        title: format!("{} [TD]", name),
        about: "Telegram Drive Storage Folder\n[telegram-drive-folder]".to_string(),
        geo_point: None,
        address: None,
        for_import: false,
        forum: false,
        ttl_period: None, // Initial creation TTL
    }).await.map_err(map_error)?;
    
    let (chat_id, access_hash) = match result {
        tl::enums::Updates::Updates(u) => {
             let chat = u.chats.first().ok_or("No chat in updates")?;
             match chat {
                 tl::enums::Chat::Channel(c) => (c.id, c.access_hash.unwrap_or(0)),
                 _ => return Err("Created chat is not a channel".to_string()),
             }
        },
        _ => return Err("Unexpected response (not Updates::Updates)".to_string()), 
    };

    // Explicitly Disable TTL
    let _input_channel = tl::enums::InputChannel::Channel(tl::types::InputChannel {
         channel_id: chat_id,
         access_hash,
    });

    let _ = client.invoke(&tl::functions::messages::SetHistoryTtl {
        peer: tl::enums::InputPeer::Channel(tl::types::InputPeerChannel { channel_id: chat_id, access_hash }),
        period: 0, 
    }).await;

    Ok(FolderMetadata {
        id: chat_id,
        name,
        parent_id: None,
    })
}

#[tauri::command]
pub async fn cmd_delete_folder(
    folder_id: i64,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = {
        state.client.lock().await.clone()
    };
    
    if client_opt.is_none() {
        log::info!("[MOCK] Deleted folder ID {}", folder_id);
        return Ok(true);
    }
    let client = client_opt.unwrap();
    log::info!("Deleting folder/channel: {}", folder_id);

    let peer = resolve_peer(&client, Some(folder_id), &state.peer_cache).await?;
    
    let input_channel = match peer {
        Peer::Channel(c) => {
             let chan = &c.raw;
             tl::enums::InputChannel::Channel(tl::types::InputChannel {
                 channel_id: chan.id,
                 access_hash: chan.access_hash.ok_or("No access hash for channel")?,
             })
        },
        _ => return Err("Only channels (folders) can be deleted.".to_string()),
    };
    
    match client.invoke(&tl::functions::channels::LeaveChannel {
        channel: input_channel,
    }).await {
        Ok(_) => Ok(true),
        Err(e) => {
            let err_str = e.to_string();
            log::warn!("Leave channel returned error: {}", err_str);
            if err_str.contains("dropped") || err_str.contains("cancelled") {
                log::info!("Assuming channel leave succeeded despite dropped connection.");
                Ok(true)
            } else {
                Err(format!("Failed to delete/leave channel: {}", err_str))
            }
        }
    }
}

#[tauri::command]
pub async fn cmd_deduplicate_folder(
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<usize, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        return Ok(0); 
    }
    let client = client_opt.unwrap();
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;

    let mut files = Vec::new();
    let mut msgs = client.iter_messages(&peer);
    
    // Fetch all messages in the folder
    while let Some(msg) = msgs.next().await.map_err(|e| e.to_string())? {
        if let Some(doc) = msg.media() {
            let (name, size) = match doc {
                Media::Document(d) => {
                    let text = msg.text();
                    let n = if text.is_empty() { d.name().to_string() } else { text.to_string() };
                    (n, d.size())
                },
                Media::Photo(p) => {
                    let mut s = 0;
                    if let Some(tl::enums::Photo::Photo(raw)) = &p.raw.photo {
                        for sz in &raw.sizes {
                            if let tl::enums::PhotoSize::Size(ps) = sz { s = s.max(ps.size as i64); }
                            if let tl::enums::PhotoSize::Progressive(ps) = sz { s = s.max(*ps.sizes.iter().max().unwrap_or(&0) as i64); }
                        }
                    }
                    ("Photo.jpg".to_string(), s as i64)
                },
                _ => continue,
            };
            files.push((msg.id(), name, size));
        }
    }

    // Group by (name, size)
    let mut seen = std::collections::HashSet::new();
    let mut to_delete = Vec::new();

    // Iterate in reverse (oldest first or newest first depending on how iter_messages returns)
    // iter_messages usually returns newest first. So by keeping the first one we see, we keep the newest.
    // If we want to keep the oldest, we'd reverse it. We'll just keep the newest one and delete the rest.
    for (id, name, size) in files {
        let key = (name, size);
        if seen.contains(&key) {
            to_delete.push(id);
        } else {
            seen.insert(key);
        }
    }

    if !to_delete.is_empty() {
        client.delete_messages(&peer, &to_delete).await.map_err(|e| e.to_string())?;
    }

    Ok(to_delete.len())
}


#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    id: String,
    percent: u8,
    uploaded_bytes: u64,
    total_bytes: u64,
    speed_bytes_per_sec: u64,
}

/// Async reader wrapper that tracks bytes read for progress reporting.
/// Wraps a tokio File and counts how many bytes have been consumed.
struct ProgressReader {
    inner: tokio::io::BufReader<tokio::fs::File>,
    bytes_read: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

impl ProgressReader {
    async fn new(path: &str, app_handle: &tauri::AppHandle) -> Result<(Self, u64, std::sync::Arc<std::sync::atomic::AtomicU64>), String> {
        #[cfg(target_os = "android")]
        let (file, size) = {
            if path.starts_with("content://") {
                use tauri_plugin_android_fs::{AndroidFsExt, FileAccessMode, FileUri};
                let api = app_handle.android_fs();
                let file_uri = FileUri::from_uri(path);
                let std_file = api.open_file(&file_uri, FileAccessMode::Read).map_err(|e| e.to_string())?;
                let size = std_file.metadata().map_err(|e| e.to_string())?.len();
                (tokio::fs::File::from_std(std_file), size)
            } else {
                let file = tokio::fs::File::open(path).await.map_err(|e| e.to_string())?;
                let size = file.metadata().await.map_err(|e| e.to_string())?.len();
                (file, size)
            }
        };

        #[cfg(not(target_os = "android"))]
        let (file, size) = {
            let file = tokio::fs::File::open(path).await.map_err(|e| e.to_string())?;
            let size = file.metadata().await.map_err(|e| e.to_string())?.len();
            (file, size)
        };

        let counter = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let reader = Self {
            inner: tokio::io::BufReader::new(file),
            bytes_read: counter.clone(),
        };
        Ok((reader, size, counter))
    }
}

impl tokio::io::AsyncRead for ProgressReader {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = std::pin::Pin::new(&mut self.inner).poll_read(cx, buf);
        if let std::task::Poll::Ready(Ok(())) = &result {
            let after = buf.filled().len();
            let delta = (after - before) as u64;
            self.bytes_read.fetch_add(delta, std::sync::atomic::Ordering::Relaxed);
        }
        result
    }
}

/// Delete a partial file with retries (best-effort cleanup)
fn cleanup_partial_file(path: &str) {
    let path = path.to_string();
    std::thread::spawn(move || {
        for attempt in 0..5 {
            match std::fs::remove_file(&path) {
                Ok(()) => {
                    log::info!("Cleaned up partial file: {}", path);
                    return;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
                Err(e) => {
                    log::warn!("Cleanup attempt {}/5 failed for {}: {}", attempt + 1, path, e);
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
            }
        }
    });
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct FileScanResult {
    pub uri: String,
    pub name: String,
    pub size: u64,
}

#[tauri::command]
pub async fn cmd_scan_folder(uri: String, _app_handle: tauri::AppHandle) -> Result<Vec<FileScanResult>, String> {
    #[cfg(target_os = "android")]
    {
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| format!("JNI VM error: {}", e))?;
        let mut env = vm.attach_current_thread().map_err(|e| format!("JNI env error: {}", e))?;
        
        let android_context = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
        let j_uri = env.new_string(&uri).map_err(|e| e.to_string())?;

        let result = env.call_static_method(
            "com/nfsprogramming/telegramdrive/FolderScanner",
            "scanDirectory",
            "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
            &[
                jni::objects::JValue::Object(&android_context),
                jni::objects::JValue::Object(&j_uri.into())
            ]
        ).map_err(|e| format!("JNI call error: {}", e))?;

        let j_str: jni::objects::JString = result.l().map_err(|e| e.to_string())?.into();
        let json_str: String = env.get_string(&j_str).map_err(|e| e.to_string())?.into();

        let parsed: Vec<serde_json::Value> = serde_json::from_str(&json_str).unwrap_or_default();
        let mut results = Vec::new();
        for item in parsed {
            results.push(FileScanResult {
                uri: item["uri"].as_str().unwrap_or("").to_string(),
                name: item["name"].as_str().unwrap_or("").to_string(),
                size: item["size"].as_u64().unwrap_or(0),
            });
        }
        return Ok(results);
    }
    
    #[cfg(not(target_os = "android"))]
    {
        use walkdir::WalkDir;
        let mut results = Vec::new();
        let base_path = std::path::Path::new(&uri);
        for entry in WalkDir::new(base_path).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let path = entry.path();
                let rel_path = path.strip_prefix(base_path).unwrap_or(path).to_string_lossy().to_string();
                let name = rel_path.replace("\\", "/");
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                results.push(FileScanResult {
                    uri: path.to_string_lossy().to_string(),
                    name,
                    size,
                });
            }
        }
        Ok(results)
    }
}


#[tauri::command]
pub async fn cmd_cancel_transfer(
    transfer_id: String,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    log::info!("Cancelling transfer: {}", transfer_id);
    state.cancelled_transfers.write().await.insert(transfer_id);
    Ok(true)
}

#[tauri::command]
pub async fn cmd_upload_file(
    path: String,
    folder_id: Option<i64>,
    transfer_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, TelegramState>,
    bw_state: State<'_, BandwidthManager>,
) -> Result<i32, String> {
    let size = {
        #[cfg(target_os = "android")]
        {
            if path.starts_with("content://") {
                use tauri_plugin_android_fs::{AndroidFsExt, FileAccessMode, FileUri};
                let api = app_handle.android_fs();
                let file_uri = FileUri::from_uri(&path);
                let std_file = api.open_file(&file_uri, FileAccessMode::Read).map_err(|e| e.to_string())?;
                std_file.metadata().map_err(|e| e.to_string())?.len()
            } else {
                std::fs::metadata(&path).map_err(|e| e.to_string())?.len()
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            std::fs::metadata(&path).map_err(|e| e.to_string())?.len()
        }
    };
    bw_state.can_transfer(size)?;

    let tid = transfer_id.unwrap_or_default();

    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() {
        log::info!("[MOCK] Uploaded file {} to {:?}", path, folder_id);
        bw_state.add_up(size);
        return Ok(0);
    }
    let client = client_opt.unwrap();

    // Emit start progress
    if !tid.is_empty() {
        let _ = app_handle.emit("upload-progress", ProgressPayload {
            id: tid.clone(), percent: 0, uploaded_bytes: 0, total_bytes: size, speed_bytes_per_sec: 0,
        });
    }

    // Create progress-tracking reader
    let (mut reader, file_size, bytes_counter) = ProgressReader::new(&path, &app_handle).await?;
    
    // Attempt to extract real file name from content:// URI or fallback to standard path.
    let file_name = {
        #[cfg(target_os = "android")]
        {
            if path.starts_with("content://") {
                use tauri_plugin_android_fs::{AndroidFsExt, FileUri};
                let api = app_handle.android_fs();
                // tauri-plugin-android-fs gives us file metadata which might include the real name,
                // or we can just extract from the string path if available, or just default.
                // Usually content URIs don't have the real name in the path string. We'll try our best.
                let file_uri = FileUri::from_uri(&path);
                api.get_info(&file_uri).ok().map(|info| info.name().to_string()).unwrap_or_else(|| "file".to_string())
            } else {
                std::path::Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".to_string())
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            std::path::Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".to_string())
        }
    };

    // Spawn a progress reporter task that emits events every 250ms
    let cancelled = state.cancelled_transfers.clone();
    let progress_tid = tid.clone();
    let progress_handle = app_handle.clone();
    let progress_counter = bytes_counter.clone();
    let progress_task = if !tid.is_empty() {
        Some(tokio::spawn(async move {
            let mut last_bytes: u64 = 0;
            let mut last_time = std::time::Instant::now();
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                let current = progress_counter.load(std::sync::atomic::Ordering::Relaxed);
                let now = std::time::Instant::now();
                let dt = now.duration_since(last_time).as_secs_f64();
                let speed = if dt > 0.0 { ((current - last_bytes) as f64 / dt) as u64 } else { 0 };
                let percent = if file_size > 0 { ((current as f64 / file_size as f64) * 100.0).min(99.0) as u8 } else { 0 };

                let _ = progress_handle.emit("upload-progress", ProgressPayload {
                    id: progress_tid.clone(), percent, uploaded_bytes: current, total_bytes: file_size, speed_bytes_per_sec: speed,
                });

                last_bytes = current;
                last_time = now;

                if current >= file_size { break; }
                // Check cancellation
                if cancelled.read().await.contains(&progress_tid) { break; }
            }
        }))
    } else {
        None
    };

    // Check cancellation before starting
    if state.cancelled_transfers.read().await.contains(&tid) {
        state.cancelled_transfers.write().await.remove(&tid);
        if let Some(t) = progress_task { t.abort(); }
        return Err("Transfer cancelled".to_string());
    }

    let vault_key = if let Some(fid) = folder_id {
        state.vault_keys.read().await.get(&fid).cloned()
    } else {
        None
    };

    let client_clone = client.clone();
    let upload_result = tokio::spawn(async move {
        if let Some(key) = vault_key {
            let (mut encrypted_reader, final_size) = crate::crypto::encrypt_stream(reader, key, file_size).await;
            client_clone.upload_stream(&mut encrypted_reader, final_size as usize, file_name).await
        } else {
            client_clone.upload_stream(&mut reader, file_size as usize, file_name).await
        }
    }).await.map_err(|e| format!("Task join error: {}", e))?;

    // Stop progress reporter
    if let Some(t) = progress_task { t.abort(); }

    // Check cancellation after upload
    if state.cancelled_transfers.read().await.contains(&tid) {
        state.cancelled_transfers.write().await.remove(&tid);
        return Err("Transfer cancelled".to_string());
    }

    let uploaded_file = upload_result.map_err(map_error)?;
    let message = InputMessage::new().text("").file(uploaded_file);

    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;

    let sent_msg = client.send_message(&peer, message).await.map_err(map_error)?;

    bw_state.add_up(size);

    // Emit completion
    if !tid.is_empty() {
        let _ = app_handle.emit("upload-progress", ProgressPayload {
            id: tid, percent: 100, uploaded_bytes: size, total_bytes: size, speed_bytes_per_sec: 0,
        });
    }

    Ok(sent_msg.id())
}

#[tauri::command]
pub async fn cmd_delete_file(
    message_id: i32,
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
         log::info!("[MOCK] Deleted message {} from folder {:?}", message_id, folder_id);
        return Ok(true); 
    }
    let client = client_opt.unwrap();

    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;
    client.delete_messages(&peer, &[message_id]).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn cmd_download_file(
    message_id: i32,
    save_path: String,
    folder_id: Option<i64>,
    transfer_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, TelegramState>,
    bw_state: State<'_, BandwidthManager>,
) -> Result<String, String> {
    let tid = transfer_id.unwrap_or_default();

    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Downloaded message {} from {:?} to {}", message_id, folder_id, save_path);
        if let Err(e) = std::fs::write(&save_path, b"Mock Content") { return Err(e.to_string()); }
        return Ok("Download successful".to_string());
    }
    let client = client_opt.unwrap();
    
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;

    // Use get_messages_by_id for efficient message lookup (same as server.rs)
    let messages = client.get_messages_by_id(&peer, &[message_id]).await.map_err(|e| e.to_string())?;
    
    let msg = messages.into_iter()
        .flatten()
        .next()
        .ok_or_else(|| "Message not found".to_string())?;

    let media = msg.media()
        .ok_or_else(|| "No media in message".to_string())?;

    let total_size = match &media {
        Media::Document(d) => d.size() as u64,
        Media::Photo(_) => 1024 * 1024,
        _ => 0,
    };
    
    bw_state.can_transfer(total_size)?;

    // Emit start
    if !tid.is_empty() {
        let _ = app_handle.emit("download-progress", ProgressPayload {
            id: tid.clone(), percent: 0, uploaded_bytes: 0, total_bytes: total_size, speed_bytes_per_sec: 0,
        });
    }

    // Stream download with per-chunk progress
    let mut download_iter = client.iter_download(&media);
    let mut file = {
        #[cfg(target_os = "android")]
        {
            if save_path.starts_with("content://") {
                use tauri_plugin_android_fs::{AndroidFsExt, FileAccessMode, FileUri};
                let api = app_handle.android_fs();
                let file_uri = FileUri::from_uri(&save_path);
                api.open_file(&file_uri, FileAccessMode::Write).map_err(|e| e.to_string())?
            } else {
                std::fs::File::create(&save_path).map_err(|e| e.to_string())?
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            std::fs::File::create(&save_path).map_err(|e| e.to_string())?
        }
    };
    let mut downloaded: u64 = 0;
    let mut last_emit_time = std::time::Instant::now();
    let mut last_emit_bytes: u64 = 0;

    let vault_key = if let Some(fid) = folder_id {
        state.vault_keys.read().await.get(&fid).cloned()
    } else {
        None
    };

    if let Some(key) = vault_key {
        let (mut tx_raw, rx_raw) = tokio::io::duplex(5 * 1024 * 1024);
        let cancelled_clone = state.cancelled_transfers.clone();
        let tid_clone = tid.clone();
        
        tokio::spawn(async move {
            while let Some(chunk) = download_iter.next().await.transpose() {
                if cancelled_clone.read().await.contains(&tid_clone) { break; }
                if let Ok(bytes) = chunk {
                    use tokio::io::AsyncWriteExt;
                    if tx_raw.write_all(&bytes).await.is_err() { break; }
                } else { break; }
            }
        });
        
        let mut decrypted_rx = crate::crypto::decrypt_stream(rx_raw, key).await;
        let mut buffer = vec![0u8; 1024 * 1024];
        
        loop {
            if state.cancelled_transfers.read().await.contains(&tid) {
                state.cancelled_transfers.write().await.remove(&tid);
                drop(file);
                cleanup_partial_file(&save_path);
                return Err("Transfer cancelled".to_string());
            }

            use tokio::io::AsyncReadExt;
            match decrypted_rx.read(&mut buffer).await {
                Ok(0) => break,
                Ok(n) => {
                    std::io::Write::write_all(&mut file, &buffer[..n]).map_err(|e| e.to_string())?;
                    downloaded += n as u64;
                    
                    if !tid.is_empty() {
                        let now = std::time::Instant::now();
                        let dt = now.duration_since(last_emit_time).as_secs_f64();
                        if dt >= 0.25 || downloaded >= total_size {
                            let speed = if dt > 0.0 { ((downloaded - last_emit_bytes) as f64 / dt) as u64 } else { 0 };
                            let percent = if total_size > 0 { ((downloaded as f64 / total_size as f64) * 100.0).min(100.0) as u8 } else { 0 };
                            let _ = app_handle.emit("download-progress", ProgressPayload {
                                id: tid.clone(), percent, uploaded_bytes: downloaded, total_bytes: total_size, speed_bytes_per_sec: speed,
                            });
                            last_emit_time = now;
                            last_emit_bytes = downloaded;
                        }
                    }
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    } else {
        while let Some(chunk) = download_iter.next().await.transpose() {
            // Check cancellation
            if state.cancelled_transfers.read().await.contains(&tid) {
                state.cancelled_transfers.write().await.remove(&tid);
                drop(file);
                cleanup_partial_file(&save_path);
                return Err("Transfer cancelled".to_string());
            }

            let bytes = chunk.map_err(|e| format!("Download chunk error: {}", e))?;
            std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;
            downloaded += bytes.len() as u64;
            
            // Time-based progress emission (every 250ms)
            if !tid.is_empty() {
                let now = std::time::Instant::now();
                let dt = now.duration_since(last_emit_time).as_secs_f64();
                if dt >= 0.25 || downloaded >= total_size {
                    let speed = if dt > 0.0 { ((downloaded - last_emit_bytes) as f64 / dt) as u64 } else { 0 };
                    let percent = if total_size > 0 { ((downloaded as f64 / total_size as f64) * 100.0).min(100.0) as u8 } else { 0 };
                    let _ = app_handle.emit("download-progress", ProgressPayload {
                        id: tid.clone(), percent, uploaded_bytes: downloaded, total_bytes: total_size, speed_bytes_per_sec: speed,
                    });
                    last_emit_time = now;
                    last_emit_bytes = downloaded;
                }
            }
        }
    }

    bw_state.add_down(total_size);

    // Emit completion
    if !tid.is_empty() {
        let _ = app_handle.emit("download-progress", ProgressPayload {
            id: tid, percent: 100, uploaded_bytes: downloaded, total_bytes: total_size, speed_bytes_per_sec: 0,
        });
    }

    Ok("Download successful".to_string())
}

#[tauri::command]
pub async fn cmd_move_files(
    message_ids: Vec<i32>,
    source_folder_id: Option<i64>,
    target_folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    if source_folder_id == target_folder_id { return Ok(true); }
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Moved msgs {:?} from {:?} to {:?}", message_ids, source_folder_id, target_folder_id);
        return Ok(true); 
    }
    let client = client_opt.unwrap();

    let source_peer = resolve_peer(&client, source_folder_id, &state.peer_cache).await?;
    let target_peer = resolve_peer(&client, target_folder_id, &state.peer_cache).await?;

    match client.forward_messages(&target_peer, &message_ids, &source_peer).await {
        Ok(_) => {},
        Err(e) => return Err(format!("Forward failed: {}", e)),
    }
    
    match client.delete_messages(&source_peer, &message_ids).await {
        Ok(_) => {},
        Err(e) => return Err(format!("Delete original failed: {}", e)),
    }

    Ok(true)
}

#[tauri::command]
pub async fn cmd_duplicate_files(
    message_ids: Vec<i32>,
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Duplicated msgs {:?} in {:?}", message_ids, folder_id);
        return Ok(true); 
    }
    let client = client_opt.unwrap();

    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;

    match client.forward_messages(&peer, &message_ids, &peer).await {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Duplicate failed: {}", e)),
    }
}


#[tauri::command]
pub async fn cmd_get_files(
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<Vec<FileMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Returning mock files for folder {:?}", folder_id);
        return Ok(Vec::new()); // No mock files for now
    }
    let client = client_opt.unwrap();
    let mut files = Vec::new();
    
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;

    let mut msgs = client.iter_messages(&peer);
    while let Some(msg) = msgs.next().await.map_err(|e| e.to_string())? {
        if let Some(doc) = msg.media() {
            let (name, size, mime, ext) = match doc {
                Media::Document(d) => {
                    // 1. Try filename from document attributes (d.raw is MessageMediaDocument)
                    let attr_name = d.raw.document.as_ref().and_then(|doc| {
                        if let tl::enums::Document::Document(inner) = doc {
                            inner.attributes.iter().find_map(|a| match a {
                                tl::enums::DocumentAttribute::Filename(f) => {
                                    if f.file_name.is_empty() { None } else { Some(f.file_name.clone()) }
                                }
                                _ => None,
                            })
                        } else { None }
                    });
                    // 2. Fall back to message caption text
                    let text = msg.text();
                    let n = attr_name
                        .or_else(|| if !text.is_empty() { Some(text.to_string()) } else { None })
                        .unwrap_or_else(|| {
                            // 3. Fall back to mime-type based name
                            let mime = d.mime_type().unwrap_or("application/octet-stream");
                            let ext = mime.split('/').last().unwrap_or("bin");
                            format!("file_{}.{}", msg.id(), ext)
                        });
                    let s = d.size();
                    let m = d.mime_type().map(|s| s.to_string());
                    let e = std::path::Path::new(&n).extension().map(|os| os.to_str().unwrap_or("").to_string());
                    (n, s, m, e)
                },
                Media::Photo(p) => {
                    let mut size = 0;
                    if let Some(tl::enums::Photo::Photo(raw)) = &p.raw.photo {
                        for s in &raw.sizes {
                            match s {
                                tl::enums::PhotoSize::Size(ps) => size = size.max(ps.size as i64),
                                tl::enums::PhotoSize::Progressive(ps) => size = size.max(*ps.sizes.iter().max().unwrap_or(&0) as i64),
                                _ => {}
                            }
                        }
                    }
                    ("Photo.jpg".to_string(), size, Some("image/jpeg".into()), Some("jpg".into()))
                },
                _ => ("Unknown".to_string(), 0, None, None),
            };
            files.push(FileMetadata {
                id: msg.id() as i64, folder_id, name, size: size as u64, mime_type: mime, file_ext: ext, created_at: msg.date().to_string(), icon_type: "file".into()
            });
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn cmd_rename_file(
    message_id: i32,
    folder_id: Option<i64>,
    new_name: String,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
         log::info!("[MOCK] Renamed message {} in folder {:?} to {}", message_id, folder_id, new_name);
        return Ok(true); 
    }
    let client = client_opt.unwrap();

    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;
    
    // Edit the message text to be the new filename. Grammers preserves media if not explicitly replaced.
    let new_message = InputMessage::new().text(new_name);
    match client.edit_message(&peer, message_id, new_message).await {
        Ok(_) => Ok(true),
        Err(e) => {
            log::error!("Failed to rename file: {}", e);
            match e {
                grammers_client::InvocationError::Rpc(rpc_err) => {
                    if rpc_err.name == "MESSAGE_NOT_MODIFIED" {
                        return Err("Telegram API blocks renaming this file. (Tip: You cannot rename forwarded messages, or messages older than 48 hours).".to_string());
                    }
                    if rpc_err.name == "MESSAGE_AUTHOR_REQUIRED" {
                        return Err("You don't have permission to rename this file. Only the original sender can rename it.".to_string());
                    }
                    return Err(format!("Rename failed: {}", rpc_err.name));
                },
                _ => return Err(format!("Rename failed: {}", e)),
            }
        }
    }
}

#[tauri::command]
pub async fn cmd_search_global(
    query: String,
    state: State<'_, TelegramState>,
) -> Result<Vec<FileMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        return Ok(Vec::new());
    }
    let client = client_opt.unwrap();
    let mut files = Vec::new();
    
    log::info!("Searching global for: {}", query);

    let result = client.invoke(&tl::functions::messages::SearchGlobal {
        q: query,
        filter: tl::enums::MessagesFilter::InputMessagesFilterDocument,
        min_date: 0,
        max_date: 0,
        offset_rate: 0,
        offset_peer: tl::enums::InputPeer::Empty,
        offset_id: 0,
        limit: 50,
        folder_id: None,
        broadcasts_only: false,
        groups_only: false,
        users_only: false,
    }).await.map_err(map_error)?;

    if let tl::enums::messages::Messages::Messages(msgs) = result {
        for msg in msgs.messages {
            if let tl::enums::Message::Message(m) = msg {
                if let Some(tl::enums::MessageMedia::Document(d)) = m.media {
                    if let tl::enums::Document::Document(doc) = d.document.unwrap() {
                        let name = doc.attributes.iter().find_map(|a| match a {
                            tl::enums::DocumentAttribute::Filename(f) => Some(f.file_name.clone()),
                            _ => None
                        }).unwrap_or("Unknown".to_string());
                        let size = doc.size as u64;
                        let mime = doc.mime_type.clone();
                        let ext = std::path::Path::new(&name).extension().map(|os| os.to_str().unwrap_or("").to_string());
                        let folder_id = match m.peer_id {
                            tl::enums::Peer::Channel(c) => Some(c.channel_id),
                            tl::enums::Peer::User(u) => Some(u.user_id),
                            tl::enums::Peer::Chat(c) => Some(c.chat_id),
                        };
                        files.push(FileMetadata {
                            id: m.id as i64, folder_id, name, size,
                            mime_type: Some(mime), file_ext: ext,
                            created_at: m.date.to_string(), icon_type: "file".into()
                        });
                    }
                }
            }
        }
    } else if let tl::enums::messages::Messages::Slice(msgs) = result {
        for msg in msgs.messages {
            if let tl::enums::Message::Message(m) = msg {
                if let Some(tl::enums::MessageMedia::Document(d)) = m.media {
                    if let tl::enums::Document::Document(doc) = d.document.unwrap() {
                        let name = doc.attributes.iter().find_map(|a| match a {
                            tl::enums::DocumentAttribute::Filename(f) => Some(f.file_name.clone()),
                            _ => None
                        }).unwrap_or("Unknown".to_string());
                        let size = doc.size as u64;
                        let mime = doc.mime_type.clone();
                        let ext = std::path::Path::new(&name).extension().map(|os| os.to_str().unwrap_or("").to_string());
                        let folder_id = match m.peer_id {
                            tl::enums::Peer::Channel(c) => Some(c.channel_id),
                            tl::enums::Peer::User(u) => Some(u.user_id),
                            tl::enums::Peer::Chat(c) => Some(c.chat_id),
                        };
                        files.push(FileMetadata {
                            id: m.id as i64, folder_id, name, size,
                            mime_type: Some(mime), file_ext: ext,
                            created_at: m.date.to_string(), icon_type: "file".into()
                        });
                    }
                }
            }
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn cmd_scan_folders(
    state: State<'_, TelegramState>,
) -> Result<Vec<FolderMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        return Ok(Vec::new());
    }
    let client = client_opt.unwrap();
    
    let mut folders = Vec::new();
    let mut dialogs = client.iter_dialogs();
    
    log::info!("Starting Folder Scan...");

    while let Some(dialog) = dialogs.next().await.map_err(|e| e.to_string())? {
        // Populate peer cache for every dialog we encounter (free priming)
        match &dialog.peer {
            Peer::Channel(c) => {
                let id = c.raw.id;
                state.peer_cache.write().await.insert(id, dialog.peer.clone());

                let name = c.raw.title.clone();
                let access_hash = c.raw.access_hash.unwrap_or(0);
                
                log::debug!("[SCAN] Processing Channel: '{}' (ID: {})", name, id);

                // Strategy 1: Title
                if name.to_lowercase().contains("[td]") {
                    log::info!(" -> MATCH via Title: {}", name);
                    let display_name = name.replace(" [TD]", "").replace(" [td]", "").replace("[TD]", "").replace("[td]", "").trim().to_string();
                    folders.push(FolderMetadata { id, name: display_name, parent_id: None });
                    continue; 
                }

                // Strategy 2: About
                let input_chan = tl::enums::InputChannel::Channel(tl::types::InputChannel {
                    channel_id: c.raw.id,
                    access_hash,
                });
                
                match client.invoke(&tl::functions::channels::GetFullChannel {
                    channel: input_chan,
                }).await {
                    Ok(tl::enums::messages::ChatFull::Full(f)) => {
                        if let tl::enums::ChatFull::Full(cf) = f.full_chat {
                             if cf.about.contains("[telegram-drive-folder]") {
                                 log::info!(" -> MATCH via About: {}", name);
                                 folders.push(FolderMetadata { id, name: name.clone(), parent_id: None });
                             }
                        }
                    },
                    Err(e) => log::warn!(" -> Failed to get full info: {}", e),
                }
            },
            Peer::User(u) => {
                state.peer_cache.write().await.insert(u.raw.id(), dialog.peer.clone());
                log::debug!("[SCAN] Cached User Peer: {}", u.raw.id());
            },
            peer => {
                log::debug!("[SCAN] Skipped Peer: {:?}", peer);
            }
        }
    }
    
    log::info!("Scan complete. Found {} folders. Peer cache size: {}.", folders.len(), state.peer_cache.read().await.len());

    Ok(folders)
}

#[tauri::command]
pub async fn cmd_get_total_storage(
    state: State<'_, TelegramState>,
) -> Result<u64, String> {
    let client = {
        state.client.lock().await.clone()
    }.ok_or_else(|| "Not connected".to_string())?;

    let mut total_size: u64 = 0;
    log::info!("Starting total storage calculation...");

    // 1. Scan Saved Messages (root)
    match resolve_peer(&client, None, &state.peer_cache).await {
        Ok(root_peer) => {
            log::info!("Resolved root peer for Saved Messages.");
            let mut msgs = client.iter_messages(&root_peer);
            loop {
                match msgs.next().await {
                    Ok(Some(msg)) => {
                        match msg.media() {
                            Some(Media::Document(d)) => total_size += d.size() as u64,
                            Some(Media::Photo(p)) => {
                                if let Some(tl::enums::Photo::Photo(raw)) = &p.raw.photo {
                                    for s in &raw.sizes {
                                        match s {
                                            tl::enums::PhotoSize::Size(ps) => total_size += ps.size as u64,
                                            tl::enums::PhotoSize::Progressive(ps) => total_size += *ps.sizes.iter().max().unwrap_or(&0) as u64,
                                            _ => {}
                                        }
                                        break; // Just add the largest/first valid size
                                    }
                                }
                            },
                            _ => {}
                        }
                    },
                    Ok(None) => break,
                    Err(e) => {
                        log::debug!("Iterating root messages stopped (likely reconnected/HMR): {}", e);
                        break;
                    }
                }
            }
            log::info!("Size after root: {}", total_size);
        }
        Err(e) => log::debug!("Failed to resolve root peer (likely reconnected): {}", e),
    }

    // 2. Scan all channels for [TD] and sum
    let mut dialogs = client.iter_dialogs();
    loop {
        match dialogs.next().await {
            Ok(Some(dialog)) => {
                if let Peer::Channel(c) = &dialog.peer {
                    let name = c.raw.title.clone();
                    let is_td = name.to_lowercase().contains("[td]");
                    if is_td {
                        log::info!("Scanning channel: {}", name);
                        let mut msgs = client.iter_messages(&dialog.peer);
                        loop {
                            match msgs.next().await {
                                Ok(Some(msg)) => {
                                    match msg.media() {
                                        Some(Media::Document(d)) => total_size += d.size() as u64,
                                        Some(Media::Photo(p)) => {
                                            if let Some(tl::enums::Photo::Photo(raw)) = &p.raw.photo {
                                                for s in &raw.sizes {
                                                    match s {
                                                        tl::enums::PhotoSize::Size(ps) => total_size += ps.size as u64,
                                                        tl::enums::PhotoSize::Progressive(ps) => total_size += *ps.sizes.iter().max().unwrap_or(&0) as u64,
                                                        _ => {}
                                                    }
                                                    break;
                                                }
                                            }
                                        },
                                        _ => {}
                                    }
                                },
                                Ok(None) => break,
                                Err(e) => {
                                    log::debug!("Iterating channel '{}' messages stopped: {}", name, e);
                                    break;
                                }
                            }
                        }
                    }
                }
            },
            Ok(None) => break,
            Err(e) => {
                log::debug!("Iterating dialogs stopped: {}", e);
                break;
            }
        }
    }

    log::info!("Total storage calculated: {} bytes", total_size);
    Ok(total_size)
}

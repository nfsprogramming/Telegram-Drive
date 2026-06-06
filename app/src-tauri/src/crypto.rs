use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{rand_core::OsRng as ArgonOsRng, PasswordHasher, SaltString},
    Argon2,
};
use rand::RngCore;
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};

/// Derives a 32-byte (256-bit) AES key from a password and a folder ID.
/// Uses the folder_id as a deterministic 8-byte salt for Argon2.
pub fn derive_vault_key(password: &str, folder_id: i64) -> Result<Vec<u8>, String> {
    let argon2 = Argon2::default();
    
    // Argon2 requires >= 8 bytes of salt. folder_id is exactly 8 bytes (i64).
    let salt = folder_id.to_le_bytes();

    let mut key = vec![0u8; 32];
    argon2.hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    Ok(key)
}

const CHUNK_SIZE: usize = 1024 * 1024; // 1MB chunks

/// Encrypts an AsyncRead stream on the fly and returns an AsyncRead stream of the ciphertext.
/// Returns (ciphertext_stream, ciphertext_total_size).
pub async fn encrypt_stream<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    mut reader: R,
    key: Vec<u8>,
    plaintext_size: u64,
) -> (DuplexStream, u64) {
    // Each chunk will grow by 12 bytes (Nonce) + 16 bytes (MAC) = 28 bytes.
    let num_chunks = (plaintext_size + CHUNK_SIZE as u64 - 1) / (CHUNK_SIZE as u64);
    let ciphertext_size = plaintext_size + (num_chunks * 28);
    
    let (mut tx, rx) = tokio::io::duplex(CHUNK_SIZE * 5); // 5MB buffer
    
    tokio::spawn(async move {
        let key = Key::<Aes256Gcm>::from_slice(&key);
        let cipher = Aes256Gcm::new(key);
        
        let mut buffer = vec![0u8; CHUNK_SIZE];
        loop {
            let n = match reader.read(&mut buffer).await {
                Ok(0) => break, // EOF
                Ok(n) => n,
                Err(_) => break,
            };
            
            let data_chunk = &buffer[..n];
            let nonce = Aes256Gcm::generate_nonce(&mut OsRng); // 12-bytes
            
            match cipher.encrypt(&nonce, data_chunk) {
                Ok(mut ciphertext) => {
                    // Write 12-byte nonce followed by ciphertext (which includes the 16-byte MAC)
                    let mut final_data = nonce.to_vec();
                    final_data.append(&mut ciphertext);
                    
                    if tx.write_all(&final_data).await.is_err() {
                        break; // Receiver dropped
                    }
                }
                Err(_) => break,
            }
        }
    });
    
    (rx, ciphertext_size)
}

/// Decrypts an AsyncRead stream on the fly and returns an AsyncRead stream of the plaintext.
pub async fn decrypt_stream<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    mut reader: R,
    key: Vec<u8>,
) -> DuplexStream {
    let (mut tx, rx) = tokio::io::duplex(CHUNK_SIZE * 5); // 5MB buffer
    
    tokio::spawn(async move {
        let key = Key::<Aes256Gcm>::from_slice(&key);
        let cipher = Aes256Gcm::new(key);
        
        // Each encrypted chunk is size n <= CHUNK_SIZE + 28.
        let mut buffer = vec![0u8; CHUNK_SIZE + 28];
        loop {
            let mut bytes_read = 0;
            while bytes_read < CHUNK_SIZE + 28 {
                match reader.read(&mut buffer[bytes_read..]).await {
                    Ok(0) => break,
                    Ok(n) => bytes_read += n,
                    Err(_) => break,
                }
            }
            
            if bytes_read == 0 { break; } // EOF
            
            if bytes_read < 12 {
                break; // Invalid chunk (too small to contain a nonce)
            }
            
            let nonce = Nonce::from_slice(&buffer[0..12]);
            let ciphertext = &buffer[12..bytes_read];
            
            match cipher.decrypt(nonce, ciphertext) {
                Ok(plaintext) => {
                    if tx.write_all(&plaintext).await.is_err() {
                        break; // Receiver dropped
                    }
                }
                Err(e) => {
                    log::error!("Decryption MAC check failed: {}", e);
                    break;
                }
            }
        }
    });
    
    rx
}

/// Encrypts a chunk of data using AES-256-GCM.
/// Generates a random 12-byte Nonce and prepends it to the ciphertext.
pub fn encrypt_chunk(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng); // 96-bits; 12-bytes
    
    let mut ciphertext = cipher.encrypt(&nonce, data)
        .map_err(|e| format!("Encryption failed: {}", e))?;
        
    // Prepend the nonce to the ciphertext
    let mut final_data = nonce.to_vec();
    final_data.append(&mut ciphertext);
    
    Ok(final_data)
}

/// Decrypts a chunk of data using AES-256-GCM.
/// Assumes the first 12 bytes are the Nonce.
pub fn decrypt_chunk(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("Data too short to contain a valid Nonce".to_string());
    }
    
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    
    let nonce = Nonce::from_slice(&data[0..12]);
    let ciphertext = &data[12..];
    
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;
        
    Ok(plaintext)
}

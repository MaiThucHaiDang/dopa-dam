//! Keeps the sign-in between restarts: the refresh token lives in the system's credential store
//! (Windows Credential Manager, or the Secret Service of GNOME Keyring / KWallet on Linux), never
//! in a plain file. Test runs (DOPADAM_DATA_DIR set) use a file in their temporary folder
//! so they never touch the real credentials.

use crate::sync::Stored;

const SERVICE: &str = "DopaDam";
const ACCOUNT: &str = "session";

#[cfg(target_os = "linux")]
const STORE_UNAVAILABLE: &str = "Không lưu được phiên đăng nhập: Linux chưa có kho khóa bí mật (Secret Service). \
     Hãy cài và mở khóa GNOME Keyring hoặc KWallet, rồi đăng nhập lại.";

fn test_file() -> Option<std::path::PathBuf> {
    std::env::var_os("DOPADAM_DATA_DIR").map(|d| std::path::PathBuf::from(d).join("session.json"))
}

pub fn load() -> Option<Stored> {
    let json = match test_file() {
        Some(path) => std::fs::read_to_string(path).ok()?,
        None => keyring::Entry::new(SERVICE, ACCOUNT).ok()?.get_password().ok()?,
    };
    serde_json::from_str(&json).ok()
}

/// Windows keeps going when the credential store refuses (as it always did); on Linux the secret
/// service may simply not be running, and signing in must then fail with a message instead.
pub fn save(stored: &Stored) -> Result<(), String> {
    let json = serde_json::to_string(stored).expect("session serialize");
    match test_file() {
        Some(path) => {
            let _ = std::fs::write(path, json);
            Ok(())
        }
        None => {
            #[cfg(windows)]
            {
                if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
                    let _ = entry.set_password(&json);
                }
                Ok(())
            }
            #[cfg(target_os = "linux")]
            {
                keyring::Entry::new(SERVICE, ACCOUNT).and_then(|entry| entry.set_password(&json)).map_err(|e| {
                    eprintln!("DopaDam: secret service: {e}");
                    STORE_UNAVAILABLE.to_string()
                })
            }
        }
    }
}

pub fn clear() {
    match test_file() {
        Some(path) => {
            let _ = std::fs::remove_file(path);
        }
        None => {
            if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
                let _ = entry.delete_credential();
            }
        }
    }
}

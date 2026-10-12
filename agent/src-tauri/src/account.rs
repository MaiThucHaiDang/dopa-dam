//! Keeps the sign-in between restarts: the refresh token lives in Windows Credential Manager
//! (never in a plain file). Test runs (DOPADAM_DATA_DIR set) use a file in their temporary folder
//! so they never touch the real credentials.

use crate::sync::Stored;

const SERVICE: &str = "DopaDam";
const ACCOUNT: &str = "session";

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

pub fn save(stored: &Stored) {
    let json = serde_json::to_string(stored).expect("session serialize");
    match test_file() {
        Some(path) => {
            let _ = std::fs::write(path, json);
        }
        None => {
            if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
                let _ = entry.set_password(&json);
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

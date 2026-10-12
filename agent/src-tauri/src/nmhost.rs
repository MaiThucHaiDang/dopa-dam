//! Registers the agent as Edge's native messaging host so the extension can reach it.
//! Edge starts dopadam.exe itself in host mode (see host.rs), which relays to the running agent.

use std::path::{Path, PathBuf};

pub const HOST_NAME: &str = "com.dang.dopadam";
/// Fixed by the "key" in extension/src/manifest.json.
pub const EXTENSION_ID: &str = "oaidmfkacjppoliemldjfbpnilmeejid";
pub const PIPE_NAME: &str = r"\\.\pipe\dopadam-agent";

const REGISTRY_KEYS: [&str; 2] = [
    r"Software\Microsoft\Edge\NativeMessagingHosts\com.dang.dopadam",
    r"Software\Google\Chrome\NativeMessagingHosts\com.dang.dopadam",
];

pub fn host_exe() -> Option<PathBuf> {
    std::env::current_exe().ok().filter(|p| p.exists())
}

pub fn manifest_json(host: &Path) -> String {
    serde_json::json!({
        "name": HOST_NAME,
        "description": "DopaDam agent bridge",
        "path": host.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    })
    .to_string()
}

/// Writes the host manifest and points the browsers' registry keys at it (current user only).
pub fn register(data_dir: &Path) -> Result<PathBuf, String> {
    let host = host_exe().ok_or("Không xác định được đường dẫn của dopadam.exe")?;
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let manifest = data_dir.join(format!("{HOST_NAME}.json"));
    std::fs::write(&manifest, manifest_json(&host)).map_err(|e| e.to_string())?;
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    for key in REGISTRY_KEYS {
        let (k, _) = hkcu.create_subkey(key).map_err(|e| e.to_string())?;
        k.set_value("", &manifest.to_string_lossy().to_string()).map_err(|e| e.to_string())?;
    }
    Ok(manifest)
}

pub fn is_registered() -> bool {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    hkcu.open_subkey(REGISTRY_KEYS[0]).and_then(|k| k.get_value::<String, _>("")).is_ok_and(|p| Path::new(&p).exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_allows_only_the_extension() {
        let json: serde_json::Value = serde_json::from_str(&manifest_json(Path::new(r"C:\x\dopadam.exe"))).unwrap();
        assert_eq!(json["name"], HOST_NAME);
        assert_eq!(json["type"], "stdio");
        assert_eq!(
            json["allowed_origins"],
            serde_json::json!(["chrome-extension://oaidmfkacjppoliemldjfbpnilmeejid/"])
        );
        assert_eq!(json["path"], r"C:\x\dopadam.exe");
    }
}

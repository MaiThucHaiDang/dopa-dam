//! Registers the agent as the browser's native messaging host so the extension can reach it.
//! The browser starts the agent's executable itself in host mode (see host.rs), which relays to
//! the running agent. Windows registers through the registry, Linux through manifest files.

use std::path::{Path, PathBuf};

pub const HOST_NAME: &str = "com.dang.dopadam";
/// Fixed by the "key" in extension/src/manifest.json.
pub const EXTENSION_ID: &str = "oaidmfkacjppoliemldjfbpnilmeejid";
#[cfg(windows)]
pub const PIPE_NAME: &str = r"\\.\pipe\dopadam-agent";

#[cfg(windows)]
const REGISTRY_KEYS: [&str; 2] = [
    r"Software\Microsoft\Edge\NativeMessagingHosts\com.dang.dopadam",
    r"Software\Google\Chrome\NativeMessagingHosts\com.dang.dopadam",
];

pub fn host_exe() -> Option<PathBuf> {
    // Inside an AppImage current_exe points into a temporary mount: the AppImage file is the program.
    #[cfg(target_os = "linux")]
    {
        if let Some(path) = appimage_path(std::env::var_os("APPIMAGE")) {
            return Some(path);
        }
    }
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
#[cfg(windows)]
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

/// Registers dopadam:// for the current user so the browser can hand the Google sign-in back to the agent.
#[cfg(windows)]
pub fn register_protocol() -> Result<(), String> {
    let exe = host_exe().ok_or("Không xác định được đường dẫn của dopadam.exe")?;
    let exe = exe.to_string_lossy().to_string();
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let (root, _) = hkcu.create_subkey(r"Software\Classes\dopadam").map_err(|e| e.to_string())?;
    root.set_value("", &"URL:DopaDam".to_string()).map_err(|e| e.to_string())?;
    root.set_value("URL Protocol", &String::new()).map_err(|e| e.to_string())?;
    let (icon, _) = root.create_subkey("DefaultIcon").map_err(|e| e.to_string())?;
    icon.set_value("", &format!("{exe},0")).map_err(|e| e.to_string())?;
    let (cmd, _) = root.create_subkey(r"shell\open\command").map_err(|e| e.to_string())?;
    cmd.set_value("", &format!("\"{exe}\" \"%1\"")).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(windows)]
pub fn is_registered() -> bool {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    hkcu.open_subkey(REGISTRY_KEYS[0]).and_then(|k| k.get_value::<String, _>("")).is_ok_and(|p| Path::new(&p).exists())
}

// ---- Linux ---------------------------------------------------------------------------------

/// Configuration folders (under `~/.config`) of the Chromium-family browsers that can run the extension.
#[cfg(target_os = "linux")]
const BROWSER_CONFIG_DIRS: [&str; 4] = ["microsoft-edge", "google-chrome", "chromium", "BraveSoftware/Brave-Browser"];

/// Name of the file that makes the agent the handler of dopadam://.
#[cfg(target_os = "linux")]
pub const PROTOCOL_DESKTOP_FILE: &str = "dopadam-url-handler.desktop";

#[cfg(target_os = "linux")]
fn appimage_path(var: Option<std::ffi::OsString>) -> Option<PathBuf> {
    var.map(PathBuf::from).filter(|p| p.is_absolute() && p.exists())
}

#[cfg(target_os = "linux")]
fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "Không xác định được thư mục HOME".to_string())
}

/// Where the manifest goes: the `NativeMessagingHosts` folder of every browser that has a
/// configuration folder under `<home>/.config`.
#[cfg(target_os = "linux")]
pub fn manifest_targets(home: &Path) -> Vec<PathBuf> {
    BROWSER_CONFIG_DIRS
        .iter()
        .map(|dir| home.join(".config").join(dir))
        .filter(|dir| dir.is_dir())
        .map(|dir| dir.join("NativeMessagingHosts").join(format!("{HOST_NAME}.json")))
        .collect()
}

/// Writes the manifest for each installed browser; returns the files written.
#[cfg(target_os = "linux")]
pub fn register_in(home: &Path, host: &Path) -> Result<Vec<PathBuf>, String> {
    if !host.is_absolute() {
        return Err(format!("Đường dẫn của chương trình không tuyệt đối: {}", host.display()));
    }
    let targets = manifest_targets(home);
    if targets.is_empty() {
        return Err("Không tìm thấy trình duyệt Chromium nào (Edge, Chrome, Chromium, Brave) trong ~/.config".into());
    }
    let json = manifest_json(host);
    for file in &targets {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        if std::fs::read_to_string(file).ok().as_deref() != Some(json.as_str()) {
            std::fs::write(file, &json).map_err(|e| format!("{}: {e}", file.display()))?;
        }
    }
    Ok(targets)
}

/// At least one manifest exists and points at a file that exists.
#[cfg(target_os = "linux")]
pub fn registered_in(home: &Path) -> bool {
    manifest_targets(home).iter().any(|file| {
        std::fs::read_to_string(file)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|v| v.get("path").and_then(|p| p.as_str().map(PathBuf::from)))
            .is_some_and(|p| p.exists())
    })
}

#[cfg(target_os = "linux")]
pub fn register(_data_dir: &Path) -> Result<PathBuf, String> {
    let host = host_exe().ok_or("Không xác định được đường dẫn của chương trình DopaDam")?;
    let written = register_in(&home_dir()?, &host)?;
    Ok(written.into_iter().next().unwrap_or_default())
}

#[cfg(target_os = "linux")]
pub fn is_registered() -> bool {
    home_dir().is_ok_and(|home| registered_in(&home))
}

/// A value of the `Exec` key, quoted so that the path survives spaces and `%` field codes.
#[cfg(target_os = "linux")]
fn exec_quote(path: &str) -> String {
    let mut out = String::from("\"");
    for c in path.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            '%' => out.push_str("%%"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The `.desktop` file that makes the agent the handler of dopadam://.
#[cfg(target_os = "linux")]
pub fn protocol_desktop_entry(exe: &Path) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=DopaDam\nExec={} %u\nTerminal=false\nNoDisplay=true\n\
         MimeType=x-scheme-handler/dopadam;\n",
        exec_quote(&exe.to_string_lossy())
    )
}

/// Writes the handler file into `applications_dir`; returns its path.
#[cfg(target_os = "linux")]
pub fn write_protocol_handler(applications_dir: &Path, exe: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(applications_dir).map_err(|e| format!("{}: {e}", applications_dir.display()))?;
    let file = applications_dir.join(PROTOCOL_DESKTOP_FILE);
    let text = protocol_desktop_entry(exe);
    if std::fs::read_to_string(&file).ok().as_deref() != Some(text.as_str()) {
        std::fs::write(&file, text).map_err(|e| format!("{}: {e}", file.display()))?;
    }
    Ok(file)
}

/// Registers dopadam:// for the current user: a `.desktop` file plus `xdg-mime default`.
#[cfg(target_os = "linux")]
pub fn register_protocol() -> Result<(), String> {
    let exe = host_exe().ok_or("Không xác định được đường dẫn của chương trình DopaDam")?;
    let data_home = match std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => home_dir()?.join(".local").join("share"),
    };
    write_protocol_handler(&data_home.join("applications"), &exe)?;
    let status = std::process::Command::new("xdg-mime")
        .args(["default", PROTOCOL_DESKTOP_FILE, "x-scheme-handler/dopadam"])
        .status()
        .map_err(|e| format!("Không chạy được xdg-mime: {e}"))?;
    status.success().then_some(()).ok_or_else(|| format!("xdg-mime báo lỗi: {status}"))
}

/// The agent's socket: `$XDG_RUNTIME_DIR/dopadam-agent.sock`, or in the data folder without that variable.
#[cfg(unix)]
pub fn socket_path_in(runtime_dir: Option<std::ffi::OsString>, data_dir: &Path) -> PathBuf {
    let dir = runtime_dir.filter(|d| !d.is_empty()).map(PathBuf::from).unwrap_or_else(|| data_dir.to_path_buf());
    dir.join("dopadam-agent.sock")
}

#[cfg(unix)]
pub fn socket_path() -> PathBuf {
    socket_path_in(std::env::var_os("XDG_RUNTIME_DIR"), &crate::data_dir())
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

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dopadam-nmhost-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn manifests_go_to_the_browsers_that_exist() {
        let home = scratch("targets");
        assert!(manifest_targets(&home).is_empty());
        std::fs::create_dir_all(home.join(".config/microsoft-edge")).unwrap();
        std::fs::create_dir_all(home.join(".config/BraveSoftware/Brave-Browser")).unwrap();
        std::fs::create_dir_all(home.join(".config/firefox")).unwrap();
        assert_eq!(
            manifest_targets(&home),
            vec![
                home.join(".config/microsoft-edge/NativeMessagingHosts/com.dang.dopadam.json"),
                home.join(".config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.dang.dopadam.json"),
            ]
        );
        let _ = std::fs::remove_dir_all(home);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn registering_writes_an_absolute_manifest_and_is_then_reported() {
        let home = scratch("register");
        let host = home.join("DopaDam.AppImage");
        assert!(register_in(&home, &host).unwrap_err().contains("Chromium"));
        std::fs::create_dir_all(home.join(".config/google-chrome")).unwrap();
        std::fs::create_dir_all(home.join(".config/chromium")).unwrap();
        // The program does not exist yet: manifests are written but do not count as registered.
        let written = register_in(&home, &host).unwrap();
        assert_eq!(written.len(), 2);
        assert!(!registered_in(&home));
        std::fs::write(&host, "").unwrap();
        assert!(registered_in(&home));
        let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&written[0]).unwrap()).unwrap();
        assert_eq!(json["path"], host.to_string_lossy().as_ref());
        assert_eq!(json["type"], "stdio");
        assert_eq!(
            json["allowed_origins"],
            serde_json::json!(["chrome-extension://oaidmfkacjppoliemldjfbpnilmeejid/"])
        );
        assert!(register_in(&home, Path::new("relative/dopadam")).is_err());
        let _ = std::fs::remove_dir_all(home);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_appimage_variable_wins_only_when_it_points_at_a_file() {
        let dir = scratch("appimage");
        let image = dir.join("DopaDam.AppImage");
        assert_eq!(appimage_path(Some(image.clone().into())), None);
        std::fs::write(&image, "").unwrap();
        assert_eq!(appimage_path(Some(image.clone().into())), Some(image));
        assert_eq!(appimage_path(Some("relative".into())), None);
        assert_eq!(appimage_path(None), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_protocol_handler_is_a_desktop_file_for_the_scheme() {
        let dir = scratch("protocol");
        let apps = dir.join("applications");
        let file = write_protocol_handler(&apps, Path::new("/opt/Dopa Dam/100%/dopadam")).unwrap();
        assert_eq!(file, apps.join("dopadam-url-handler.desktop"));
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("MimeType=x-scheme-handler/dopadam;\n"));
        assert!(text.contains("Exec=\"/opt/Dopa Dam/100%%/dopadam\" %u\n"));
        assert!(text.starts_with("[Desktop Entry]\nType=Application\n"));
        assert_eq!(exec_quote(r#"a"b$c\d"#), r#""a\"b\$c\\d""#);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn the_socket_lives_in_the_runtime_dir() {
        let data = Path::new("/data/DopaDam");
        assert_eq!(
            socket_path_in(Some("/run/user/1000".into()), data),
            PathBuf::from("/run/user/1000/dopadam-agent.sock")
        );
        assert_eq!(socket_path_in(None, data), PathBuf::from("/data/DopaDam/dopadam-agent.sock"));
        assert_eq!(socket_path_in(Some("".into()), data), PathBuf::from("/data/DopaDam/dopadam-agent.sock"));
    }
}

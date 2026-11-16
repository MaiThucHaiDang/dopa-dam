//! The one place that picks the operating system: everything the rest of the agent needs from
//! the OS is reached as `crate::platform::…`. `win.rs` is the Windows implementation and
//! `linux.rs` the Linux one; both offer the same functions (see win.rs for their meaning).

#[cfg(windows)]
pub use crate::win::*;

#[cfg(target_os = "linux")]
pub use crate::linux::*;

use serde::Serialize;
use std::path::PathBuf;

// ---- Window titles -------------------------------------------------------------------
// On Linux the GNOME Shell companion finds the agent's own windows by title, so they differ.

#[cfg(windows)]
pub const MAIN_TITLE: &str = "DopaDam";
#[cfg(windows)]
pub const WARNING_TITLE: &str = "DopaDam";
#[cfg(windows)]
pub const NOTICE_TITLE: &str = "DopaDam";

#[cfg(target_os = "linux")]
pub const MAIN_TITLE: &str = "DopaDam";
#[cfg(target_os = "linux")]
pub const WARNING_TITLE: &str = "DopaDam – cảnh báo";
#[cfg(target_os = "linux")]
pub const NOTICE_TITLE: &str = "DopaDam – thông báo";

// ---- Names that differ per system ----------------------------------------------------

/// Edge's program name: the default "do not track" rule, and the "Edge runs without the extension" check.
#[cfg(windows)]
pub const EDGE_EXE: &str = "msedge.exe";
#[cfg(target_os = "linux")]
pub const EDGE_EXE: &str = "msedge";

/// Value of the `platform` column of this device's row on the sync server.
#[cfg(windows)]
pub const DEVICE_PLATFORM: &str = "windows";
#[cfg(target_os = "linux")]
pub const DEVICE_PLATFORM: &str = "linux";

/// Name shown for this computer in the device list.
pub fn device_name() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Máy tính".into())
    }
    #[cfg(target_os = "linux")]
    {
        host_name(std::fs::read_to_string("/etc/hostname").ok().as_deref(), std::env::var("HOSTNAME").ok().as_deref())
    }
}

/// /etc/hostname first, then the HOSTNAME variable, then a fixed name.
#[cfg_attr(windows, allow(dead_code))]
fn host_name(etc_hostname: Option<&str>, env: Option<&str>) -> String {
    [etc_hostname, env]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map_or_else(|| "Máy tính".to_string(), String::from)
}

/// Folder with the agent's database and files (before the DOPADAM_DATA_DIR override).
pub fn default_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("DopaDam")
    }
    #[cfg(target_os = "linux")]
    {
        linux_data_dir(std::env::var_os("XDG_DATA_HOME"), std::env::var_os("HOME"))
    }
}

/// `$XDG_DATA_HOME/DopaDam`, else `~/.local/share/DopaDam` (an empty variable counts as unset).
#[cfg_attr(windows, allow(dead_code))]
pub fn linux_data_dir(xdg_data_home: Option<std::ffi::OsString>, home: Option<std::ffi::OsString>) -> PathBuf {
    linux_data_home(xdg_data_home, home).join("DopaDam")
}

/// `$XDG_DATA_HOME`, else `~/.local/share` (an empty variable counts as unset).
#[cfg_attr(windows, allow(dead_code))]
pub fn linux_data_home(xdg_data_home: Option<std::ffi::OsString>, home: Option<std::ffi::OsString>) -> PathBuf {
    match xdg_data_home.filter(|v| !v.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => match home.filter(|v| !v.is_empty()) {
            Some(home) => PathBuf::from(home).join(".local").join("share"),
            None => std::env::temp_dir(),
        },
    }
}

// ---- Program or web domain? ----------------------------------------------------------
// Rules of kind "exe" hold program names, rules of kind "domain" hold sites, and allow windows
// can hold either. The program name has to be told from a domain by its shape.

/// True when `name` can be the identity of a program (as opposed to a web domain).
pub fn is_program_name(name: &str) -> bool {
    #[cfg(windows)]
    {
        name.ends_with(".exe")
    }
    #[cfg(target_os = "linux")]
    {
        unix_program_name(name)
    }
}

/// Linux program names are plain file names (`steam`, `brave`, `python3.12`). A name that has a dot
/// and ends in a letters-only label (`youtube.com`) is a domain.
#[cfg_attr(windows, allow(dead_code))]
fn unix_program_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 || name.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    if name.contains(['/', '\\', ':']) || name.starts_with('.') {
        return false;
    }
    match name.rsplit_once('.') {
        Some((_, last)) => !(last.len() >= 2 && last.chars().all(|c| c.is_ascii_alphabetic())),
        None => true,
    }
}

/// What the user typed or picked for a program, reduced to the file name the guard compares
/// (lower case, no folders); `None` when it cannot be a program.
pub fn normalize_program_name(input: &str) -> Option<String> {
    let e = input.trim().to_lowercase();
    let name = e.rsplit(['\\', '/']).next()?.to_string();
    #[cfg(windows)]
    {
        (name.ends_with(".exe") && name.len() > 4).then_some(name)
    }
    #[cfg(target_os = "linux")]
    {
        unix_program_name(&name).then_some(name)
    }
}

// ---- get_platform --------------------------------------------------------------------

/// What the UI learns about the system the agent runs on.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// "windows" | "linux"
    pub os: &'static str,
    /// "wayland" | "x11" on Linux, `null` elsewhere or when unknown.
    pub session_type: Option<&'static str>,
    /// "win32" | "gnome-shell" | "x11" | "none"
    pub focus_backend: &'static str,
    pub shell_extension_connected: bool,
    /// The desktop is GNOME (`XDG_CURRENT_DESKTOP`). Always false on Windows.
    pub gnome: bool,
    /// The GNOME Shell extension is in the user's extension folder or a system one.
    pub shell_extension_installed: bool,
    /// The user's copy of the extension differs from the one embedded in the agent.
    pub shell_extension_update_available: bool,
}

pub fn platform_info() -> PlatformInfo {
    #[cfg(windows)]
    {
        PlatformInfo {
            os: "windows",
            session_type: None,
            focus_backend: "win32",
            shell_extension_connected: false,
            gnome: false,
            shell_extension_installed: false,
            shell_extension_update_available: false,
        }
    }
    #[cfg(target_os = "linux")]
    {
        let backend = crate::linux::backend();
        let files = crate::shellext::current_files_status();
        PlatformInfo {
            os: "linux",
            session_type: backend.session_type,
            focus_backend: backend.focus_backend,
            shell_extension_connected: backend.shell_connected,
            gnome: crate::shellext::running_on_gnome(),
            shell_extension_installed: files.installed,
            shell_extension_update_available: files.update_available,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn data_dir_follows_xdg_then_home() {
        assert_eq!(
            linux_data_dir(Some(OsString::from("/x/data")), Some(OsString::from("/home/a"))),
            PathBuf::from("/x/data/DopaDam")
        );
        assert_eq!(
            linux_data_dir(None, Some(OsString::from("/home/a"))),
            PathBuf::from("/home/a/.local/share/DopaDam")
        );
        // An empty variable is the same as no variable.
        assert_eq!(
            linux_data_dir(Some(OsString::new()), Some(OsString::from("/home/a"))),
            PathBuf::from("/home/a/.local/share/DopaDam")
        );
    }

    #[test]
    fn host_name_prefers_the_file() {
        assert_eq!(host_name(Some("laptop\n"), Some("other")), "laptop");
        assert_eq!(host_name(Some("  \n"), Some("other")), "other");
        assert_eq!(host_name(None, None), "Máy tính");
    }

    #[test]
    fn programs_are_told_from_domains() {
        for program in ["steam", "brave", "msedge", "python3.12", "gnome-terminal-server", "cs2_linux64"] {
            assert!(unix_program_name(program), "{program}");
        }
        for domain in ["youtube.com", "www.facebook.com", "news.ycombinator.com", "x.co"] {
            assert!(!unix_program_name(domain), "{domain}");
        }
        for invalid in ["", "a b", "/usr/bin/steam", ".hidden", "c:foo"] {
            assert!(!unix_program_name(invalid), "{invalid}");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn user_input_is_reduced_to_a_file_name() {
        assert_eq!(normalize_program_name("  /usr/bin/Steam "), Some("steam".into()));
        assert_eq!(normalize_program_name("brave"), Some("brave".into()));
        assert_eq!(normalize_program_name("youtube.com"), None);
        assert_eq!(normalize_program_name("/usr/bin/"), None);
        assert!(is_program_name("steam"));
        assert!(!is_program_name("youtube.com"));
        assert_eq!(EDGE_EXE, "msedge");
        assert_eq!(DEVICE_PLATFORM, "linux");
    }

    #[cfg(windows)]
    #[test]
    fn windows_programs_end_in_exe() {
        assert_eq!(normalize_program_name(r"C:\Games\Steam.EXE"), Some("steam.exe".into()));
        assert_eq!(normalize_program_name(".exe"), None);
        assert_eq!(normalize_program_name("youtube.com"), None);
        assert!(is_program_name("steam.exe"));
    }

    #[test]
    fn platform_info_uses_the_camel_case_shape() {
        let info = PlatformInfo {
            os: "linux",
            session_type: Some("wayland"),
            focus_backend: "gnome-shell",
            shell_extension_connected: true,
            gnome: true,
            shell_extension_installed: true,
            shell_extension_update_available: false,
        };
        assert_eq!(
            serde_json::to_value(&info).unwrap(),
            serde_json::json!({
                "os": "linux", "sessionType": "wayland", "focusBackend": "gnome-shell", "shellExtensionConnected": true,
                "gnome": true, "shellExtensionInstalled": true, "shellExtensionUpdateAvailable": false
            })
        );
        let none = PlatformInfo {
            os: "windows",
            session_type: None,
            focus_backend: "win32",
            shell_extension_connected: false,
            gnome: false,
            shell_extension_installed: false,
            shell_extension_update_available: false,
        };
        assert!(serde_json::to_value(&none).unwrap()["sessionType"].is_null());
    }
}

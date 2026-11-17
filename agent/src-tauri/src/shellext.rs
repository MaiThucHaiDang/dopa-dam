//! The GNOME Shell extension that ships inside the agent (Linux only).
//!
//! On GNOME with Wayland the agent cannot see the focused window by itself, so a small Shell
//! extension reports it over the agent's socket. The three extension files are embedded here, which
//! makes the agent the single source: the "install" command copies them to the user's extension
//! folder and puts the extension in the Shell's list of enabled extensions.
//!
//! Layering: everything below the "Process layer" heading is pure or takes its folder and its
//! settings store as parameters, so the tests run against a temporary folder and a fake settings
//! store. Only [`install_for_current_user`] touches the real home folder and the real `gsettings`.

use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The extension's uuid, also the name of its folder.
pub const UUID: &str = "dopadam@dang";

/// The files of the extension, as `(file name, content)`. Embedded at build time.
pub const FILES: [(&str, &str); 3] = [
    ("metadata.json", include_str!("../../../linux/gnome-shell-extension/dopadam@dang/metadata.json")),
    ("extension.js", include_str!("../../../linux/gnome-shell-extension/dopadam@dang/extension.js")),
    ("protocol.js", include_str!("../../../linux/gnome-shell-extension/dopadam@dang/protocol.js")),
];

const SCHEMA: &str = "org.gnome.shell";
const ENABLED_KEY: &str = "enabled-extensions";
const DISABLED_KEY: &str = "disabled-extensions";

// ---- Folders ---------------------------------------------------------------------------

/// `$XDG_DATA_HOME/gnome-shell/extensions/dopadam@dang`, else `~/.local/share/...` (an empty
/// variable counts as unset).
pub fn user_extension_dir(xdg_data_home: Option<OsString>, home: Option<OsString>) -> PathBuf {
    crate::platform::linux_data_home(xdg_data_home, home).join("gnome-shell").join("extensions").join(UUID)
}

/// The folder `install` may write to: like [`user_extension_dir`], but an error when neither
/// `XDG_DATA_HOME` nor `HOME` is set (the data home would fall back to the temp directory) or when
/// the data home is not an absolute path.
pub fn checked_user_extension_dir(xdg_data_home: Option<OsString>, home: Option<OsString>) -> Result<PathBuf, String> {
    let set = |v: &Option<OsString>| v.as_ref().is_some_and(|v| !v.is_empty());
    if !set(&xdg_data_home) && !set(&home) {
        return Err("Không biết thư mục dữ liệu của người dùng (HOME và XDG_DATA_HOME đều chưa đặt).".to_string());
    }
    let data_home = crate::platform::linux_data_home(xdg_data_home, home);
    if !data_home.is_absolute() {
        return Err(format!("Thư mục dữ liệu của người dùng không phải đường dẫn tuyệt đối: {}", data_home.display()));
    }
    Ok(data_home.join("gnome-shell").join("extensions").join(UUID))
}

/// The extension folders under the system data directories (`XDG_DATA_DIRS`, default
/// `/usr/local/share:/usr/share`).
pub fn system_extension_dirs(xdg_data_dirs: Option<&str>) -> Vec<PathBuf> {
    let dirs = xdg_data_dirs.filter(|v| !v.is_empty()).unwrap_or("/usr/local/share:/usr/share");
    dirs.split(':')
        .filter(|d| d.starts_with('/'))
        .map(|d| Path::new(d).join("gnome-shell").join("extensions").join(UUID))
        .collect()
}

/// `XDG_CURRENT_DESKTOP` is a colon-separated list such as `ubuntu:GNOME`.
pub fn is_gnome(xdg_current_desktop: Option<&str>) -> bool {
    xdg_current_desktop.is_some_and(|v| v.split(':').any(|d| d.trim().eq_ignore_ascii_case("gnome")))
}

// ---- Files -----------------------------------------------------------------------------

/// What [`sync_files`] did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilesOutcome {
    /// The folder had no extension before.
    Installed,
    /// At least one file was missing or different and has been rewritten.
    Updated,
    /// Every file was already identical; nothing was written.
    UpToDate,
}

/// Makes `dir` hold exactly `files`: creates the folder, writes the files whose content differs
/// (through a temporary file and a rename, so the Shell never reads a half-written file) and leaves
/// identical files alone.
pub fn sync_files(dir: &Path, files: &[(&str, &str)]) -> std::io::Result<FilesOutcome> {
    let existed = dir.join("metadata.json").is_file();
    std::fs::create_dir_all(dir)?;
    let mut changed = false;
    for (name, content) in files {
        let path = dir.join(name);
        if std::fs::read_to_string(&path).is_ok_and(|current| current == *content) {
            continue;
        }
        // The process id keeps two running instances from writing the same temporary file.
        let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
        std::fs::write(&tmp, content)?;
        std::fs::rename(&tmp, &path)?;
        changed = true;
    }
    Ok(match (changed, existed) {
        (false, _) => FilesOutcome::UpToDate,
        (true, false) => FilesOutcome::Installed,
        (true, true) => FilesOutcome::Updated,
    })
}

/// True when every file in `dir` is identical to the embedded one.
fn dir_matches(dir: &Path, files: &[(&str, &str)]) -> bool {
    files.iter().all(|(name, content)| std::fs::read_to_string(dir.join(name)).is_ok_and(|c| c == *content))
}

/// What get_platform tells the UI about the extension files.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FilesStatus {
    /// The extension is in the user folder or in a system folder.
    pub installed: bool,
    /// The user's copy differs from the embedded one. A system copy is never reported as
    /// outdated: installing writes a user copy, which the Shell prefers, so it could be replaced
    /// without root, but nobody asked for it; it belongs to whoever installed it.
    pub update_available: bool,
}

pub fn files_status(user_dir: &Path, system_dirs: &[PathBuf], files: &[(&str, &str)]) -> FilesStatus {
    if user_dir.join("metadata.json").is_file() {
        return FilesStatus { installed: true, update_available: !dir_matches(user_dir, files) };
    }
    FilesStatus { installed: system_dirs.iter().any(|d| d.join("metadata.json").is_file()), update_available: false }
}

// ---- The gsettings list value ------------------------------------------------------------

/// Parses a GVariant string array as `gsettings get` prints it: `['a@b', 'c@d']`, `@as []`, `[]`.
/// `None` when the text is not such a list (the caller then leaves the setting alone).
pub fn parse_string_list(text: &str) -> Option<Vec<String>> {
    let text = text.trim();
    let text = text.strip_prefix("@as").map_or(text, str::trim_start);
    let mut chars = text.strip_prefix('[')?.chars().peekable();
    let mut items = Vec::new();
    loop {
        while chars.next_if(|c| c.is_whitespace()).is_some() {}
        match chars.next()? {
            ']' => break,
            quote @ ('\'' | '"') => {
                let mut item = String::new();
                loop {
                    match chars.next()? {
                        // Only the escapes gsettings prints for these ids; anything else (`\u00XX`, `\r`, …)
                        // would be rewritten wrongly, so the whole value is refused.
                        '\\' => item.push(match chars.next()? {
                            c @ ('\\' | '\'' | '"') => c,
                            'n' => '\n',
                            't' => '\t',
                            _ => return None,
                        }),
                        c if c == quote => break,
                        c => item.push(c),
                    }
                }
                items.push(item);
                while chars.next_if(|c| c.is_whitespace()).is_some() {}
                match chars.next()? {
                    ',' => {}
                    ']' => break,
                    _ => return None,
                }
            }
            _ => return None,
        }
    }
    // Nothing but whitespace may follow the closing bracket.
    chars.all(char::is_whitespace).then_some(items)
}

/// The text `gsettings set` takes for a string list. An empty list needs its type spelled out.
pub fn format_string_list(items: &[String]) -> String {
    if items.is_empty() {
        return "@as []".to_string();
    }
    let quoted: Vec<String> = items
        .iter()
        .map(|item| format!("'{}'", item.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n")))
        .collect();
    format!("[{}]", quoted.join(", "))
}

/// The settings to write so that `uuid` is enabled. `None` for a key means it needs no change.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EnablePlan {
    pub enabled: Option<String>,
    pub disabled: Option<String>,
}

/// Given the current `enabled-extensions` and `disabled-extensions` values as `gsettings get`
/// printed them: add `uuid` to the first when missing (at the end, keeping the others and their
/// order) and remove it from the second when present. `Err` when either value cannot be parsed.
pub fn plan_enable(enabled: &str, disabled: &str, uuid: &str) -> Result<EnablePlan, String> {
    let mut enabled_list = parse_string_list(enabled).ok_or("Không đọc được danh sách tiện ích GNOME đang bật.")?;
    let mut disabled_list = parse_string_list(disabled).ok_or("Không đọc được danh sách tiện ích GNOME đang tắt.")?;
    let mut plan = EnablePlan::default();
    if !enabled_list.iter().any(|e| e == uuid) {
        enabled_list.push(uuid.to_string());
        plan.enabled = Some(format_string_list(&enabled_list));
    }
    if disabled_list.iter().any(|e| e == uuid) {
        disabled_list.retain(|e| e != uuid);
        plan.disabled = Some(format_string_list(&disabled_list));
    }
    Ok(plan)
}

// ---- Installing ---------------------------------------------------------------------------

/// Where the Shell's settings are read and written. The real one runs `gsettings`; tests use a fake.
pub trait ShellSettings {
    fn get(&self, key: &str) -> Result<String, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
}

/// What the install command returns to the UI.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    /// "installed" | "updated" | "upToDate"
    pub outcome: &'static str,
    /// The extension was added to `enabled-extensions` (or removed from `disabled-extensions`).
    pub enabled_changed: bool,
    /// The user has to log out and in: the Shell is not connected, or it is connected but runs
    /// the old files that have just been replaced.
    pub needs_logout: bool,
}

/// Copies the embedded extension into `dir` and enables it through `settings`.
///
/// The settings are read first and nothing is written when they cannot be understood. The files go
/// next and the settings last; after writing, the list is read back, because without a dconf
/// backend `gsettings set` succeeds without saving anything.
pub fn install(
    dir: &Path,
    files: &[(&str, &str)],
    settings: &dyn ShellSettings,
    shell_connected: bool,
) -> Result<InstallResult, String> {
    // A developer may have linked the folder to the repository: never write through it.
    if std::fs::symlink_metadata(dir).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(format!("{} là liên kết (symlink), nên không ghi đè lên đó.", dir.display()));
    }
    let enabled = settings.get(ENABLED_KEY)?;
    let disabled = settings.get(DISABLED_KEY)?;
    let plan = plan_enable(&enabled, &disabled, UUID)?;

    let outcome = sync_files(dir, files).map_err(|e| format!("Không chép được tiện ích vào {}: {e}", dir.display()))?;

    if let Some(value) = &plan.enabled {
        settings.set(ENABLED_KEY, value)?;
    }
    if let Some(value) = &plan.disabled {
        settings.set(DISABLED_KEY, value)?;
    }
    if plan.enabled.is_some() || plan.disabled.is_some() {
        let saved = settings.get(ENABLED_KEY)?;
        if !parse_string_list(&saved).is_some_and(|l| l.iter().any(|e| e == UUID)) {
            return Err("GNOME không lưu thay đổi danh sách tiện ích.".to_string());
        }
    }

    Ok(InstallResult {
        outcome: match outcome {
            FilesOutcome::Installed => "installed",
            FilesOutcome::Updated => "updated",
            FilesOutcome::UpToDate => "upToDate",
        },
        enabled_changed: plan.enabled.is_some() || plan.disabled.is_some(),
        needs_logout: !shell_connected || outcome != FilesOutcome::UpToDate,
    })
}

// ---- Process layer (only the Tauri command and get_platform reach this) -------------------------

/// `gsettings get/set org.gnome.shell <key>`.
struct Gsettings;

impl ShellSettings for Gsettings {
    fn get(&self, key: &str) -> Result<String, String> {
        run_gsettings(&["get", SCHEMA, key])
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        run_gsettings(&["set", SCHEMA, key, value]).map(|_| ())
    }
}

fn run_gsettings(args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("gsettings")
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("Không chạy được gsettings: {e}"))?;
    if !output.status.success() {
        let why = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gsettings báo lỗi: {}", why.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn current_user_dir() -> Result<PathBuf, String> {
    checked_user_extension_dir(std::env::var_os("XDG_DATA_HOME"), std::env::var_os("HOME"))
}

/// Whether the desktop is GNOME, from the environment.
pub fn running_on_gnome() -> bool {
    is_gnome(std::env::var("XDG_CURRENT_DESKTOP").ok().as_deref())
}

/// The state of the extension files for the real user and system folders.
pub fn current_files_status() -> FilesStatus {
    let system = system_extension_dirs(std::env::var("XDG_DATA_DIRS").ok().as_deref());
    match current_user_dir() {
        Ok(user) => files_status(&user, &system, &FILES),
        // No usable user folder: only a system copy can be there.
        Err(_) => FilesStatus { installed: system.iter().any(|d| d.join("metadata.json").is_file()), update_available: false },
    }
}

/// The command behind the "Cài tiện ích GNOME" button.
pub fn install_for_current_user() -> Result<InstallResult, String> {
    if !running_on_gnome() {
        return Err("Chỉ cài được tiện ích trên màn hình GNOME.".to_string());
    }
    install(&current_user_dir()?, &FILES, &Gsettings, crate::platform::shell_extension_connected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    /// A scratch folder under the system temp directory, removed on drop. Never the real home.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Scratch {
            let dir = std::env::temp_dir().join(format!("dopadam-shellext-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A fake settings store; `lose_writes` mimics gsettings without a dconf backend.
    struct FakeSettings {
        values: RefCell<BTreeMap<String, String>>,
        writes: RefCell<Vec<(String, String)>>,
        lose_writes: bool,
    }

    impl FakeSettings {
        fn new(enabled: &str, disabled: &str) -> FakeSettings {
            let values = BTreeMap::from([
                (ENABLED_KEY.to_string(), enabled.to_string()),
                (DISABLED_KEY.to_string(), disabled.to_string()),
            ]);
            FakeSettings { values: RefCell::new(values), writes: RefCell::new(vec![]), lose_writes: false }
        }
    }

    impl ShellSettings for FakeSettings {
        fn get(&self, key: &str) -> Result<String, String> {
            self.values.borrow().get(key).cloned().ok_or_else(|| "no such key".to_string())
        }

        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            self.writes.borrow_mut().push((key.to_string(), value.to_string()));
            if !self.lose_writes {
                self.values.borrow_mut().insert(key.to_string(), value.to_string());
            }
            Ok(())
        }
    }

    const FILES_A: [(&str, &str); 2] = [("metadata.json", "{\"a\":1}"), ("extension.js", "let a;")];

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn embedded_files_are_the_real_extension() {
        assert_eq!(FILES.map(|f| f.0), ["metadata.json", "extension.js", "protocol.js"]);
        let metadata: serde_json::Value = serde_json::from_str(FILES[0].1).unwrap();
        assert_eq!(metadata["uuid"], UUID);
        assert!(FILES.iter().all(|(_, content)| !content.is_empty()));
    }

    #[test]
    fn parses_the_values_gsettings_prints() {
        assert_eq!(parse_string_list("@as []\n"), Some(vec![]));
        assert_eq!(parse_string_list("[]"), Some(vec![]));
        assert_eq!(parse_string_list("['a@b', 'c@d']\n"), Some(strings(&["a@b", "c@d"])));
        assert_eq!(parse_string_list("['only@one']"), Some(strings(&["only@one"])));
        assert_eq!(parse_string_list("[ 'a' ,\n 'b' , ]"), Some(strings(&["a", "b"])));
        assert_eq!(parse_string_list("[\"a@b\", 'c']"), Some(strings(&["a@b", "c"])));
        assert_eq!(parse_string_list(r"['it\'s', 'back\\slash']"), Some(strings(&["it's", "back\\slash"])));
        assert_eq!(parse_string_list(r#"['q\"x', 'a\nb', 'c\td']"#), Some(strings(&["q\"x", "a\nb", "c\td"])));
    }

    #[test]
    fn unknown_escapes_make_the_list_unreadable() {
        for bad in [r"['a\u0041']", r"['a\r']", r"['a\a']", r"['a\x41']", r"['a\0']", r"['\q']"] {
            assert_eq!(parse_string_list(bad), None, "{bad:?}");
        }
        // The install then leaves the settings alone.
        assert!(plan_enable(r"['a\u0041']", "@as []", UUID).is_err());
    }

    #[test]
    fn rejects_what_is_not_a_string_list() {
        for bad in ["", "   ", "@as", "['a'", "['a' 'b']", "['a'] x", "[1, 2]", "'a'", "['unterminated", "[,]", "true"]
        {
            assert_eq!(parse_string_list(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn formats_what_gsettings_set_takes() {
        assert_eq!(format_string_list(&[]), "@as []");
        assert_eq!(format_string_list(&strings(&["a@b"])), "['a@b']");
        assert_eq!(format_string_list(&strings(&["a@b", "c@d"])), "['a@b', 'c@d']");
        assert_eq!(format_string_list(&strings(&["it's", "a\\b"])), r"['it\'s', 'a\\b']");
    }

    #[test]
    fn format_and_parse_round_trip() {
        let list = strings(&["a@b", "it's", "back\\slash", "tab\tin", "line\nbreak", "", "ünï@cødé"]);
        assert_eq!(parse_string_list(&format_string_list(&list)), Some(list));
        assert_eq!(parse_string_list(&format_string_list(&[])), Some(vec![]));
    }

    #[test]
    fn enabling_adds_at_the_end_and_keeps_the_rest() {
        let plan = plan_enable("['ding@rastersoft.com', 'ubuntu-dock@ubuntu.com']", "@as []", UUID).unwrap();
        assert_eq!(plan.enabled.as_deref(), Some("['ding@rastersoft.com', 'ubuntu-dock@ubuntu.com', 'dopadam@dang']"));
        assert_eq!(plan.disabled, None);

        let plan = plan_enable("@as []", "@as []", UUID).unwrap();
        assert_eq!(plan.enabled.as_deref(), Some("['dopadam@dang']"));
    }

    #[test]
    fn enabling_is_a_no_op_when_already_listed() {
        let plan = plan_enable("['x@y', 'dopadam@dang']", "['other@one']", UUID).unwrap();
        assert_eq!(plan, EnablePlan::default());
    }

    #[test]
    fn enabling_removes_it_from_the_disabled_list() {
        let plan = plan_enable("['dopadam@dang']", "['dopadam@dang', 'other@one']", UUID).unwrap();
        assert_eq!(plan.enabled, None);
        assert_eq!(plan.disabled.as_deref(), Some("['other@one']"));

        let plan = plan_enable("@as []", "['dopadam@dang']", UUID).unwrap();
        assert_eq!(plan.enabled.as_deref(), Some("['dopadam@dang']"));
        assert_eq!(plan.disabled.as_deref(), Some("@as []"));
    }

    #[test]
    fn enabling_refuses_values_it_cannot_read() {
        assert!(plan_enable("garbage", "@as []", UUID).is_err());
        assert!(plan_enable("@as []", "garbage", UUID).is_err());
    }

    #[test]
    fn folders_follow_xdg_then_home() {
        assert_eq!(
            user_extension_dir(Some(OsString::from("/x/data")), Some(OsString::from("/home/a"))),
            PathBuf::from("/x/data/gnome-shell/extensions/dopadam@dang")
        );
        assert_eq!(
            user_extension_dir(Some(OsString::new()), Some(OsString::from("/home/a"))),
            PathBuf::from("/home/a/.local/share/gnome-shell/extensions/dopadam@dang")
        );
        assert_eq!(
            system_extension_dirs(None),
            [
                PathBuf::from("/usr/local/share/gnome-shell/extensions/dopadam@dang"),
                PathBuf::from("/usr/share/gnome-shell/extensions/dopadam@dang"),
            ]
        );
        // Relative entries are ignored.
        assert_eq!(
            system_extension_dirs(Some("/opt/share:rel:")),
            [PathBuf::from("/opt/share/gnome-shell/extensions/dopadam@dang")]
        );
    }

    #[test]
    fn install_folder_needs_an_absolute_data_home() {
        let some = |s: &str| Some(OsString::from(s));
        assert_eq!(
            checked_user_extension_dir(some("/x/data"), some("/home/a")),
            Ok(PathBuf::from("/x/data/gnome-shell/extensions/dopadam@dang"))
        );
        assert_eq!(
            checked_user_extension_dir(None, some("/home/a")),
            Ok(PathBuf::from("/home/a/.local/share/gnome-shell/extensions/dopadam@dang"))
        );
        assert_eq!(
            checked_user_extension_dir(some(""), some("/home/a")),
            Ok(PathBuf::from("/home/a/.local/share/gnome-shell/extensions/dopadam@dang"))
        );
        // Neither variable set: the data home would be the temp directory.
        assert!(checked_user_extension_dir(None, None).is_err());
        assert!(checked_user_extension_dir(some(""), some("")).is_err());
        // Relative data homes.
        assert!(checked_user_extension_dir(some("data"), some("/home/a")).is_err());
        assert!(checked_user_extension_dir(None, some("home/a")).is_err());
    }

    #[test]
    fn gnome_is_recognised_in_the_desktop_list() {
        assert!(is_gnome(Some("GNOME")));
        assert!(is_gnome(Some("ubuntu:GNOME")));
        assert!(is_gnome(Some("GNOME-Classic:GNOME")));
        assert!(is_gnome(Some("gnome")));
        assert!(!is_gnome(Some("KDE")));
        assert!(!is_gnome(Some("X-Cinnamon")));
        assert!(!is_gnome(Some("")));
        assert!(!is_gnome(None));
    }

    #[test]
    fn sync_installs_updates_and_skips_identical_files() {
        let scratch = Scratch::new("sync");
        let dir = scratch.0.join("nested").join("dopadam@dang");

        assert_eq!(sync_files(&dir, &FILES_A).unwrap(), FilesOutcome::Installed);
        assert_eq!(std::fs::read_to_string(dir.join("extension.js")).unwrap(), "let a;");

        // Identical content is not rewritten: the modification time stays.
        let before = std::fs::metadata(dir.join("extension.js")).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        assert_eq!(sync_files(&dir, &FILES_A).unwrap(), FilesOutcome::UpToDate);
        assert_eq!(std::fs::metadata(dir.join("extension.js")).unwrap().modified().unwrap(), before);

        let newer = [("metadata.json", "{\"a\":1}"), ("extension.js", "let b;")];
        assert_eq!(sync_files(&dir, &newer).unwrap(), FilesOutcome::Updated);
        assert_eq!(std::fs::read_to_string(dir.join("extension.js")).unwrap(), "let b;");

        // A file that went missing counts as an update; no temporary files are left behind.
        std::fs::remove_file(dir.join("extension.js")).unwrap();
        assert_eq!(sync_files(&dir, &newer).unwrap(), FilesOutcome::Updated);
        let mut names: Vec<String> =
            std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["extension.js", "metadata.json"]);
    }

    #[test]
    fn status_reads_the_user_copy_first_then_the_system_ones() {
        let scratch = Scratch::new("status");
        let user = scratch.0.join("user");
        let system = scratch.0.join("system");
        let systems = [system.clone()];

        assert_eq!(files_status(&user, &systems, &FILES_A), FilesStatus { installed: false, update_available: false });

        sync_files(&system, &FILES_A).unwrap();
        // A system copy counts as installed and is never offered an update.
        let other = [("metadata.json", "{\"a\":2}"), ("extension.js", "let a;")];
        assert_eq!(files_status(&user, &systems, &FILES_A), FilesStatus { installed: true, update_available: false });
        assert_eq!(files_status(&user, &systems, &other), FilesStatus { installed: true, update_available: false });

        sync_files(&user, &FILES_A).unwrap();
        assert_eq!(files_status(&user, &systems, &FILES_A), FilesStatus { installed: true, update_available: false });
        assert_eq!(files_status(&user, &systems, &other), FilesStatus { installed: true, update_available: true });

        // A user copy with a missing file is outdated too.
        std::fs::remove_file(user.join("extension.js")).unwrap();
        assert!(files_status(&user, &systems, &FILES_A).update_available);
    }

    #[test]
    fn first_install_writes_files_and_enables_the_extension() {
        let scratch = Scratch::new("first");
        let dir = scratch.0.join("dopadam@dang");
        let settings = FakeSettings::new("['ding@rastersoft.com']", "@as []");

        let result = install(&dir, &FILES_A, &settings, false).unwrap();
        assert_eq!(result, InstallResult { outcome: "installed", enabled_changed: true, needs_logout: true });
        assert!(dir.join("metadata.json").is_file());
        assert_eq!(
            *settings.writes.borrow(),
            [(ENABLED_KEY.to_string(), "['ding@rastersoft.com', 'dopadam@dang']".to_string())]
        );
    }

    #[test]
    fn installing_again_changes_nothing() {
        let scratch = Scratch::new("again");
        let dir = scratch.0.join("dopadam@dang");
        let settings = FakeSettings::new("['dopadam@dang']", "@as []");
        sync_files(&dir, &FILES_A).unwrap();

        // Connected and identical: nothing to do, no log-out.
        let result = install(&dir, &FILES_A, &settings, true).unwrap();
        assert_eq!(result, InstallResult { outcome: "upToDate", enabled_changed: false, needs_logout: false });
        assert!(settings.writes.borrow().is_empty());

        // Identical but the Shell has not connected: the user still has to log in again.
        let result = install(&dir, &FILES_A, &settings, false).unwrap();
        assert_eq!(result, InstallResult { outcome: "upToDate", enabled_changed: false, needs_logout: true });
    }

    #[test]
    fn updating_while_connected_still_needs_a_logout() {
        let scratch = Scratch::new("update");
        let dir = scratch.0.join("dopadam@dang");
        let settings = FakeSettings::new("['dopadam@dang']", "@as []");
        sync_files(&dir, &FILES_A).unwrap();

        let newer = [("metadata.json", "{\"a\":1}"), ("extension.js", "let b;")];
        let result = install(&dir, &newer, &settings, true).unwrap();
        assert_eq!(result, InstallResult { outcome: "updated", enabled_changed: false, needs_logout: true });
        assert!(settings.writes.borrow().is_empty());
    }

    #[test]
    fn install_clears_the_disabled_entry() {
        let scratch = Scratch::new("disabled");
        let dir = scratch.0.join("dopadam@dang");
        let settings = FakeSettings::new("['dopadam@dang']", "['dopadam@dang', 'x@y']");

        let result = install(&dir, &FILES_A, &settings, false).unwrap();
        assert!(result.enabled_changed);
        assert_eq!(*settings.writes.borrow(), [(DISABLED_KEY.to_string(), "['x@y']".to_string())]);
    }

    #[test]
    fn a_symlinked_extension_folder_is_not_written_through() {
        let scratch = Scratch::new("symlink");
        let real = scratch.0.join("repo");
        std::fs::create_dir_all(&real).unwrap();
        let dir = scratch.0.join("dopadam@dang");
        std::os::unix::fs::symlink(&real, &dir).unwrap();
        let settings = FakeSettings::new("@as []", "@as []");

        let err = install(&dir, &FILES_A, &settings, false).unwrap_err();
        assert!(err.contains("symlink"), "{err}");
        assert_eq!(std::fs::read_dir(&real).unwrap().count(), 0);
        assert!(settings.writes.borrow().is_empty());
    }

    #[test]
    fn temporary_file_names_carry_the_process_id() {
        let scratch = Scratch::new("tmpname");
        let dir = scratch.0.join("dopadam@dang");
        // A leftover temporary file of another process is neither reused nor removed.
        std::fs::create_dir_all(&dir).unwrap();
        let other = dir.join(".extension.js.1.tmp");
        std::fs::write(&other, "other").unwrap();
        sync_files(&dir, &FILES_A).unwrap();
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "other");
        assert!(!dir.join(format!(".extension.js.{}.tmp", std::process::id())).exists());
    }

    #[test]
    fn unreadable_settings_stop_the_install_before_any_file_is_written() {
        let scratch = Scratch::new("garbage");
        let dir = scratch.0.join("dopadam@dang");
        let settings = FakeSettings::new("garbage", "@as []");

        assert!(install(&dir, &FILES_A, &settings, false).is_err());
        assert!(!dir.exists());
        assert!(settings.writes.borrow().is_empty());
    }

    #[test]
    fn a_setting_that_was_not_saved_is_reported() {
        let scratch = Scratch::new("lost");
        let dir = scratch.0.join("dopadam@dang");
        let mut settings = FakeSettings::new("@as []", "@as []");
        settings.lose_writes = true;

        assert!(install(&dir, &FILES_A, &settings, false).is_err());
    }
}

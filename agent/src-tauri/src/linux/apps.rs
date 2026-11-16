//! Installed programs on Linux, read from `.desktop` files. Best effort: the program name is the
//! file name of the first token of `Exec`; programs are also recorded when they first come to the front.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// What one `.desktop` file says about a program.
#[derive(Clone, Debug, PartialEq)]
pub struct DesktopApp {
    /// Lower-case program file name, the same identity the foreground tracking produces.
    pub exe: String,
    pub name: String,
    /// The first token of `Exec` (a path or a bare command), for finding the program's path.
    pub command: String,
}

/// Programs that are launchers or interpreters, so their file name says nothing about the program.
const GENERIC: [&str; 6] = ["sh", "bash", "dash", "env", "wine", "xdg-open"];

/// Splits an `Exec` value into words: whitespace separates, single and double quotes group,
/// and a backslash inside double quotes escapes the next character.
pub fn split_exec(exec: &str) -> Vec<String> {
    let mut words = vec![];
    let mut cur = String::new();
    let mut started = false;
    let mut chars = exec.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                started = true;
                while let Some(q) = chars.next() {
                    match q {
                        '"' => break,
                        '\\' => cur.extend(chars.next()),
                        other => cur.push(other),
                    }
                }
            }
            '\'' => {
                started = true;
                for q in chars.by_ref() {
                    if q == '\'' {
                        break;
                    }
                    cur.push(q);
                }
            }
            c if c.is_whitespace() => {
                if started {
                    words.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            c => {
                started = true;
                cur.push(c);
            }
        }
    }
    if started {
        words.push(cur);
    }
    words
}

fn is_env_assignment(word: &str) -> bool {
    match word.split_once('=') {
        Some((name, _)) => {
            !name.is_empty()
                && !name.starts_with(|c: char| c.is_ascii_digit())
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        }
        None => false,
    }
}

fn file_name_lower(word: &str) -> String {
    Path::new(word).file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Reads one `.desktop` file. `None` for entries that are not shown (NoDisplay, Hidden), are not of
/// type Application, or whose program cannot be told.
pub fn parse_desktop_entry(text: &str) -> Option<DesktopApp> {
    let (mut kind, mut name, mut exec) = (None, None, None);
    let (mut no_display, mut hidden) = (false, false);
    let mut in_entry = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            if in_entry {
                break;
            }
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry || line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim();
        match key.trim() {
            "Type" => kind = Some(value.to_string()),
            "Name" => name = Some(value.to_string()),
            "Exec" => exec = Some(value.to_string()),
            "NoDisplay" => no_display = value.eq_ignore_ascii_case("true"),
            "Hidden" => hidden = value.eq_ignore_ascii_case("true"),
            _ => {}
        }
    }
    if kind.as_deref() != Some("Application") || no_display || hidden {
        return None;
    }
    let words = split_exec(&exec?);
    let mut rest = words.as_slice();
    // `env VAR=value … program`, or `VAR=value program`.
    loop {
        match rest.first() {
            Some(w) if w == "env" || w.starts_with('-') || is_env_assignment(w) => rest = &rest[1..],
            _ => break,
        }
    }
    let command = rest.first()?.clone();
    let mut exe = file_name_lower(&command);
    // Flatpak and snap launch the program through a wrapper: the program is named in the arguments.
    if exe == "flatpak" {
        exe = rest.iter().find_map(|w| w.strip_prefix("--command=")).map(str::to_lowercase).unwrap_or_default();
    } else if exe == "snap" && rest.get(1).is_some_and(|w| w == "run") {
        exe = rest.get(2).map(|w| file_name_lower(w)).unwrap_or_default();
    }
    if exe.is_empty() || GENERIC.contains(&exe.as_str()) {
        return None;
    }
    let name = name.filter(|n| !n.is_empty()).unwrap_or_else(|| exe.clone());
    Some(DesktopApp { exe, name, command })
}

/// The folders that hold `.desktop` files: user, system, Flatpak exports and Snap, without repeats.
pub fn application_dirs(
    home: Option<&Path>,
    xdg_data_home: Option<&OsStr>,
    xdg_data_dirs: Option<&OsStr>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![];
    match xdg_data_home.filter(|v| !v.is_empty()) {
        Some(dir) => dirs.push(Path::new(dir).join("applications")),
        None => dirs.extend(home.map(|h| h.join(".local/share/applications"))),
    }
    match xdg_data_dirs.filter(|v| !v.is_empty()) {
        Some(list) => {
            dirs.extend(std::env::split_paths(list).filter(|p| p.is_absolute()).map(|p| p.join("applications")))
        }
        None => {
            dirs.push("/usr/local/share/applications".into());
            dirs.push("/usr/share/applications".into());
        }
    }
    dirs.push("/usr/share/applications".into());
    dirs.push("/var/lib/flatpak/exports/share/applications".into());
    dirs.extend(home.map(|h| h.join(".local/share/flatpak/exports/share/applications")));
    dirs.push("/var/lib/snapd/desktop/applications".into());
    let mut seen = vec![];
    dirs.retain(|d| {
        let fresh = !seen.contains(d);
        seen.push(d.clone());
        fresh
    });
    dirs
}

fn collect_desktop_files(dir: &Path, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > 2 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_desktop_files(&path, out, depth + 1);
        } else if path.extension().is_some_and(|e| e == "desktop") {
            out.push(path);
        }
    }
}

/// Full path of a command: as given when absolute, else the first match on PATH.
fn resolve_command(command: &str) -> Option<PathBuf> {
    let path = Path::new(command);
    if path.is_absolute() {
        return Some(path.to_path_buf());
    }
    std::env::split_paths(&std::env::var_os("PATH")?).map(|d| d.join(command)).find(|p| p.is_file())
}

/// Installed programs: (program file name, display name, full path).
pub fn scan() -> Vec<(String, String, String)> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let dirs = application_dirs(
        home.as_deref(),
        std::env::var_os("XDG_DATA_HOME").as_deref(),
        std::env::var_os("XDG_DATA_DIRS").as_deref(),
    );
    let mut files = vec![];
    for dir in &dirs {
        collect_desktop_files(dir, &mut files, 0);
    }
    let mut out = vec![];
    for file in files {
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        if let Some(app) = parse_desktop_entry(&text) {
            let path = resolve_command(&app.command).unwrap_or_else(|| file.clone());
            out.push((app.exe, app.name, path.to_string_lossy().into_owned()));
        }
    }
    // One entry per program (several launchers can start the same one), listed by name.
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.dedup_by(|a, b| a.0 == b.0);
    out.sort_by_key(|a| a.1.to_lowercase());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(body: &str) -> String {
        format!("[Desktop Entry]\n{body}\n")
    }

    #[test]
    fn reads_a_plain_application() {
        let text = entry("Type=Application\nName=Steam\nName[vi]=Hơi nước\nExec=/usr/bin/steam %U\nIcon=steam");
        assert_eq!(
            parse_desktop_entry(&text),
            Some(DesktopApp { exe: "steam".into(), name: "Steam".into(), command: "/usr/bin/steam".into() })
        );
    }

    #[test]
    fn hidden_and_non_applications_are_skipped() {
        assert_eq!(parse_desktop_entry(&entry("Type=Application\nName=A\nExec=a\nNoDisplay=true")), None);
        assert_eq!(parse_desktop_entry(&entry("Type=Application\nName=A\nExec=a\nHidden=true")), None);
        assert_eq!(parse_desktop_entry(&entry("Type=Link\nName=A\nURL=https://x.example")), None);
        assert_eq!(parse_desktop_entry(&entry("Type=Directory\nName=A")), None);
        assert_eq!(parse_desktop_entry(&entry("Type=Application\nName=A")), None);
        assert!(parse_desktop_entry(&entry("Type=Application\nName=A\nExec=a\nNoDisplay=false")).is_some());
    }

    #[test]
    fn env_prefixes_are_dropped() {
        let text =
            entry("Type=Application\nName=Brave\nExec=env BAMF_DESKTOP_FILE_HINT=/x/brave.desktop /snap/bin/Brave %U");
        assert_eq!(parse_desktop_entry(&text).unwrap().exe, "brave");
        let text = entry("Type=Application\nName=G\nExec=GDK_BACKEND=x11 LANG=C \"/opt/My Game/Game\" --fullscreen");
        let app = parse_desktop_entry(&text).unwrap();
        assert_eq!((app.exe.as_str(), app.command.as_str()), ("game", "/opt/My Game/Game"));
    }

    #[test]
    fn only_the_desktop_entry_group_counts() {
        let text =
            "[Desktop Entry]\nType=Application\nName=Foo\nExec=foo\n\n[Desktop Action new]\nName=New\nExec=other\n";
        let app = parse_desktop_entry(text).unwrap();
        assert_eq!((app.exe.as_str(), app.name.as_str()), ("foo", "Foo"));
    }

    #[test]
    fn launchers_are_resolved_or_skipped() {
        let flatpak =
            entry("Type=Application\nName=X\nExec=/usr/bin/flatpak run --branch=stable --command=xchat org.x.Chat");
        assert_eq!(parse_desktop_entry(&flatpak).unwrap().exe, "xchat");
        assert_eq!(parse_desktop_entry(&entry("Type=Application\nName=X\nExec=flatpak run org.x.Chat")), None);
        assert_eq!(parse_desktop_entry(&entry("Type=Application\nName=X\nExec=snap run vlc")).unwrap().exe, "vlc");
        assert_eq!(parse_desktop_entry(&entry("Type=Application\nName=X\nExec=sh -c 'foo --bar'")), None);
    }

    #[test]
    fn exec_words_follow_quotes() {
        assert_eq!(split_exec(r#"a "b c" 'd e' f\g"#), vec!["a", "b c", "d e", r"f\g"]);
        assert_eq!(split_exec(r#""a \"q\" b" c"#), vec![r#"a "q" b"#, "c"]);
        assert_eq!(split_exec("  "), Vec::<String>::new());
        assert_eq!(split_exec(r#""" x"#), vec!["", "x"]);
    }

    #[test]
    fn standard_directories_are_listed_once() {
        let dirs = application_dirs(
            Some(Path::new("/home/a")),
            None,
            Some(OsStr::new("/usr/local/share:/usr/share:/relative")),
        );
        assert_eq!(dirs[0], PathBuf::from("/home/a/.local/share/applications"));
        assert!(dirs.contains(&PathBuf::from("/usr/share/applications")));
        assert!(dirs.contains(&PathBuf::from("/var/lib/flatpak/exports/share/applications")));
        assert!(dirs.contains(&PathBuf::from("/home/a/.local/share/flatpak/exports/share/applications")));
        assert!(dirs.contains(&PathBuf::from("/var/lib/snapd/desktop/applications")));
        assert!(!dirs.iter().any(|d| d.starts_with("relative")));
        assert_eq!(dirs.iter().filter(|d| **d == Path::new("/usr/share/applications")).count(), 1);
        let custom = application_dirs(Some(Path::new("/home/a")), Some(OsStr::new("/data")), None);
        assert_eq!(custom[0], PathBuf::from("/data/applications"));
    }
}

//! Linux implementation of the platform API (the counterpart of win.rs). Window *content* is
//! never read, and neither are window titles: only which program owns the window in front.
//!
//! Where the foreground program comes from:
//! * the GNOME Shell companion extension, a client of the agent's socket (needed under Wayland);
//! * an X11 watcher (x11.rs), used while no shell client is connected.
//!
//! This module keeps the latest focus, monitor rectangle, full-screen flag and idle seconds that the
//! active source reported, and answers the platform API from them. A program is identified by the
//! lower-cased file name of `/proc/<pid>/exe`. The opaque window handle is the source's window id.

mod apps;
mod x11;

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::mpsc::Sender;
use std::sync::{Mutex, MutexGuard};
use tokio::sync::mpsc::UnboundedSender;

/// Physical-pixel rectangle (x, y, width, height).
pub type Rect = (i32, i32, i32, i32);

/// Version of the protocol spoken with the shell extension.
pub const SHELL_PROTOCOL: i64 = 1;

/// A window that came to the front, identified by its owning process.
#[derive(Clone, Debug, PartialEq)]
pub struct Foreground {
    pub hwnd: isize,
    pub pid: u32,
    /// Lower-case file name, e.g. "steam".
    pub exe: String,
    pub path: String,
}

/// What a source reports about the focused window.
#[derive(Clone, Debug, PartialEq)]
pub struct Focus {
    pub window_id: isize,
    pub pid: u32,
    pub fullscreen: bool,
    pub monitor: Option<Rect>,
}

/// A message from the shell extension.
#[derive(Clone, Debug, PartialEq)]
pub enum ShellEvent {
    Hello {
        protocol: i64,
        shell_version: String,
    },
    /// `None`: no window has focus.
    Focus(Option<Focus>),
    Idle(u64),
}

/// Reads a message of the shell protocol; `None` for anything else.
pub fn parse_shell_event(msg: &Value) -> Option<ShellEvent> {
    match msg.get("type")?.as_str()? {
        "shell_hello" => Some(ShellEvent::Hello {
            protocol: msg.get("protocol").and_then(Value::as_i64).unwrap_or(0),
            shell_version: msg.get("shellVersion").and_then(Value::as_str).unwrap_or("").to_string(),
        }),
        "focus" => {
            let window_id = msg.get("windowId").and_then(Value::as_i64)?;
            let pid = msg.get("pid").and_then(Value::as_u64).unwrap_or(0);
            if window_id == 0 || pid == 0 || pid > u64::from(u32::MAX) {
                return Some(ShellEvent::Focus(None));
            }
            let int = |m: &Value, k: &str| m.get(k).and_then(Value::as_f64).map(|v| v as i32);
            let monitor = msg
                .get("monitor")
                .filter(|m| m.is_object())
                .and_then(|m| Some((int(m, "x")?, int(m, "y")?, int(m, "width")?, int(m, "height")?)));
            Some(ShellEvent::Focus(Some(Focus {
                window_id: window_id as isize,
                pid: pid as u32,
                fullscreen: msg.get("fullscreen").and_then(Value::as_bool).unwrap_or(false),
                monitor,
            })))
        }
        "idle" => Some(ShellEvent::Idle(msg.get("seconds").and_then(Value::as_u64)?)),
        _ => None,
    }
}

pub fn shell_minimize_msg(window_id: isize) -> String {
    json!({"type": "shell_minimize", "windowId": window_id}).to_string()
}

pub fn shell_activate_msg(window_id: isize) -> String {
    json!({"type": "shell_activate", "windowId": window_id}).to_string()
}

pub fn shell_raise_msg(pid: u32, title: &str, above: bool, activate: bool) -> String {
    json!({"type": "shell_raise", "pid": pid, "title": title, "above": above, "activate": activate}).to_string()
}

// ---- The model -----------------------------------------------------------------------

struct ShellClient {
    id: u64,
    tx: UnboundedSender<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Source {
    Shell,
    X11,
    None,
}

/// How many windows each source remembers (only the latest focus of a window is ever asked for).
const WINDOW_MEMORY: usize = 256;

struct Model {
    /// Where foreground changes are announced (guard::on_foreground consumes the other end).
    announce: Option<Sender<isize>>,
    shell: Option<ShellClient>,
    shell_focus: Option<Focus>,
    shell_windows: BTreeMap<isize, Focus>,
    shell_idle: u64,
    x11_available: bool,
    x11_focus: Option<Focus>,
    x11_windows: BTreeMap<isize, Focus>,
    x11_idle: u64,
}

fn remember(windows: &mut BTreeMap<isize, Focus>, focus: &Focus) {
    if windows.len() >= WINDOW_MEMORY && !windows.contains_key(&focus.window_id) {
        windows.clear();
    }
    windows.insert(focus.window_id, focus.clone());
}

impl Model {
    const fn new() -> Model {
        Model {
            announce: None,
            shell: None,
            shell_focus: None,
            shell_windows: BTreeMap::new(),
            shell_idle: 0,
            x11_available: false,
            x11_focus: None,
            x11_windows: BTreeMap::new(),
            x11_idle: 0,
        }
    }

    /// Under Wayland X11 only sees XWayland windows, so a shell client takes over completely.
    fn source(&self) -> Source {
        if self.shell.is_some() {
            Source::Shell
        } else if self.x11_available {
            Source::X11
        } else {
            Source::None
        }
    }

    fn current(&self) -> Option<&Focus> {
        match self.source() {
            Source::Shell => self.shell_focus.as_ref(),
            Source::X11 => self.x11_focus.as_ref(),
            Source::None => None,
        }
    }

    fn current_id(&self) -> isize {
        self.current().map_or(0, |f| f.window_id)
    }

    fn window(&self, id: isize) -> Option<Focus> {
        match self.source() {
            Source::Shell => self.shell_windows.get(&id).cloned(),
            Source::X11 => self.x11_windows.get(&id).cloned(),
            Source::None => None,
        }
    }

    fn idle(&self) -> u64 {
        match self.source() {
            Source::Shell => self.shell_idle,
            Source::X11 => self.x11_idle,
            Source::None => 0,
        }
    }

    /// The window to announce when the focus moved from the window `before` to another one.
    fn moved_from(&self, before: isize) -> Option<isize> {
        let now = self.current_id();
        (now != 0 && now != before).then_some(now)
    }

    fn shell_connected(&mut self, id: u64, tx: UnboundedSender<String>) -> Option<isize> {
        let before = self.current_id();
        self.shell = Some(ShellClient { id, tx });
        self.shell_focus = None;
        self.shell_windows.clear();
        self.shell_idle = 0;
        self.moved_from(before)
    }

    fn shell_gone(&mut self, id: u64) -> Option<isize> {
        if self.shell.as_ref().map(|s| s.id) != Some(id) {
            return None;
        }
        let before = self.current_id();
        self.shell = None;
        self.shell_focus = None;
        self.shell_windows.clear();
        self.shell_idle = 0;
        self.moved_from(before)
    }

    /// Applies a message of the registered shell client; returns the window to announce, if any.
    fn apply_shell(&mut self, client: u64, event: ShellEvent) -> Option<isize> {
        if self.shell.as_ref().map(|s| s.id) != Some(client) {
            return None;
        }
        let before = self.current_id();
        match event {
            ShellEvent::Hello { .. } => return None,
            ShellEvent::Focus(None) => self.shell_focus = None,
            ShellEvent::Focus(Some(focus)) => {
                remember(&mut self.shell_windows, &focus);
                self.shell_focus = Some(focus);
            }
            ShellEvent::Idle(seconds) => self.shell_idle = seconds,
        }
        self.moved_from(before)
    }

    fn set_x11_available(&mut self, available: bool) -> Option<isize> {
        let before = self.current_id();
        self.x11_available = available;
        if !available {
            self.x11_focus = None;
            self.x11_windows.clear();
            self.x11_idle = 0;
        }
        self.moved_from(before)
    }

    fn apply_x11_focus(&mut self, focus: Option<Focus>) -> Option<isize> {
        let before = self.current_id();
        if let Some(f) = &focus {
            remember(&mut self.x11_windows, f);
        }
        self.x11_focus = focus;
        self.moved_from(before)
    }
}

static MODEL: Mutex<Model> = Mutex::new(Model::new());

fn model() -> MutexGuard<'static, Model> {
    MODEL.lock().unwrap_or_else(|e| e.into_inner())
}

/// Runs a change of the model and announces the new foreground window, if it changed.
fn update(change: impl FnOnce(&mut Model) -> Option<isize>) {
    let (window, tx) = {
        let mut m = model();
        (change(&mut m), m.announce.clone())
    };
    if let (Some(window), Some(tx)) = (window, tx) {
        let _ = tx.send(window);
    }
}

// ---- Fed by the sources ----------------------------------------------------------------

/// A shell extension said hello (protocol already checked): it becomes the foreground source.
pub fn shell_connected(client: u64, tx: UnboundedSender<String>) {
    update(|m| m.shell_connected(client, tx));
}

/// The socket connection of a client closed (nothing happens unless it was the shell).
pub fn shell_gone(client: u64) {
    update(|m| m.shell_gone(client));
}

pub fn apply_shell_event(client: u64, event: ShellEvent) {
    update(|m| m.apply_shell(client, event));
}

fn set_x11_available(available: bool) {
    update(|m| m.set_x11_available(available));
}

fn apply_x11_focus(focus: Option<Focus>) {
    update(|m| m.apply_x11_focus(focus));
}

fn set_x11_idle(seconds: u64) {
    model().x11_idle = seconds;
}

fn send_shell(message: String) -> bool {
    model().shell.as_ref().is_some_and(|s| s.tx.send(message).is_ok())
}

/// Asks the shell extension to find the agent's own window by pid and title, keep it above the
/// others and optionally focus it. False when no shell extension is connected.
pub fn raise_own_window(title: &str, above: bool, activate: bool) -> bool {
    send_shell(shell_raise_msg(std::process::id(), title, above, activate))
}

/// X11 source only: activates the agent's own window with the given title (`_NET_ACTIVE_WINDOW`,
/// source "pager"), which focus-stealing prevention lets through where a plain focus request is
/// refused. False when the shell extension handles windows or no such window is listed.
pub fn activate_own_window(title: &str) -> bool {
    model().source() == Source::X11 && x11::activate_own(title)
}

pub fn shell_extension_connected() -> bool {
    model().shell.is_some()
}

// ---- What get_platform reports -----------------------------------------------------------

pub struct Backend {
    pub session_type: Option<&'static str>,
    pub focus_backend: &'static str,
    pub shell_connected: bool,
}

/// "wayland" or "x11", from XDG_SESSION_TYPE or, failing that, from the display variables.
pub fn session_type_from(
    xdg_session_type: Option<&str>,
    wayland_display: bool,
    x11_display: bool,
) -> Option<&'static str> {
    match xdg_session_type.map(str::to_ascii_lowercase).as_deref() {
        Some("wayland") => Some("wayland"),
        Some("x11") => Some("x11"),
        _ if wayland_display => Some("wayland"),
        _ if x11_display => Some("x11"),
        _ => None,
    }
}

pub fn backend() -> Backend {
    let session_type = session_type_from(
        std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty()),
        std::env::var_os("DISPLAY").is_some_and(|v| !v.is_empty()),
    );
    let m = model();
    let focus_backend = match m.source() {
        Source::Shell => "gnome-shell",
        Source::X11 => "x11",
        Source::None => "none",
    };
    Backend { session_type, focus_backend, shell_connected: m.shell.is_some() }
}

// ---- The platform API ------------------------------------------------------------------

/// Starts the X11 watchers and remembers where foreground changes go. The shell source feeds the
/// same channel whenever a shell extension connects.
pub fn watch_foreground(tx: Sender<isize>) {
    model().announce = Some(tx);
    x11::spawn();
}

/// The window id the active source reports as focused; 0 when none.
pub fn foreground_window() -> isize {
    model().current_id()
}

/// The program behind a window the active source reported.
pub fn describe(raw: isize) -> Option<Foreground> {
    let focus = model().window(raw)?;
    if focus.pid == 0 {
        return None;
    }
    let path = process_path(focus.pid)?;
    Some(Foreground { hwnd: raw, pid: focus.pid, exe: file_name_lower(&path), path })
}

/// Target of /proc/<pid>/exe (the kernel appends " (deleted)" when the file was replaced while running).
pub fn process_path(pid: u32) -> Option<String> {
    let target = std::fs::read_link(format!("/proc/{pid}/exe")).ok()?;
    let path = target.to_string_lossy().into_owned();
    Some(path.strip_suffix(" (deleted)").map(String::from).unwrap_or(path))
}

pub fn file_name_lower(path: &str) -> String {
    Path::new(path).file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// The state letter of /proc/<pid>/stat: "pid (comm) S ...", where comm may itself contain ')'.
fn stat_state(stat: &str) -> Option<char> {
    stat.rsplit_once(')')?.1.trim_start().chars().next()
}

pub fn process_alive(pid: u32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|s| stat_state(&s))
        .is_some_and(|state| state != 'Z' && state != 'X')
}

pub fn window_exists(raw: isize) -> bool {
    model().window(raw).is_some_and(|f| process_alive(f.pid))
}

/// Neither the Shell nor X11 reports a minimised window as the focused one, so there is nothing to check.
pub fn is_minimized(_raw: isize) -> bool {
    false
}

pub fn minimize(raw: isize) {
    let source = model().source();
    match source {
        Source::Shell => {
            send_shell(shell_minimize_msg(raw));
        }
        Source::X11 => x11::minimize(raw as u32),
        Source::None => {}
    }
}

/// Un-minimises and focuses a window (`restore` does not matter: activating always un-minimises).
pub fn bring_to_front(raw: isize, _restore: bool) {
    let source = model().source();
    match source {
        Source::Shell => {
            send_shell(shell_activate_msg(raw));
        }
        Source::X11 => x11::activate(raw as u32),
        Source::None => {}
    }
}

/// The monitor the source reported for a window, if it reported one.
pub fn monitor_of(raw: isize) -> Option<Rect> {
    model().window(raw).and_then(|f| f.monitor)
}

/// Physical-pixel rectangle of the monitor showing the window.
pub fn monitor_rect(raw: isize) -> Rect {
    monitor_of(raw).unwrap_or((0, 0, 1280, 800))
}

/// Where a small notice goes: the monitor of the program in front (the work area is not known).
pub fn work_area() -> Rect {
    let m = model();
    m.current().and_then(|f| f.monitor).unwrap_or((0, 0, 1280, 800))
}

/// True while the program in front runs full screen. An always-on-top window may not show over
/// it, so the guard minimizes the program before showing the warning.
pub fn exclusive_fullscreen() -> bool {
    model().current().is_some_and(|f| f.fullscreen)
}

/// True while something runs full screen (video, game, presentation): input-idle time then still counts as use.
pub fn fullscreen_busy() -> bool {
    exclusive_fullscreen()
}

pub fn idle_seconds() -> u64 {
    model().idle()
}

/// Desktop components that are not programs the user chose (the shell itself in the overview).
pub fn is_system_program(path: &str) -> bool {
    matches!(file_name_lower(path).as_str(), "gnome-shell" | "gnome-shell-portal-helper" | "gnome-session-binary")
}

/// Lower-case program names of every running process whose executable can be read.
pub fn running_exes() -> Vec<String> {
    let Ok(entries) = std::fs::read_dir("/proc") else { return vec![] };
    entries
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.parse::<u32>().ok())
        .filter_map(process_path)
        .map(|p| file_name_lower(&p))
        .filter(|n| !n.is_empty())
        .collect()
}

/// Installed programs from the `.desktop` files: (program file name, display name, full path).
pub fn start_menu_apps() -> Vec<(String, String, String)> {
    apps::scan()
}

/// Opens a URL in the default browser.
pub fn open_url(url: &str) {
    use std::process::{Command, Stdio};
    if let Ok(mut child) =
        Command::new("xdg-open").arg(url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    {
        // Reap it so it does not stay a zombie.
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn focus(id: isize, pid: u32) -> Focus {
        Focus { window_id: id, pid, fullscreen: false, monitor: Some((0, 0, 1920, 1080)) }
    }

    fn channel() -> UnboundedSender<String> {
        tokio::sync::mpsc::unbounded_channel().0
    }

    #[test]
    fn parses_the_focus_message() {
        let msg = json!({"type":"focus","windowId":42,"pid":1234,"wmClass":"Steam","appId":null,"fullscreen":true,
            "monitor":{"x":1920,"y":0,"width":2560,"height":1440}});
        assert_eq!(
            parse_shell_event(&msg),
            Some(ShellEvent::Focus(Some(Focus {
                window_id: 42,
                pid: 1234,
                fullscreen: true,
                monitor: Some((1920, 0, 2560, 1440))
            })))
        );
        let no_monitor =
            json!({"type":"focus","windowId":7,"pid":9,"wmClass":null,"appId":null,"fullscreen":false,"monitor":null});
        assert_eq!(
            parse_shell_event(&no_monitor),
            Some(ShellEvent::Focus(Some(Focus { window_id: 7, pid: 9, fullscreen: false, monitor: None })))
        );
    }

    #[test]
    fn window_id_and_pid_zero_mean_no_focus() {
        let msg =
            json!({"type":"focus","windowId":0,"pid":0,"wmClass":null,"appId":null,"fullscreen":false,"monitor":null});
        assert_eq!(parse_shell_event(&msg), Some(ShellEvent::Focus(None)));
    }

    #[test]
    fn parses_hello_and_idle_and_rejects_the_rest() {
        assert_eq!(
            parse_shell_event(&json!({"type":"shell_hello","protocol":1,"shellVersion":"50.1"})),
            Some(ShellEvent::Hello { protocol: 1, shell_version: "50.1".into() })
        );
        assert_eq!(parse_shell_event(&json!({"type":"idle","seconds":30})), Some(ShellEvent::Idle(30)));
        assert_eq!(parse_shell_event(&json!({"type":"idle"})), None);
        assert_eq!(parse_shell_event(&json!({"type":"focus","pid":3})), None);
        assert_eq!(parse_shell_event(&json!({"type":"hello","protocol":1})), None);
        assert_eq!(parse_shell_event(&json!({"nothing":1})), None);
    }

    #[test]
    fn commands_for_the_shell_have_the_agreed_shape() {
        let v = |s: String| serde_json::from_str::<Value>(&s).unwrap();
        assert_eq!(v(shell_minimize_msg(42)), json!({"type":"shell_minimize","windowId":42}));
        assert_eq!(v(shell_activate_msg(42)), json!({"type":"shell_activate","windowId":42}));
        assert_eq!(
            v(shell_raise_msg(77, "DopaDam – cảnh báo", true, false)),
            json!({"type":"shell_raise","pid":77,"title":"DopaDam – cảnh báo","above":true,"activate":false})
        );
    }

    #[test]
    fn shell_takes_over_from_x11_and_gives_back() {
        let mut m = Model::new();
        assert_eq!(m.source(), Source::None);
        assert_eq!(m.set_x11_available(true), None);
        assert_eq!(m.apply_x11_focus(Some(focus(10, 100))), Some(10));
        assert_eq!(m.current_id(), 10);
        m.x11_idle = 5;

        // The shell connects: X11 is ignored from now on, even though it keeps reporting.
        m.shell_connected(1, channel());
        assert_eq!(m.source(), Source::Shell);
        assert_eq!(m.current_id(), 0);
        assert_eq!(m.apply_x11_focus(Some(focus(11, 101))), None);
        assert_eq!(m.apply_shell(1, ShellEvent::Focus(Some(focus(500, 900)))), Some(500));
        assert_eq!(m.window(500).map(|f| f.pid), Some(900));
        assert_eq!(m.window(11), None);
        assert_eq!(m.apply_shell(1, ShellEvent::Idle(40)), None);
        assert_eq!(m.idle(), 40);

        // The shell goes away: the latest X11 focus is the foreground again.
        assert_eq!(m.shell_gone(1), Some(11));
        assert_eq!(m.source(), Source::X11);
        assert_eq!(m.idle(), 5);
    }

    #[test]
    fn only_the_registered_shell_client_is_listened_to() {
        let mut m = Model::new();
        m.shell_connected(3, channel());
        assert_eq!(m.apply_shell(4, ShellEvent::Focus(Some(focus(1, 2)))), None);
        assert_eq!(m.current_id(), 0);
        assert_eq!(m.shell_gone(4), None);
        assert_eq!(m.source(), Source::Shell);
        assert_eq!(m.apply_shell(3, ShellEvent::Focus(Some(focus(1, 2)))), Some(1));
        // Losing focus announces nothing, and the same window twice is announced once.
        assert_eq!(m.apply_shell(3, ShellEvent::Focus(Some(focus(1, 2)))), None);
        assert_eq!(m.apply_shell(3, ShellEvent::Focus(None)), None);
        assert_eq!(m.current_id(), 0);
    }

    #[test]
    fn without_any_source_nothing_is_known() {
        let mut m = Model::new();
        assert_eq!(m.apply_x11_focus(Some(focus(1, 2))), None);
        assert_eq!(m.current_id(), 0);
        assert_eq!(m.window(1), None);
        assert_eq!(m.idle(), 0);
        assert_eq!(m.set_x11_available(true), Some(1));
        assert_eq!(m.set_x11_available(false), None);
        assert_eq!(m.source(), Source::None);
    }

    #[test]
    fn window_memory_stays_bounded() {
        let mut windows = BTreeMap::new();
        for id in 1..=(WINDOW_MEMORY as isize + 5) {
            remember(&mut windows, &focus(id, 1));
        }
        assert!(windows.len() <= WINDOW_MEMORY);
        assert!(windows.contains_key(&(WINDOW_MEMORY as isize + 5)));
    }

    #[test]
    fn session_type_comes_from_the_environment() {
        assert_eq!(session_type_from(Some("wayland"), false, true), Some("wayland"));
        assert_eq!(session_type_from(Some("X11"), true, true), Some("x11"));
        assert_eq!(session_type_from(Some("tty"), true, true), Some("wayland"));
        assert_eq!(session_type_from(None, false, true), Some("x11"));
        assert_eq!(session_type_from(None, false, false), None);
    }

    #[test]
    fn process_state_is_read_past_the_command_name() {
        assert_eq!(stat_state("123 (bash) S 1 2 3"), Some('S'));
        assert_eq!(stat_state("123 (we) ird) Z 1"), Some('Z'));
        assert_eq!(stat_state("garbage"), None);
    }

    #[test]
    fn this_test_process_is_alive_and_has_a_name() {
        let pid = std::process::id();
        assert!(process_alive(pid));
        let path = process_path(pid).expect("own exe");
        assert!(!file_name_lower(&path).is_empty());
        assert!(running_exes().contains(&file_name_lower(&path)));
        assert!(!process_alive(u32::MAX - 1));
    }

    #[test]
    fn the_shell_is_not_a_program_to_track() {
        assert!(is_system_program("/usr/bin/gnome-shell"));
        assert!(!is_system_program("/usr/bin/steam"));
    }
}

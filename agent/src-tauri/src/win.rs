//! Thin wrappers over the Win32 calls the agent needs. Window *content* is never read:
//! only which program owns the window in front.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;

use windows::core::{Interface, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetLastInputInfo, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, LASTINPUTINFO, VK_MENU,
};
use windows::Win32::UI::Shell::{
    IShellLinkW, SHQueryUserNotificationState, ShellLink, QUNS_BUSY, QUNS_PRESENTATION_MODE,
    QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EnumChildWindows, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, IsWindow,
    SetForegroundWindow, ShowWindow, SystemParametersInfoW, TranslateMessage, EVENT_SYSTEM_FOREGROUND,
    EVENT_SYSTEM_MINIMIZEEND, MSG, SPI_GETWORKAREA, SW_MINIMIZE, SW_RESTORE, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

/// A window that came to the front, identified by its owning process.
#[derive(Clone, Debug, PartialEq)]
pub struct Foreground {
    pub hwnd: isize,
    pub pid: u32,
    /// Lower-case file name, e.g. "steam.exe".
    pub exe: String,
    pub path: String,
}

pub fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut c_void)
}

static FOREGROUND_TX: OnceLock<Sender<isize>> = OnceLock::new();

unsafe extern "system" fn on_win_event(
    _hook: HWINEVENTHOOK,
    _event: u32,
    window: HWND,
    id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    // OBJID_WINDOW = 0: the event is about the window itself.
    if id_object == 0 && !window.0.is_null() {
        if let Some(tx) = FOREGROUND_TX.get() {
            let _ = tx.send(window.0 as isize);
        }
    }
}

/// Starts a thread that reports every window that becomes the foreground window.
pub fn watch_foreground(tx: Sender<isize>) {
    let _ = FOREGROUND_TX.set(tx);
    std::thread::Builder::new()
        .name("foreground-hook".into())
        .spawn(|| unsafe {
            let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
            let _h1 = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_win_event),
                0,
                0,
                flags,
            );
            // Restoring a minimized window does not always raise EVENT_SYSTEM_FOREGROUND.
            let _h2 = SetWinEventHook(
                EVENT_SYSTEM_MINIMIZEEND,
                EVENT_SYSTEM_MINIMIZEEND,
                None,
                Some(on_win_event),
                0,
                0,
                flags,
            );
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .expect("spawn foreground hook thread");
}

pub fn foreground_window() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

fn window_pid(window: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(window, Some(&mut pid));
    }
    pid
}

pub fn process_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(handle);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

pub fn file_name_lower(path: &str) -> String {
    Path::new(path).file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default()
}

unsafe extern "system" fn find_other_pid(child: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut (u32, u32));
    let pid = window_pid(child);
    if pid != state.0 {
        state.1 = pid;
        return BOOL(0);
    }
    BOOL(1)
}

/// Resolves which program owns a window. Store (UWP) apps live inside ApplicationFrameHost.exe,
/// so for those the real app is the child window from another process.
pub fn describe(raw: isize) -> Option<Foreground> {
    let window = hwnd(raw);
    let mut pid = window_pid(window);
    if pid == 0 {
        return None;
    }
    let mut path = process_path(pid)?;
    if file_name_lower(&path) == "applicationframehost.exe" {
        let mut state = (pid, 0u32);
        unsafe {
            let _ = EnumChildWindows(window, Some(find_other_pid), LPARAM(&mut state as *mut _ as isize));
        }
        if state.1 != 0 {
            pid = state.1;
            path = process_path(pid)?;
        }
    }
    Some(Foreground { hwnd: raw, pid, exe: file_name_lower(&path), path })
}

pub fn process_alive(pid: u32) -> bool {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return false;
        };
        let mut code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut code).is_ok();
        let _ = CloseHandle(handle);
        // STILL_ACTIVE = 259
        ok && code == 259
    }
}

pub fn window_exists(raw: isize) -> bool {
    unsafe { IsWindow(hwnd(raw)).as_bool() }
}

pub fn minimize(raw: isize) {
    unsafe {
        let _ = ShowWindow(hwnd(raw), SW_MINIMIZE);
    }
}

/// Brings a window to the front. Windows only lets the foreground process do this, so we
/// briefly tap Alt first, the usual way to be allowed to change the foreground window.
pub fn bring_to_front(raw: isize, restore: bool) {
    unsafe {
        let window = hwnd(raw);
        if restore {
            let _ = ShowWindow(window, SW_RESTORE);
        }
        if GetForegroundWindow() == window {
            return;
        }
        let key = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        };
        let inputs = [key(Default::default()), key(KEYEVENTF_KEYUP)];
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        let _ = SetForegroundWindow(window);
    }
}

/// Shows a window above everything without taking the keyboard focus (used for small notices).
pub fn show_topmost_no_activate(raw: isize) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE,
    };
    unsafe {
        let window = hwnd(raw);
        let _ = ShowWindow(window, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(window, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

/// Physical-pixel rectangle (x, y, width, height) of the monitor showing the window.
pub fn monitor_rect(raw: isize) -> (i32, i32, i32, i32) {
    unsafe {
        let monitor = MonitorFromWindow(hwnd(raw), MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            let r = info.rcMonitor;
            (r.left, r.top, r.right - r.left, r.bottom - r.top)
        } else {
            (0, 0, 1280, 800)
        }
    }
}

/// Physical-pixel work area of the primary monitor (screen minus taskbar).
pub fn work_area() -> (i32, i32, i32, i32) {
    let mut r = RECT::default();
    unsafe {
        let _ = SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut r as *mut RECT as *mut c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
    }
    (r.left, r.top, r.right - r.left, r.bottom - r.top)
}

/// True when a game runs in exclusive full screen: an always-on-top window would not show over it.
pub fn exclusive_fullscreen() -> bool {
    unsafe { SHQueryUserNotificationState().is_ok_and(|s| s == QUNS_RUNNING_D3D_FULL_SCREEN) }
}

/// True while something runs full screen (video, game, presentation): input-idle time then still counts as use.
pub fn fullscreen_busy() -> bool {
    unsafe {
        SHQueryUserNotificationState()
            .is_ok_and(|s| s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE)
    }
}

pub fn idle_seconds() -> u64 {
    unsafe {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if !GetLastInputInfo(&mut info).as_bool() {
            return 0;
        }
        (GetTickCount().wrapping_sub(info.dwTime) / 1000) as u64
    }
}

/// Lower-case executable names of every running process.
pub fn running_exes() -> Vec<String> {
    let mut out = vec![];
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                out.push(String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase());
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

/// Programs listed in the Start menu: (exe file name, display name, full path).
pub fn start_menu_apps() -> Vec<(String, String, String)> {
    let roots: Vec<PathBuf> = ["ProgramData", "APPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|base| PathBuf::from(base).join("Microsoft").join("Windows").join("Start Menu").join("Programs"))
        .collect();
    let mut links = vec![];
    for root in roots {
        collect_links(&root, &mut links, 0);
    }
    let mut out = vec![];
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        for link in links {
            if let Some(target) = resolve_link(&link) {
                if target.to_lowercase().ends_with(".exe") {
                    let name = link.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                    out.push((file_name_lower(&target), name, target));
                }
            }
        }
    }
    // One entry per program (several shortcuts can point at the same exe), listed by name.
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.dedup_by(|a, b| a.0 == b.0);
    out.sort_by_key(|a| a.1.to_lowercase());
    out
}

fn collect_links(dir: &Path, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_links(&path, out, depth + 1);
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
            out.push(path);
        }
    }
}

unsafe fn resolve_link(path: &Path) -> Option<String> {
    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
    let persist: IPersistFile = link.cast().ok()?;
    let wide: Vec<u16> = path.as_os_str().encode_wide_null();
    persist.Load(PCWSTR(wide.as_ptr()), STGM_READ).ok()?;
    let mut buf = [0u16; 1024];
    link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
    let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
    (len > 0).then(|| String::from_utf16_lossy(&buf[..len]))
}

trait EncodeWideNull {
    fn encode_wide_null(&self) -> Vec<u16>;
}

impl EncodeWideNull for std::ffi::OsStr {
    fn encode_wide_null(&self) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        self.encode_wide().chain(std::iter::once(0)).collect()
    }
}

/// Opens a URL in the default browser.
pub fn open_url(url: &str) {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
    let verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        ShellExecuteW(None, PCWSTR(verb.as_ptr()), PCWSTR(wide.as_ptr()), None, None, SW_SHOWNORMAL);
    }
}

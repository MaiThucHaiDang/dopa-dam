//! X11 source of the foreground program (pure-Rust x11rb, no system headers): the root window's
//! `_NET_ACTIVE_WINDOW`, the window's `_NET_WM_PID`, `_NET_WM_STATE_FULLSCREEN`, the monitor from
//! RandR, and idle time from the screensaver extension. Window titles are never read.
//!
//! Under a Wayland session this only sees XWayland windows; `linux.rs` ignores it while the GNOME
//! Shell companion is connected.

use super::{Focus, Rect};
use std::time::Duration;
use x11rb::connection::Connection;
use x11rb::protocol::randr::ConnectionExt as _;
use x11rb::protocol::screensaver::ConnectionExt as _;
use x11rb::protocol::xproto::{
    AtomEnum, ChangeWindowAttributesAux, ClientMessageEvent, ConnectionExt as _, EventMask, Window,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

type R<T> = Result<T, Box<dyn std::error::Error>>;

const RETRY: Duration = Duration::from_secs(30);
const IDLE_POLL: Duration = Duration::from_secs(5);
/// WM_CHANGE_STATE data for "iconify".
const ICONIC_STATE: u32 = 3;
/// _NET_ACTIVE_WINDOW source indication "pager": window managers let it past focus-stealing prevention.
const SOURCE_PAGER: u32 = 2;

struct Atoms {
    active: u32,
    pid: u32,
    state: u32,
    fullscreen: u32,
    change_state: u32,
}

fn intern(conn: &RustConnection, name: &str) -> R<u32> {
    Ok(conn.intern_atom(false, name.as_bytes())?.reply()?.atom)
}

impl Atoms {
    fn new(conn: &RustConnection) -> R<Atoms> {
        Ok(Atoms {
            active: intern(conn, "_NET_ACTIVE_WINDOW")?,
            pid: intern(conn, "_NET_WM_PID")?,
            state: intern(conn, "_NET_WM_STATE")?,
            fullscreen: intern(conn, "_NET_WM_STATE_FULLSCREEN")?,
            change_state: intern(conn, "WM_CHANGE_STATE")?,
        })
    }
}

/// Starts the two watcher threads (focus, idle). Each retries every 30 s while no X server answers.
pub fn spawn() {
    let _ = std::thread::Builder::new().name("x11-focus".into()).spawn(|| {
        let mut logged = false;
        loop {
            if let Err(e) = watch_focus() {
                if !logged {
                    logged = true;
                    eprintln!("DopaDam: X11 focus source unavailable: {e}");
                }
            }
            super::set_x11_available(false);
            std::thread::sleep(RETRY);
        }
    });
    let _ = std::thread::Builder::new().name("x11-idle".into()).spawn(|| loop {
        let _ = watch_idle();
        std::thread::sleep(RETRY);
    });
}

fn watch_focus() -> R<()> {
    let (conn, screen_num) = RustConnection::connect(None)?;
    let screen = &conn.setup().roots[screen_num];
    let root = screen.root;
    let screen_rect: Rect = (0, 0, screen.width_in_pixels as i32, screen.height_in_pixels as i32);
    let atoms = Atoms::new(&conn)?;
    conn.change_window_attributes(root, &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE))?;
    conn.flush()?;
    super::set_x11_available(true);
    let mut watched: Window = 0;
    refresh(&conn, root, screen_rect, &atoms, &mut watched)?;
    loop {
        if let Event::PropertyNotify(e) = conn.wait_for_event()? {
            let active_changed = e.window == root && e.atom == atoms.active;
            let state_changed = watched != 0 && e.window == watched && e.atom == atoms.state;
            if active_changed || state_changed {
                refresh(&conn, root, screen_rect, &atoms, &mut watched)?;
            }
        }
    }
}

fn cardinal(conn: &RustConnection, window: Window, atom: u32, kind: AtomEnum) -> Option<u32> {
    let reply = conn.get_property(false, window, atom, kind, 0, 1).ok()?.reply().ok()?;
    let value = reply.value32()?.next();
    value
}

fn refresh(conn: &RustConnection, root: Window, screen_rect: Rect, atoms: &Atoms, watched: &mut Window) -> R<()> {
    let active = cardinal(conn, root, atoms.active, AtomEnum::WINDOW).unwrap_or(0);
    if active != *watched {
        // The old window may be gone already: errors for these two requests are ignored.
        if *watched != 0 {
            let _ = conn
                .change_window_attributes(*watched, &ChangeWindowAttributesAux::new().event_mask(EventMask::NO_EVENT));
        }
        if active != 0 {
            let _ = conn.change_window_attributes(
                active,
                &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE),
            );
        }
        *watched = active;
    }
    let focus = if active == 0 {
        None
    } else {
        let pid = cardinal(conn, active, atoms.pid, AtomEnum::CARDINAL).unwrap_or(0);
        Some(Focus {
            window_id: active as isize,
            pid,
            fullscreen: is_fullscreen(conn, active, atoms),
            monitor: Some(monitor_of(conn, root, active).unwrap_or(screen_rect)),
        })
    };
    conn.flush()?;
    super::apply_x11_focus(focus);
    Ok(())
}

fn is_fullscreen(conn: &RustConnection, window: Window, atoms: &Atoms) -> bool {
    conn.get_property(false, window, atoms.state, AtomEnum::ATOM, 0, 64)
        .ok()
        .and_then(|c| c.reply().ok())
        .and_then(|r| r.value32().map(|mut it| it.any(|a| a == atoms.fullscreen)))
        .unwrap_or(false)
}

/// The RandR monitor that holds the centre of the window (the primary one if none does).
fn monitor_of(conn: &RustConnection, root: Window, window: Window) -> Option<Rect> {
    let geometry = conn.get_geometry(window).ok()?.reply().ok()?;
    let origin = conn.translate_coordinates(window, root, 0, 0).ok()?.reply().ok()?;
    let cx = origin.dst_x as i32 + geometry.width as i32 / 2;
    let cy = origin.dst_y as i32 + geometry.height as i32 / 2;
    let monitors = conn.randr_get_monitors(root, true).ok()?.reply().ok()?.monitors;
    let rect = |m: &x11rb::protocol::randr::MonitorInfo| (m.x as i32, m.y as i32, m.width as i32, m.height as i32);
    monitors
        .iter()
        .find(|m| {
            let (x, y, w, h) = rect(m);
            cx >= x && cx < x + w && cy >= y && cy < y + h
        })
        .or_else(|| monitors.iter().find(|m| m.primary))
        .or(monitors.first())
        .map(rect)
}

fn watch_idle() -> R<()> {
    let (conn, screen_num) = RustConnection::connect(None)?;
    let root = conn.setup().roots[screen_num].root;
    conn.screensaver_query_version(1, 1)?.reply()?;
    loop {
        let info = conn.screensaver_query_info(root)?.reply()?;
        super::set_x11_idle(u64::from(info.ms_since_user_input / 1000));
        std::thread::sleep(IDLE_POLL);
    }
}

/// Sends a client message to the root window, the way window managers expect requests from clients.
fn root_message(window: u32, message_type: impl FnOnce(&RustConnection) -> R<u32>, data: [u32; 5]) -> R<()> {
    let (conn, screen_num) = RustConnection::connect(None)?;
    let root = conn.setup().roots[screen_num].root;
    let kind = message_type(&conn)?;
    let event = ClientMessageEvent::new(32, window, kind, data);
    conn.send_event(false, root, EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY, event)?;
    // A round trip makes sure the server got the message before the connection closes.
    conn.get_input_focus()?.reply()?;
    Ok(())
}

pub fn minimize(window: u32) {
    let _ = root_message(window, |c| Ok(Atoms::new(c)?.change_state), [ICONIC_STATE, 0, 0, 0, 0]);
}

/// Un-minimises and focuses a window.
pub fn activate(window: u32) {
    let _ = root_message(window, |c| Ok(Atoms::new(c)?.active), [SOURCE_PAGER, 0, 0, 0, 0]);
}

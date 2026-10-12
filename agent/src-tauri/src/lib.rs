//! DopaDam agent for Windows: tray app that guards desktop programs and bridges the Edge extension.

pub mod commands;
pub mod core;
pub mod db;
pub mod guard;
pub mod host;
pub mod logic;
pub mod nmhost;
pub mod pipe;
pub mod state;
pub mod win;

use state::{AppState, Shared};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// %APPDATA%\DopaDam, or DOPADAM_DATA_DIR (used by the integration tests to stay out of the real data).
pub fn data_dir() -> std::path::PathBuf {
    if let Some(dir) = std::env::var_os("DOPADAM_DATA_DIR") {
        return std::path::PathBuf::from(dir);
    }
    std::env::var_os("APPDATA").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir).join("DopaDam")
}

/// Test runs must not leave DopaDam starting with Windows.
fn autostart_allowed() -> bool {
    std::env::var_os("DOPADAM_NO_AUTOSTART").is_none()
}

fn build_windows(app: &tauri::AppHandle, start_hidden: bool) -> tauri::Result<()> {
    let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("DopaDam")
        .inner_size(1040.0, 740.0)
        .min_inner_size(760.0, 560.0)
        .visible(!start_hidden)
        .build()?;
    // Closing the main window only hides it: the agent keeps guarding from the tray.
    let main_handle = main.clone();
    main.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = main_handle.hide();
        }
    });

    let warning = WebviewWindowBuilder::new(app, "warning", WebviewUrl::App("index.html#/warning".into()))
        .title("DopaDam")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()?;
    // Alt+F4 on the warning counts as Thoát.
    let app_handle = app.clone();
    warning.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let state = app_handle.state::<Shared>();
            if let Some(ctx) = guard::current_warning(&state) {
                let _ = guard::decide(&state, &ctx.event_id, logic::Decision::Exit, None, None, None);
            }
        }
    });

    WebviewWindowBuilder::new(app, "toast", WebviewUrl::App("index.html#/toast".into()))
        .title("DopaDam")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .inner_size(380.0, 130.0)
        .visible(false)
        .build()?;
    Ok(())
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Mở DopaDam", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Thoát DopaDam…", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main").tooltip("DopaDam").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| {
        let state = app.state::<Shared>();
        match event.id.as_ref() {
            "open" => commands::show_main(&state, None),
            // Quitting needs the 60-second confirmation, which lives in the main window.
            "quit" => commands::show_main(&state, Some("/quit")),
            _ => {}
        }
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            let state = tray.app_handle().state::<Shared>();
            commands::show_main(&state, None);
        }
    })
    .build(app)?;
    Ok(())
}

pub fn run() {
    let start_hidden = std::env::args().any(|a| a == "--hidden");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let state = app.state::<Shared>();
            commands::show_main(&state, None);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(move |app| {
            let handle = app.handle().clone();
            let dir = data_dir();
            let store =
                db::Store::open(&dir.join("dopadam.db")).map_err(|e| format!("Không mở được cơ sở dữ liệu: {e}"))?;
            let now = core::now_ms();
            store.ensure_defaults(now);
            let first_run = store.kv_get("firstRunDone").is_none();
            store.kv_set("firstRunDone", "1");
            if store.kv_get("installedAt").is_none() {
                store.kv_set("installedAt", &now.to_string());
            }
            let state = AppState::new(handle.clone(), dir.clone(), store);
            app.manage(state.clone());

            build_windows(&handle, start_hidden)?;
            build_tray(&handle)?;

            if first_run && autostart_allowed() {
                use tauri_plugin_autostart::ManagerExt;
                let _ = handle.autolaunch().enable();
            }
            if let Err(e) = nmhost::register(&dir) {
                eprintln!("DopaDam: native messaging host not registered: {e}");
            }

            // Start-menu programs for the app list (slow COM calls: off the main thread).
            let scan_state = state.clone();
            std::thread::spawn(move || {
                let now = core::now_ms();
                let found = win::start_menu_apps();
                let store = scan_state.store();
                for (exe, name, path) in found {
                    store.note_app(&exe, &name, Some(&path), "start-menu", now);
                }
            });

            // Foreground changes come from a Win32 hook thread.
            let (tx, rx) = std::sync::mpsc::channel::<isize>();
            win::watch_foreground(tx);
            let fg_state = state.clone();
            std::thread::spawn(move || {
                while let Ok(hwnd) = rx.recv() {
                    guard::on_foreground(&fg_state, hwnd);
                }
            });
            // Pick up whatever is in front already.
            guard::on_foreground(&state, win::foreground_window());

            let tick_state = state.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(1));
                loop {
                    interval.tick().await;
                    let s = tick_state.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || guard::tick(&s)).await;
                }
            });
            tauri::async_runtime::spawn(pipe::serve(state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_overview,
            commands::list_apps,
            commands::rescan_apps,
            commands::set_app_tag,
            commands::set_app_delay,
            commands::list_sites,
            commands::set_site_tag,
            commands::add_allow_url,
            commands::remove_allow_url,
            commands::get_settings,
            commands::save_settings,
            commands::set_protection,
            commands::clear_log,
            commands::set_autostart,
            commands::register_host,
            commands::warning_current,
            commands::warning_decide,
            commands::toast_current,
            commands::toast_dismiss,
            commands::quit_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DopaDam");
}

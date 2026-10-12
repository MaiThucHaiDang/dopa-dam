// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Edge starts the same executable as the extension's native messaging host.
    if dopadam_lib::host::is_host_invocation() {
        dopadam_lib::host::run_relay();
        return;
    }
    dopadam_lib::run()
}

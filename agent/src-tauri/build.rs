// Supabase settings come from the environment (DOPADAM_SUPABASE_URL, DOPADAM_SUPABASE_ANON_KEY) or from
// config.local.json next to this file (not committed). Without them the agent runs fully offline.
fn main() {
    println!("cargo:rerun-if-changed=config.local.json");
    println!("cargo:rerun-if-env-changed=DOPADAM_SUPABASE_URL");
    println!("cargo:rerun-if-env-changed=DOPADAM_SUPABASE_ANON_KEY");
    let local: Option<serde_json::Value> =
        std::fs::read_to_string("config.local.json").ok().and_then(|s| serde_json::from_str(&s).ok());
    let pick = |env: &str, key: &str| {
        std::env::var(env)
            .ok()
            .or_else(|| local.as_ref().and_then(|v| v.get(key)).and_then(|v| v.as_str()).map(String::from))
            .unwrap_or_default()
    };
    println!("cargo:rustc-env=DOPADAM_SUPABASE_URL={}", pick("DOPADAM_SUPABASE_URL", "supabaseUrl"));
    println!("cargo:rustc-env=DOPADAM_SUPABASE_ANON_KEY={}", pick("DOPADAM_SUPABASE_ANON_KEY", "supabaseAnonKey"));
    tauri_build::build()
}

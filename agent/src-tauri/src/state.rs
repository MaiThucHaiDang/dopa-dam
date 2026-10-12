//! Shared state of the running agent and the snapshot it sends to the extension.

use crate::core::{budget_status, now_ms, BudgetStatus, StudyStatus};
use crate::db::{AllowEntry, AllowWindow, Store, KIND_DOMAIN};
use crate::guard::Guard;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::UnboundedSender;

use crate::sync::{Api, Session};

pub const PROTOCOL: i64 = 1;
pub const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct Client {
    pub tx: UnboundedSender<String>,
    pub profile_id: Option<String>,
    pub ext_version: Option<String>,
    pub compatible: bool,
    pub last_seen: i64,
}

pub struct AppState {
    pub app: AppHandle,
    pub data_dir: PathBuf,
    store: Mutex<Store>,
    pub guard: Mutex<Guard>,
    pub clients: Mutex<HashMap<u64, Client>>,
    next_client: AtomicU64,
    /// Present when Supabase is configured (config.local.json at build time).
    pub api: Option<Arc<Api>>,
    pub session: Mutex<Option<Session>>,
    /// PKCE verifier of a Google sign-in waiting for the browser to come back.
    pub pkce: Mutex<Option<String>>,
    pub sync_info: Mutex<SyncInfo>,
    /// Set by local changes so the sync loop pushes them within seconds.
    pub sync_soon: AtomicBool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncInfo {
    pub syncing: bool,
    pub last_error: Option<String>,
}

pub type Shared = Arc<AppState>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetView {
    pub used_minutes: f64,
    pub budget_minutes: i64,
    pub remaining_minutes: Option<f64>,
    pub over: bool,
}

pub fn budget_view(store: &Store, now: i64) -> BudgetView {
    let used = store.used_minutes(now);
    let budget = store.settings().budget_minutes;
    let BudgetStatus { over, remaining_minutes } = budget_status(used, budget);
    BudgetView { used_minutes: used, budget_minutes: budget, remaining_minutes, over }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DomainRuleOut {
    pattern: String,
    tag: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    warnings_today: i64,
    exits_today: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigMessage {
    r#type: &'static str,
    domain_rules: Vec<DomainRuleOut>,
    allow_urls: Vec<AllowEntry>,
    settings: crate::core::Settings,
    allow_windows: Vec<AllowWindow>,
    study: StudyStatus,
    budget: BudgetView,
    protection_enabled: bool,
    summary: Summary,
}

impl AppState {
    pub fn new(app: AppHandle, data_dir: PathBuf, store: Store) -> Shared {
        Arc::new(AppState {
            app,
            data_dir,
            store: Mutex::new(store),
            guard: Mutex::new(Guard::default()),
            clients: Mutex::new(HashMap::new()),
            next_client: AtomicU64::new(1),
            api: crate::sync::config().map(|c| Arc::new(Api::new(c))),
            session: Mutex::new(None),
            pkce: Mutex::new(None),
            sync_info: Mutex::new(SyncInfo::default()),
            sync_soon: AtomicBool::new(true),
        })
    }

    pub fn store(&self) -> MutexGuard<'_, Store> {
        self.store.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The store's mutex itself, for the sync engine (which locks it between network calls).
    pub fn store_mutex(&self) -> &Mutex<Store> {
        &self.store
    }

    pub fn session(&self) -> Option<Session> {
        self.session.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_session(&self, session: Option<Session>) {
        *self.session.lock().unwrap_or_else(|e| e.into_inner()) = session;
    }

    pub fn sync_info(&self) -> MutexGuard<'_, SyncInfo> {
        self.sync_info.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn guard(&self) -> MutexGuard<'_, Guard> {
        self.guard.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn add_client(&self, tx: UnboundedSender<String>) -> u64 {
        let id = self.next_client.fetch_add(1, Ordering::Relaxed);
        let client = Client { tx, profile_id: None, ext_version: None, compatible: false, last_seen: now_ms() };
        self.clients.lock().unwrap_or_else(|e| e.into_inner()).insert(id, client);
        id
    }

    pub fn remove_client(&self, id: u64) {
        self.clients.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        let _ = self.app.emit("state-changed", ());
    }

    pub fn connected_extensions(&self) -> usize {
        self.clients.lock().unwrap_or_else(|e| e.into_inner()).values().filter(|c| c.compatible).count()
    }

    /// Everything the extension needs to block on its own, as one JSON line.
    pub fn config_message(&self) -> String {
        let now = now_ms();
        let store = self.store();
        let (warnings_today, exits_today) = store.today_counts(now);
        let msg = ConfigMessage {
            r#type: "config",
            domain_rules: store
                .rules(KIND_DOMAIN)
                .into_iter()
                .map(|r| DomainRuleOut { pattern: r.pattern, tag: r.tag })
                .collect(),
            allow_urls: store.allow_entries(),
            settings: store.settings(),
            allow_windows: store.allow_windows().into_iter().filter(|w| w.expires_at > now).collect(),
            study: store.study_status(now),
            budget: budget_view(&store, now),
            protection_enabled: store.protection_enabled(),
            summary: Summary { warnings_today, exits_today },
        };
        serde_json::to_string(&msg).expect("config serialize")
    }

    pub fn send_to(&self, client: u64, json: String) {
        if let Some(c) = self.clients.lock().unwrap_or_else(|e| e.into_inner()).get(&client) {
            let _ = c.tx.send(json);
        }
    }

    /// A local change: refresh everyone and push it to the server soon.
    pub fn changed(&self) {
        self.sync_soon.store(true, Ordering::Relaxed);
        self.refreshed();
    }

    /// Pushes the new configuration to every extension and tells the agent's own windows to refresh.
    pub fn refreshed(&self) {
        let json = self.config_message();
        for c in self.clients.lock().unwrap_or_else(|e| e.into_inner()).values() {
            if c.compatible {
                let _ = c.tx.send(json.clone());
            }
        }
        let _ = self.app.emit("state-changed", ());
    }
}

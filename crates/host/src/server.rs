use crate::Store;
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use deck2_shared::{API, Problem, Receipt, ScopedSubmit, SessionCommand, Workspace};
use serde_json::json;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::watch;
#[derive(Clone)]
pub struct App { pub(crate) inner: Arc<Inner>, pub project: String }
pub struct ProjectState<T>(pub T);
// Explicit project targeting for the existing management APIs.
// Stored revisions bind plans to roots, so legacy durable JSON needs no migration.
impl axum::extract::FromRequestParts<App> for ProjectState<App> {
    type Rejection = Response;
    async fn from_request_parts(parts: &mut axum::http::request::Parts, app: &App) -> Result<Self, Response> {
        let q = axum::extract::Query::<HashMap<String, String>>::try_from_uri(&parts.uri)
            .map_err(|_| problem(StatusCode::BAD_REQUEST, "project_invalid", "Invalid project context"))?;
        let Some(id) = q.get("projectId") else { return Ok(Self(app.clone())); };
        let s = app.store.lock().unwrap();
        let p = s.project_by_id(id)
            .map_err(|e| problem(StatusCode::NOT_FOUND, "project_unknown", e))?;
        let management = ["/api/configuration", "/api/cbm", "/api/helpers", "/api/operations/"]
            .iter().any(|prefix| parts.uri.path().starts_with(prefix));
        if !management {
            return Ok(Self(App { inner: app.inner.clone(), project: p.root }));
        }
        crate::projects::validate(&p)
            .map_err(|e| problem(StatusCode::CONFLICT, "project_unavailable", e))?;
        if !s.trusted_project(&p.root)
            .map_err(|e| problem(StatusCode::CONFLICT, "project_unavailable", e))? {
            return Err(problem(StatusCode::FORBIDDEN, "project_untrusted", "Trust this project before managing its configuration or code map"));
        }
        // Check ownership before admitting a response, retry, receipt read or cancellation.
        // Immutable plan ownership remains authoritative even after newer selections.
        let path: Vec<_> = parts.uri.path().trim_matches('/').split('/').collect();
        let owner = match path.as_slice() {
            ["api", "configuration", "plans", plan, "apply"] => Some(s.helper_plan(plan).map(|p| p.before.project)),
            ["api", "operations", op] | ["api", "helpers", "operations", op, "cancel"] =>
                Some(s.operation(op).and_then(|o| s.helper_plan(&o.plan)).map(|p| p.before.project)),
            ["api", "cbm", "plans", plan, "apply"] => Some(s.cbm_plan_project(plan)),
            ["api", "cbm", "operations", op] => Some(s.cbm_operation_project(op)),
            _ => None,
        };
        if let Some(owner) = owner {
            let owner = owner.map_err(|e| {
                if parts.uri.path().starts_with("/api/cbm/") && e.starts_with("Unknown CBM ") {
                    crate::cbm_management::evidence_expired()
                } else {problem(StatusCode::NOT_FOUND, "project_resource_unavailable", e)}
            })?;
            if owner != p.root {
                return Err(problem(StatusCode::CONFLICT, "project_mismatch", "This plan or operation belongs to another project. Return to its Project settings to continue."));
            }
        }
        Ok(Self(App { inner: app.inner.clone(), project: p.root }))
    }
}
pub struct Inner {
    initial_project: String,
    pub(crate) web_push: Mutex<crate::web_push::Runtime>,
    pub(crate) web_identity: Mutex<crate::web_identity::Runtime>,
    pub(crate) history: Mutex<crate::history::Reader>,
    #[cfg(test)]
    pub(crate) assignment_probe: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    #[cfg(test)]
    pub(crate) device_history_probe: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    pub(crate) dictation: tokio::sync::OnceCell<Arc<crate::dictation::Service>>,
    pub(crate) quota_runtime: Mutex<crate::quota::Runtime>,
    pub(crate) claude_quota_runtime: Mutex<crate::quota::Runtime>,
    pub(crate) git_review: crate::git_review::Runtime,
    pub store: Mutex<Store>,
    pub(crate) workspace_updates: crate::workspace_events::Updates,
    pub artifact_store: Mutex<Option<PathBuf>>,
    pub host: String,
    pub binary: PathBuf,
    pub native_role_root: Mutex<PathBuf>,
    cookie: String,
    cookie_name: String,
    admin: String,
    recovery: String,
    launch: Mutex<Option<String>>,
    pub(crate) active: Mutex<HashMap<String, watch::Sender<bool>>>,
    session_removals: Mutex<HashSet<String>>,
    pub(crate) delegated_cursor: Mutex<String>,
    pub(crate) native_reuse: crate::native::reuse::Slot,
    #[cfg(test)]
    pub(crate) claude_transport: Mutex<Option<crate::claude_fixture::Transport>>,
    pub(crate) session_credentials: Mutex<HashMap<String, String>>,
    #[cfg(test)]
    pub(crate) continuity_bound: Mutex<Option<serde_json::Value>>,
    broken: AtomicBool,
    pub(crate) activity_recording_warning: AtomicBool,
    pub restart: crate::application::Restart,
    pub stop_request: tokio::sync::Notify,
    queue_retry_pending: AtomicBool,
    pub shutdown_requested: AtomicBool,
    pub availability: Option<String>,
    pub(crate) auth_scope: Mutex<Option<crate::managed_tools::OwnedLock>>,
    #[cfg(test)]
    pub(crate) scope_root: Mutex<Option<PathBuf>>,
    #[cfg(test)]
    release_probe: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    pub(crate) runner_runtime: Mutex<crate::runner_management::Runtime>,
    pub team: Mutex<Option<Arc<crate::opencode::Runner>>>,
    pub team_unavailable: Mutex<String>,
}
impl std::ops::Deref for App {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.inner
    }
}
impl App {
    pub fn new(store: Store, host: String, binary: PathBuf, availability: Option<String>, admin: String, recovery: String) -> Self {
        Self::with_browser_cookie(store, host, binary, availability, admin, recovery, secret())
    }
    pub fn with_browser_cookie(
        mut store: Store,
        host: String,
        binary: PathBuf,
        mut availability: Option<String>,
        admin: String,
        recovery: String,
        cookie: String,
    ) -> Self {
        let selected = store.configuration().ok().and_then(|c| c.runner);
        if selected.is_none() {
            let resolved = if binary.is_absolute() {
                Some(binary.clone())
            } else {
                std::env::var_os("PATH").and_then(|paths| {
                    std::env::split_paths(&paths)
                        .map(|p| p.join(&binary))
                        .find(|p| p.is_file())
                })
            };
            if let Some(path) = resolved.filter(|p| p.is_absolute())
                && let Ok(bytes) = std::fs::read(&path)
            {
                let digest = crate::tasks::digest(&bytes);
                let result = (|| -> Result<(), String> {
                    store.register_codex(digest.clone())?;
                    let mut c = store.configuration()?;
                    c.revision = store.next_configuration_revision()?;
                    c.runner = Some(deck2_shared::RunnerBinding {
                        path: path.to_string_lossy().into_owned(),
                        executable: digest,
                        ownership: "external_unknown".into(),
                        model: None,
                        qualification: crate::runner_management::QUALIFICATION.into(),
                        catalog: None,
                    });
                    store.save_configuration(&c)
                })();
                if let Err(e) = result {
                    availability = Some(e);
                }
            }
        } else {
            // The persisted browser selection is authoritative. Startup overrides
            // are inspection candidates, never permission to replace it.
            availability = None;
        }
        let native_reuse=crate::native::reuse::Slot::default();
        let broken=native_reuse.recover(&store).is_err();
        let project = store.project.clone();
        let workspace_updates = store.workspace_updates.clone();
        workspace_updates.observe(&store.conn);
        let app=Self { project: project.clone(), inner: Arc::new(Inner {
            initial_project: project,
            store: Mutex::new(store),
            workspace_updates,
            web_push: Mutex::new(Default::default()),
            web_identity: Mutex::new(Default::default()),
            history: Mutex::new(Default::default()),
            #[cfg(test)]
            assignment_probe: Mutex::new(None),
            #[cfg(test)]
            device_history_probe: Mutex::new(None),
            dictation:tokio::sync::OnceCell::new(),
            quota_runtime: Mutex::new(Default::default()),
            claude_quota_runtime: Mutex::new(Default::default()),
            git_review: Default::default(),
            artifact_store: Mutex::new(None),
            cookie_name: format!("deck2_{}", host.rsplit(':').next().unwrap_or("local")),
            host,
            native_role_root: Mutex::new(std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".codex"))),
            binary,
            auth_scope:Mutex::new(None),
            #[cfg(test)]
            scope_root:Mutex::new(None),
            #[cfg(test)]
            release_probe:Mutex::new(None),
            runner_runtime:Mutex::new(Default::default()),
            cookie,
            admin,
            recovery,
            launch: Mutex::new(None),
            active: Mutex::new(HashMap::new()),
            session_removals: Mutex::default(),
            delegated_cursor: Mutex::new(String::new()),
            native_reuse,
            #[cfg(test)]
            claude_transport: Mutex::new(None),
            session_credentials: Mutex::new(HashMap::new()),
            #[cfg(test)]
            continuity_bound: Mutex::new(None),
            broken: AtomicBool::new(broken),
            activity_recording_warning: AtomicBool::new(false),
            restart: crate::application::Restart::new(),
            stop_request: Default::default(),
            queue_retry_pending: AtomicBool::new(false),
            shutdown_requested: AtomicBool::new(false),
            availability,
            team:Mutex::new(None),
            team_unavailable:Mutex::new("Team execution requires explicit --opencode and --investigator-model at host startup".into()),
        })};
        let reserved = {
            let s = app.store.lock().unwrap();
            s.affected_work().unwrap_or(true) || s.ordinary_preparing().unwrap_or(true)
        };
        if reserved {
            let _ = app.retain_auth_scope();
        }
        app
    }
    pub(crate) fn from_inner(inner:Arc<Inner>)->Self {Self {project:inner.initial_project.clone(),inner}}
    pub fn project_context(&self,id:&str)->Result<Self,String>{
        let project=self.store.lock().unwrap().project_by_id(id)?;
        Ok(Self{inner:self.inner.clone(),project:project.root})
    }
    pub(crate) fn for_session(&self, id: &str) -> Result<Self,String> {
        let project=self.store.lock().unwrap().execution_project(id)?;
        Ok(Self {inner:self.inner.clone(), project:project.root})
    }
    pub(crate) fn for_command(&self, id:&str)->Result<Self,String>{ self.for_session(&self.receipt(id)?.session) }
    pub(crate) fn native_admin(&self, value: &str) -> bool { value == self.admin }
    pub(crate) fn expire_browser_session(&self, headers: &mut axum::http::HeaderMap) {
        crate::web_identity::expire_cookie(headers, &self.cookie_name);
    }
    pub fn history_source(&self) -> Option<PathBuf> { self.history.lock().unwrap().root.clone() }
    pub fn browser_identity(&self, identity: crate::web_identity::Identity) { self.web_identity.lock().unwrap().identity = identity; }
    pub(crate) fn check_original_context(&self, id: &str) -> Result<(), String> {
        // Shared with workspace/notification projections: history before Store.
        let history = self.history.lock().map_err(|_| "Original history unavailable")?;
        let store = self.store.lock().map_err(|_| "State lock failed")?;
        store.execution_project(id)?;
        history.check_context(&store.session_by_id(id)?)
    }
    pub async fn adopt_history(&self, path: PathBuf) {
        let app = self.clone();
        let _ = tokio::task::spawn_blocking(move || {
            let mut reader = app.history.lock().unwrap();
            if reader.root.as_ref().is_some_and(|p| p.is_dir())
                && let Err(e) = reader.adopt(&path)
            {
                reader.adoption_issue(e);
            }
            if let Ok(catalog)=reader.catalog() {
                let mut store=app.store.lock().unwrap();
                for project in catalog["projects"].as_array().into_iter().flatten() {
                    if let Some(root)=project["path"].as_str() {let _=store.register_project(root);}
                }
            }
        })
        .await;
    }
    pub fn history_root(&self, root: Option<PathBuf>) {
        self.history.lock().unwrap().root = root;
    }
    pub fn artifact_root(&self) -> Result<PathBuf, String> {
        self.artifact_store
            .lock()
            .unwrap()
            .clone()
            .map(Ok)
            .unwrap_or_else(crate::managed_tools::default_root)
    }
    fn qualification(&self) -> Option<String> {
        self.team.lock().unwrap().as_ref().filter(|r|r.matches_project(&self.project)).map(|r| {
            crate::tasks::digest(
                serde_json::to_string(&crate::configuration::assignment_from_runner(r))
                    .unwrap()
                    .as_bytes(),
            )
        })
    }
    pub fn persistence_available(&self) -> bool {
        !self.broken.load(Ordering::SeqCst)
    }
    pub fn storage_failed(&self) {
        self.mark_broken();
        if let Ok(active) = self.active.try_lock() {
            for c in active.values() {
                let _ = c.send(true);
            }
        }
    }
    pub fn start_task(&self, task: &str, attempt: &str) -> Result<(), String> {
        if self.broken.load(Ordering::SeqCst) {
            return Err("Persistence unavailable; child dispatch blocked".into());
        }
        let normal = {
            let s = self.store.lock().unwrap();
            let t = s.task(task)?;
            s.get(&t.root)?
                .is_some_and(|r| r.mode == deck2_shared::Mode::SessionV1)
        };
        if normal {
            return self.pump_members();
        }
        let runner = self
            .team
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| self.team_unavailable.lock().unwrap().clone())?;
        let key = format!("child:{attempt}");
        let mut active = self.active.lock().unwrap();
        if self.shutdown_requested.load(Ordering::SeqCst) {return Err("Host is shutting down; launch blocked".into());}
        if active.keys().any(|k| k.starts_with("child:")) {
            return Ok(());
        }
        let s = self.store.lock().unwrap();
        if !s.task_dispatch_ready(task, attempt)? {
            return Ok(());
        }
        let t = s.task(task)?;
        let root = s.get(&t.root)?.ok_or("Root missing")?;
        let snapshot = root
            .configuration
            .as_ref()
            .ok_or("Historical assignment was not recorded; child dispatch blocked")?;
        let project=s.execution_project(&t.session)?;
        if !runner.matches_project(&project.root){return Err("Prepared resource belongs to another project".into());}
        let tools = s.execution_tools(snapshot)?;
        if root.mode.ordinary() && !runner.matches_selection(&tools, snapshot.helper.as_ref()) {
            return Err("Prepared Investigator tools differ from admission; save Session configuration again".into());
        }
        if snapshot.investigator.as_ref()
            != Some(&crate::configuration::assignment_from_runner(&runner))
        {
            return Err("Prepared resource differs from admitted assignment; no fallback".into());
        }
        if t.attempts
            .iter()
            .find(|a| a.id == attempt)
            .is_none_or(|a| a.phase != deck2_shared::Phase::Accepted)
        {
            return Ok(());
        }
        drop(s);
        let (sender, _receiver) = watch::channel(false);
        active.insert(key, sender);
        tokio::spawn(runner.run(App{inner:self.inner.clone(),project:project.root}, task.into(), attempt.into()));
        Ok(())
    }
    pub(crate) fn save_lifecycle(
        &self,
        c: &mut crate::lifecycle::Change,
        expected: &mut crate::lifecycle::Change,
    ) -> Result<(), String> {
        let result = self
            .store
            .lock()
            .map_err(|_| "State lock failed")?
            .update_lifecycle(c, expected);
        if result.is_err() {
            self.storage_failed();
        }
        result
    }
    pub fn change(&self, id: &str, f: impl FnOnce(&mut Receipt)) -> Result<(), String> {
        self.change_receipt(id, None, f)
    }
    pub(crate) fn append_claude_delta(&self, id: &str, text: &str, sdk_received_ms: Option<u64>) -> Result<(), String> {
        self.change_receipt(id, sdk_received_ms, |r| {
            r.first_output_ms.get_or_insert_with(crate::now);
            r.text.push_str(text);
        })
    }
    fn change_receipt(&self, id: &str, sdk_received_ms: Option<u64>, f: impl FnOnce(&mut Receipt)) -> Result<(), String> {
        let result = (|| {
            let mut s = crate::latency::locked_checked(&self.store).map_err(|_| "State lock failed")?;
            let mut r = s.get(id)?.ok_or("Receipt missing")?;
            let previous_text_bytes = r.text.len();
            f(&mut r);
            if !r.phase.active() {
                r.context.compacting = None;
            }
            s.save(&mut r)?;
            if let Some(received) = sdk_received_ms {
                self.workspace_updates.record_claude_append(
                    id, r.revision, received, previous_text_bytes, &r.text[previous_text_bytes..],
                );
            }
            Ok(())
        })();
        if result.is_err() {
            self.mark_broken();
            for c in self.active.lock().unwrap().values() {
                let _ = c.send(true);
            }
        }
        result
    }
    pub fn receipt(&self, id: &str) -> Result<Receipt, String> {
        crate::latency::locked_checked(&self.store)
            .map_err(|_| "State lock failed")?
            .get(id)?
            .ok_or("Unknown command identity".into())
    }
    fn release_settled_auth_scope(&self) {
        let active = self.active.lock().unwrap();
        let store = self.store.lock().unwrap();
        self.release_auth_if_settled(&active, &store);
    }
    fn release_auth_if_settled(
        &self,
        active: &HashMap<String, watch::Sender<bool>>,
        store: &Store,
    ) {
        // Admission uses the same active -> Store -> auth_scope order. Keep both
        // guards through release; terminal receipts alone do not settle processes.
        // Failed reads and uncertain login ownership conservatively retain scope.
        if active.is_empty()
            && store.affected_work().is_ok_and(|busy| !busy)
            && store.runner_busy().is_ok_and(|busy| !busy)
        {
            #[cfg(test)]
            self.probe_release();
            // flock belongs to the open file description. Concurrent subprocess
            // creation can inherit a CLOEXEC copy until exec; dropping our copy
            // alone would temporarily leave a settled reservation locked.
            let mut scope = self.auth_scope.lock().unwrap();
            if scope
                .as_ref()
                .is_some_and(|file| fs2::FileExt::unlock(&file.0).is_ok())
            {
                scope.take();
            }
        }
    }
    #[cfg(test)]
    fn probe_release(&self) {
        let probe = self.release_probe.lock().unwrap().take();
        if let Some(probe) = probe {
            probe();
        }
    }
    fn signal_cancelled_roots(&self)->Result<(),String> {
        let active=self.active.lock().map_err(|_|"Admission lock failed")?;
        let store=self.store.lock().map_err(|_|"State lock failed")?;
        for r in store.all()?.into_iter().filter(|r|r.cancel_requested) {if let Some(sender)=active.get(&r.id) {let _=sender.send(true);}}
        Ok(())
    }
    fn mark_broken(&self) {
        self.broken.store(true, Ordering::SeqCst);
        self.workspace_updates.notify();
    }
    pub fn clear_active(&self, id: &str) {
        if self.active.lock().unwrap().remove(id).is_some() {
            self.workspace_updates.notify();
        }
        // Legacy settlement can be observed before its worker key is removed.
        // Retry only the exclusive legacy lane; connected admission retains its
        // own fair pump. start_task rechecks live keys and durable uncertainty.
        let pending = (|| -> Result<_, String> {
            let store = self.store.lock().map_err(|_| "State lock failed")?;
            for task in store.tasks()? {
                if store.get(&task.root)?.is_some_and(|r| r.mode != deck2_shared::Mode::SessionV1)
                    && let Some(attempt) = task.attempts.iter().find(|a| a.phase == deck2_shared::Phase::Accepted)
                {
                    return Ok(Some((task.id, attempt.id.clone())));
                }
            }
            Ok(None)
        })();
        match pending {
            Ok(Some((task, attempt))) => {
                if self.start_task(&task, &attempt).is_err() { self.storage_failed(); }
            }
            Err(_) => self.storage_failed(),
            Ok(None) => {}
        }
        if self.pump_members().is_err() { self.storage_failed(); }
        self.release_settled_auth_scope();
        self.pump_queue();
    }
    pub fn pump_queue(&self) {
        if self.pump_members().is_err() { self.storage_failed();return; }
        if self.broken.load(Ordering::SeqCst) {
            return;
        }
        let configured = self.web_identity.lock().unwrap().identity.scheduler_config();
        let mut active = self.active.lock().unwrap();
        if self.shutdown_requested.load(Ordering::SeqCst) { return; }
        let mut s = self.store.lock().unwrap();
        let cap = match configured.and_then(|raw| crate::session_scheduler::lead_limit(&s.configuration()?, &raw)) { Ok(cap) => cap, Err(_) => return };
        let live = match self.live_roots(&active, &s, "") { Ok(live) => live, Err(_) => return };
        #[cfg(test)]
        if let Some(transport) = self.claude_transport.lock().unwrap().as_ref()
            && transport.settle_waiting_roots(&mut s, &live).is_err()
        {
            self.mark_broken();
            return;
        }
        let live_members = active.keys().filter_map(|key| key.strip_prefix("child:").map(str::to_owned)).collect();
        let recovered = crate::claude::settle_recovered(&mut s, &live)
            .and_then(|claude| crate::claude::member::settle_recovered(&mut s, &live_members).map(|member| claude || member))
            .and_then(|claude| crate::codex_member::settle_recovered(&mut s, &live_members).map(|member| claude || member))
            .and_then(|claude| self.native_reuse.settle_waiting_roots(&mut s, &live).map(|codex| claude || codex));
        let recovering = match recovered {
            Ok(recovering) => recovering,
            Err(_) => { self.mark_broken(); return; }
        };
        // Explanation only; a failure here must not hold the queue.
        let _ = s.explain_member_wait();
        let affected = s.affected_work().unwrap_or(true);
        if affected && self.retain_auth_scope().is_err() { return; }
        let mut retry_at = None;
        let next = s.claim_next_with_limit(&live, cap, &mut retry_at);
        if affected && matches!(&next, Ok(None)) {
            // A redundant outcome can drain the queue without starting a worker.
            self.release_auth_if_settled(&active, &s);
        }
        if matches!(next, Ok(None)) {
            let now = crate::now();
            let retry_delay = retry_at.map(|at| at.saturating_sub(now));
            if let Some(delay) = retry_delay.into_iter().chain(recovering.then_some(3_000)).min()
                && !self.queue_retry_pending.swap(true, Ordering::SeqCst)
            {
                let weak = Arc::downgrade(&self.inner);
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(delay.min(3_000))).await;
                    if let Some(inner) = weak.upgrade() {
                        let app = App::from_inner(inner);
                        app.queue_retry_pending.store(false, Ordering::SeqCst);
                        app.pump_queue();
                    }
                });
            }
        }
        drop(s);
        if next.is_err() {
            self.mark_broken();
            return;
        }
        if let Ok(Some(r)) = next {
            // The claim fixes the receipt owner. Native admission resolves and
            // validates that owner's captured executable, never this App view.
            let (sender, receiver) = watch::channel(false);
            active.insert(r.id.clone(), sender);
            tokio::spawn(crate::native::run(
                self.clone(),
                r.id,
                self.binary.clone(),
                receiver,
            ));
            drop(active);
            self.pump_queue();
        }
    }
    pub fn close_workspace_updates(&self) {
        self.workspace_updates.close();
    }
    pub fn shutdown(&self) {
        {let _admission=self.active.lock().unwrap();
        self.shutdown_requested.store(true, Ordering::SeqCst);}
        self.shutdown_native();
        {
            let mut store = self.store.lock().unwrap();
            let roots = store.all().map(|rows| {
                rows.into_iter()
                    .filter(|r| r.phase.active() &&
                        !(crate::claude::is_receipt(r) && r.dispatch_ms.is_none()))
                    .map(|r| r.id)
                    .collect::<Vec<_>>()
            });
            match roots {
                Ok(roots) => {
                    for root in roots {
                        if store.request_cancel(&root).is_err() {
                            self.mark_broken();
                        }
                    }
                }
                Err(_) => {
                    self.mark_broken();
                }
            }
            if let Ok(tasks) = store.tasks() {
                for task in tasks {
                    for attempt in &task.attempts {
                        if store.cancel_tasks(task.authority_root(attempt)).is_err() {
                            self.mark_broken();
                        }
                    }
                }
            }
        }
        for c in self.active.lock().unwrap().values() {
            let _ = c.send(true);
        }
    }
    pub async fn drain_shutdown(&self) {
        let drain = async {
            self.retire_native().await.ok();
            // A worker can exit while its detached native cleanup still owns
            // the child. Keep the runtime alive to reap it before exiting.
            while !self.active.lock().unwrap().is_empty() || self.native_retiring() {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        };
        if tokio::time::timeout(std::time::Duration::from_secs(15), drain).await.is_err() {
            eprintln!("Deck shutdown: native settlement is still unconfirmed");
        }
    }
    pub fn write_restart_cookie(&self, stream: &mut impl std::io::Write) -> std::io::Result<()> {
        stream.write_all(self.cookie.as_bytes())
    }
    pub fn issue_launch(&self) -> String {
        let token = secret();
        *self.launch.lock().unwrap() = Some(token.clone());
        token
    }
}
pub fn secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
#[derive(Clone)]
struct Diagnostic {
    id: String,
    code: String,
    status: u16,
}
pub(crate) fn problem(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    let id = uuid::Uuid::new_v4().to_string();
    let mut response = (
        status,
        Json(Problem {
            code: code.into(),
            message: message.into(),
            correlation: id.clone(),
        }),
    )
        .into_response();
    response.extensions_mut().insert(Diagnostic {
        id,
        code: code.into(),
        status: status.as_u16(),
    });
    response
}
fn record_problem(app: &App, response: &Response) {
    if let Some(d) = response.extensions().get::<Diagnostic>()
        && let Ok(s) = app.store.lock()
    {
        s.diagnostic(&d.id, &d.code, d.status);
    }
}

pub(crate) async fn boundary(State(app): State<App>, req: Request, next: Next) -> Response {
    let h = req.headers();
    let path = req.uri().path();
    let cookie = h
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(';')
                .any(|v| v.trim() == format!("{}={}", app.cookie_name, app.cookie))
        });
    let public = !path.starts_with("/api/");
    let origin = h.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    let host = h.get(header::HOST).and_then(|v| v.to_str().ok());
    let launch = path == "/launch";
    let workspace_stream = path == "/api/workspace/events";
    // Keep each admission requirement independent; diagnostics contain only the
    // failed boundary, never headers, cookies, capabilities or request bodies.
    let recovery = format!(
        "Browser authentication required. Draft and unresolved command identity are retained. Run {}. If the opener fails, use {} --print-url and open the private link here. The bare host address does not authenticate. If this host has stopped, restart it with this same state directory. Reload after authentication.",
        app.recovery, app.recovery
    );
    let identity = app.web_identity.lock().unwrap().identity.clone();
    let peer = req.extensions().get::<axum::extract::ConnectInfo<std::net::SocketAddr>>().map(|p|p.0);
    let original_cookie = crate::web_identity::cookie(h).is_some();
    let original_auth = original_cookie && identity.authorized(h, peer);
    let local_access = path == "/api/local-access";
    let native_control = path == "/web-control";
    let identity_boundary = identity.boundary(h, req.method(), &app.host, peer);
    let denied = if launch || native_control {
        if host != Some(app.host.as_str()) || origin.is_some_and(|o|o!=format!("http://{}",app.host)) || h.keys().any(|k|k=="forwarded"||k.as_str().starts_with("x-forwarded-")||k.as_str().contains("funnel")) {
            Some(("host_denied", "Native launcher requires the local host"))
        } else { None }
    } else if !identity.host_allowed(host,&app.host) {
        Some(("host_denied", "Unexpected host address"))
    } else if (req.method()!=axum::http::Method::GET&&origin.is_none())||origin.is_some_and(|o|reqwest::Url::parse(o).ok().map(|u|u.origin().ascii_serialization())!=Some(o.to_string())||o.split_once("://").map(|(_,h)|h)!=host) {
        Some(("origin_denied", "Unexpected browser origin"))
    } else if !identity_boundary {
        Some(("request-forbidden", "Unexpected host, origin or proxy"))
    } else if h.get("sec-fetch-site").is_some_and(|v|v=="cross-site") {
        Some(("fetch_site_denied", "Cross-site access denied"))
    } else if !public && !local_access && !(if original_cookie {original_auth} else {cookie}) {
        Some(("session_required", recovery.as_str()))
    } else { None };
    if let Some((code, message)) = denied {
        let response = problem(StatusCode::FORBIDDEN, code, message);
        record_problem(&app, &response);
        return response;
    }
    let _restart_admission = if !public && req.method() != axum::http::Method::GET && path != "/api/application/restart" {
        let guard = app.restart.admission.read().await;
        if app.restart.pending() {
            return problem(StatusCode::CONFLICT, "shutting_down", "Deck is restarting.");
        }
        Some(guard)
    } else { None };
    // Dropping an in-flight handler cancels its owned work through existing drop
    // guards. Never keep a cached original grant after source replacement/revoke.
    let headers = req.headers().clone();
    let authority = original_auth.then(||crate::web_identity::RequestAuthority::new(identity.clone(),headers.clone(),peer));
    let mut response = if original_auth && !public && !local_access {
        let run = crate::web_identity::request_scope(authority.clone(), next.run(req));
        tokio::pin!(run);
        let mut timer = tokio::time::interval(std::time::Duration::from_millis(100));
        loop { tokio::select! {
            result = &mut run => {
                if !authority.as_ref().is_some_and(|a|a.accepted()) && !identity.authorized(&headers, peer) {return problem(StatusCode::FORBIDDEN,"device-required","Device access ended");}
                break result;
            },
            _ = timer.tick() => {if !authority.as_ref().is_some_and(|a|a.accepted()) && !identity.authorized(&headers, peer) {return problem(StatusCode::FORBIDDEN,"device-required","Device access ended");}}
        }}
    } else {next.run(req).await};
    if original_auth && !public && !local_access && !authority.as_ref().is_some_and(|a|a.accepted()) {
        use futures_util::StreamExt;
        let (parts, body) = response.into_parts();
        let stream = futures_util::stream::try_unfold((body.into_data_stream(), identity, headers, peer), move |(mut body, identity, headers, peer)| async move {
            let mut timer = tokio::time::interval(std::time::Duration::from_millis(if workspace_stream { 5000 } else { 100 }));
            loop {
                if !identity.authorized(&headers,peer) {return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied,"Device access ended"));}
                tokio::select! {
                    chunk = body.next() => return match chunk {
                        Some(Ok(bytes)) => if identity.authorized(&headers,peer) {Ok(Some((bytes,(body,identity,headers,peer))))} else {Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied,"Device access ended"))},
                        Some(Err(_)) => Err(std::io::Error::other("Response stream ended")),
                        None => Ok(None),
                    },
                    _ = timer.tick() => {}
                }
            }
        });
        response = Response::from_parts(parts,Body::from_stream(stream));
    }
    record_problem(&app, &response);
    let h = response.headers_mut();
    h.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    h.insert("x-content-type-options", "nosniff".parse().unwrap());
    h.insert("referrer-policy", "no-referrer".parse().unwrap());
    h.insert("x-frame-options", "DENY".parse().unwrap());
    h.insert("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'".parse().unwrap());
    response
}
async fn launch(State(app): State<App>, body: String) -> Response {
    if body != app.admin {
        return problem(
            StatusCode::FORBIDDEN,
            "access_denied",
            "Invalid launcher credential",
        );
    }
    Json(json!({"url":format!("http://{}/#{}",app.host,app.issue_launch())})).into_response()
}
async fn auth(
    State(app): State<App>,
    headers: axum::http::HeaderMap,
    peer: Option<axum::Extension<axum::extract::ConnectInfo<std::net::SocketAddr>>>,
    body: String,
) -> Response {
    let mut token = app.launch.lock().unwrap();
    if token.as_deref() != Some(&body) {
        return problem(
            StatusCode::FORBIDDEN,
            "expired_launch",
            format!(
                "Launch link expired. Run {} for this host, or {} --print-url for a private manual link. Draft and unresolved command identity are retained.",
                app.recovery, app.recovery
            ),
        );
    }
    *token = None;
    drop(token);
    let mut response = StatusCode::NO_CONTENT.into_response();
    let identity = app.web_identity.lock().unwrap().identity.clone();
    let peer = peer.map(|p| p.0.0);
    if identity.remembered(&headers, peer) {
        app.expire_browser_session(response.headers_mut());
    } else {
        // Keep the legacy session cookie for a valid, single-use launcher.
        response.headers_mut().insert(
            header::SET_COOKIE,
            format!(
                "{}={}; HttpOnly; SameSite=Strict; Path=/",
                app.cookie_name, app.cookie
            )
            .parse()
            .unwrap(),
        );
        crate::web_identity::clear_stale_device(&identity, &headers, peer, &mut response);
    }
    response
}
#[derive(serde::Deserialize)]
struct WorkspaceQuery { transport: Option<String> }

async fn workspace(State(app): State<App>, uri: axum::http::Uri) -> Response {
    if axum::extract::Query::<WorkspaceQuery>::try_from_uri(&uri)
        .is_ok_and(|q| q.transport.as_deref() == Some("events")) {
        return crate::workspace_events::bootstrap(app).await;
    }
    tokio::task::spawn_blocking(move || workspace_response(&app))
        .await
        .unwrap_or_else(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())
}

fn workspace_response(app: &App) -> Response {
    match project_workspace(app) {
        Ok(value) => Json(value).into_response(),
        Err(error) => error,
    }
}

pub(crate) fn project_workspace(app: &App) -> Result<serde_json::Value, Response> {
    // Match admission lock order. Release shared state before projecting JSON.
    let mut trace = crate::latency::Trace::new("workspace");
    let active = trace.lock(&app.active, crate::latency::Lock::Active);
    let history = trace.lock(&app.history, crate::latency::Lock::History);
    let store = trace.lock(&app.store, crate::latency::Lock::Store);
    let storage = |error: String| problem(StatusCode::SERVICE_UNAVAILABLE, "storage", error);
    // Capture the durable rows under the admission locks. Only turns with
    // approvals or a possible steering role need decoding before release.
    let receipt_rows = (|| -> rusqlite::Result<Vec<(String, bool)>> {
        let mut stmt = store.conn.prepare_cached(
            "SELECT body, COALESCE(json_array_length(body, '$.decisions') > 0
             OR json_extract(body, '$.phase') IN ('queued', 'running'), false)
             FROM receipts ORDER BY rowid",
        )?;
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect()
    })().map_err(|_| storage("State read failed".into()))?;
    let decode = |body: &str| {
        serde_json::from_str::<deck2_shared::Receipt>(body)
            .map_err(|_| storage("Corrupt receipt; preserve state for inspection".into()))
    };
    let relevant_receipts: Vec<_> = receipt_rows.iter()
        .filter(|(_, relevant)| *relevant)
        .map(|(body, _)| decode(body))
        .collect::<Result<_, _>>()?;
    let mut tasks = store.tasks().map_err(storage)?;
    let sessions = store.sessions().map_err(storage)?;
    let host_id = store.host_id().map_err(storage)?;
    let queue_paused = store.queue_paused().map_err(storage)?;
    let trusted =
        !app.project.is_empty() && store.trusted_project(&app.project).map_err(storage)?;
    let steerable_queued =
        crate::steering::eligible_queue_ids(&store, &relevant_receipts).map_err(storage)?;
    let dismissal_blockers: Vec<_> = tasks
        .iter()
        .map(|task| {
            crate::task_panel::failure_dismissal_blocker(task, &relevant_receipts, |attempt| {
                active.contains_key(&format!("child:{attempt}"))
            })
        })
        .collect();
    let process_active = !active.is_empty();
    let default_session = if store.session.is_empty() {
        sessions
            .first()
            .map(|session| session.id.clone())
            .unwrap_or_default()
    } else {
        store.session.clone()
    };

    let broken = app.broken.load(Ordering::SeqCst);
    let unavailable =
        broken.then(|| "Receipt persistence failed; dispatch is blocked.".to_string());
    let availability = if broken {
        Some("Receipt persistence failed. Stop Deck and inspect its state directory; dispatch is blocked.".into())
    } else {
        app.runner_available_for(&store, &app.project)
    };
    let projects = store.projects().unwrap_or_default();
    let project_trust: BTreeMap<_, _> = projects
        .iter()
        .map(|p| {
            (
                p.id.clone(),
                store.trusted_project(&p.root).unwrap_or(false),
            )
        })
        .collect();
    let project_availability: BTreeMap<_, _> = projects
        .iter()
        .map(|p| {
            let reason = unavailable
                .clone()
                .or_else(|| crate::projects::validate(p).err())
                .or_else(|| app.runner_available_for(&store, &p.root));
            (p.id.clone(), reason)
        })
        .collect();
    let mut availability_by_runner = HashMap::new();
    let session_availability: BTreeMap<_, _> = sessions
        .iter()
        .filter_map(|session| {
            let runner = &session.contract.as_ref()?.members.get("lead")?.runner_id;
            let root = &session.project.root;
            let reason = availability_by_runner
                .entry((runner, root))
                .or_insert_with(|| {
                    unavailable.clone().or_else(|| match runner.as_str() {
                        "opencode" => crate::connected_opencode::source::executable().err(),
                        crate::claude::RUNNER => crate::claude::executable()
                            .and_then(|_| crate::claude::node_runtime())
                            .err(),
                        "codex" => app.runner_available_for(&store, root),
                        _ => Some("Selected runner is unavailable".into()),
                    })
                });
            Some((session.id.clone(), reason.clone()))
        })
        .collect();
    let team = app.team.lock().unwrap();
    let team_disabled =
        "Team investigation is disabled for new work. Review Configuration to re-enable it.";
    let team_availability = |project: &str, is_initial| {
        if !store
            .configuration_for(project)
            .is_ok_and(|c| c.team_enabled)
        {
            Some(team_disabled.to_string())
        } else if team
            .as_ref()
            .is_some_and(|runner| runner.matches_project(project))
        {
            None
        } else if is_initial {
            Some(app.team_unavailable.lock().unwrap().clone())
        } else {
            Some("Investigator is not prepared for this project.".to_string())
        }
    };
    let team_availability_for_initial = team_availability(&app.project, true);
    let project_team_availability: BTreeMap<_, _> = projects
        .iter()
        .map(|p| (p.id.clone(), team_availability(&p.root, false)))
        .collect();
    drop(team);

    let mut boundary_by_session = HashMap::new();
    let decision_notifications: HashMap<_, Vec<_>> = relevant_receipts
        .iter()
        .filter(|receipt| !receipt.decisions.is_empty())
        .map(|receipt| {
            let offset = *boundary_by_session
                .entry(&receipt.session)
                .or_insert_with(|| history.notification_boundary(&receipt.session).unwrap_or(0));
            let occurrences = receipt.decisions.iter().map(|decision| {
                crate::web_push::decision_occurrence(&store, receipt, decision)
                    .ok()
                    .flatten()
                    .map(|(seq, _)| seq + offset)
            }).collect();
            (receipt.id.as_str(), occurrences)
        })
        .collect();
    let decision_revisions = (|| -> rusqlite::Result<BTreeMap<String, u64>> {
        let mut stmt = store
            .conn
            .prepare_cached("SELECT session, COUNT(*) FROM decision_commands GROUP BY session")?;
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect()
    })()
    .map_err(|_| storage("Decision revisions unavailable".into()))?;
    drop(boundary_by_session);
    drop(availability_by_runner);
    trace.release();
    drop(store);
    drop(history);
    drop(active);

    let mut receipts = receipt_rows.into_iter()
        .map(|(body, _)| decode(&body))
        .collect::<Result<Vec<_>, _>>()?;
    crate::observations::project(&mut receipts, &mut tasks, &sessions);
    let snapshot = Workspace {
        tasks,
        team_availability: team_availability_for_initial,
        host_id,
        sessions,
        queue_paused,
        steering_unavailable: "Live steering requires a running Lead turn that accepts live input.".into(),
        trusted,
        api: API,
        session: default_session,
        project: app.project.clone(),
        runner: "Codex · reviewed edits / read-only".into(),
        availability,
        receipts,
    };
    let mut value = serde_json::to_value(&snapshot).unwrap();
    for (receipt, value) in snapshot
        .receipts
        .iter()
        .zip(value["receipts"].as_array_mut().unwrap())
    {
        crate::execution_view::project_receipt(receipt, value);
        if let Some(notifications) = decision_notifications.get(receipt.id.as_str()) {
            for (at, seq) in notifications.iter().enumerate() {
                if let Some(seq) = seq {
                    value["decisions"][at]["notificationSeq"] = json!(seq);
                }
            }
        }
    }
    for (task, blocker) in value["tasks"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .zip(dismissal_blockers)
    {
        if let Some(blocker) = blocker {
            let attempt = task["attempts"].as_array_mut().unwrap().last_mut().unwrap();
            attempt["failure_dismissal_blocker"] = json!(blocker);
        }
    }
    value["steerable_queued"] = json!(steerable_queued);
    value["process_active"] = json!(process_active);
    if !app.project.is_empty() {
        value["initial_project"] = json!(crate::projects::id(&app.project));
    }
    value["projects"] = json!(projects);
    value["project_trust"] = json!(project_trust);
    value["project_availability"] = json!(project_availability);
    value["session_availability"] = json!(session_availability);
    value["project_team_availability"] = json!(project_team_availability);
    value["decision_revisions"] = json!(decision_revisions);
    Ok(value)
}
async fn changes(State(app): State<App>) -> Response {
    let s = app.store.lock().unwrap();
    match s.changes() {
        Ok(list) => {
            let mut projected = vec![];
            for mut c in list {
                let binding = c
                    .roots
                    .last()
                    .and_then(|id| s.get(id).ok().flatten())
                    .and_then(|r| r.configuration)
                    .and_then(|c| c.runner);
                let path = binding
                    .map(|b| PathBuf::from(b.path))
                    .unwrap_or_else(|| app.binary.clone());
                let native = std::fs::read(path)
                    .map(|b| crate::tasks::digest(&b))
                    .unwrap_or_default();
                let gaps = s.completion_gaps(&c, &native);
                if c.completion == "completed" && !gaps.is_empty() {
                    if let Some(r) = crate::web_identity::effect_denied() { return r; }
                    c.completion = "incomplete".into();
                    if let Err(e) = s.save_change(&c) {
                        return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e);
                    }
                }
                let mut value = serde_json::to_value(&c).unwrap();
                value["gaps"] = json!(gaps);
                projected.push(value);
            }
            Json(json!({"api":API,"changes":projected})).into_response()
        }
        Err(e) => problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e),
    }
}
async fn create_change(
    State(app): State<App>,
    Json(command): Json<crate::lifecycle::CreateChange>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if !app.persistence_available() {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Persistence unavailable",
        );
    }
    let active = app.active.lock().unwrap();
    if !active.is_empty() {
        return problem(
            StatusCode::CONFLICT,
            "ownership",
            "Settle project execution before recording scoped intent",
        );
    }
    match app.store.lock().unwrap().create_change(&command) {
        Ok(c) => Json(c).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "change_rejected", e),
    }
}
async fn upload_image(
    State(app): State<App>,
    Path((session, upload)): Path<(String, String)>,
    bytes: axum::body::Bytes,
) -> Response {
    if !app.persistence_available() {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Persistence unavailable",
        );
    }
    static DECODERS: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
    let permit = match DECODERS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(1)))
        .clone()
        .acquire_owned()
        .await
    {
        Ok(p) => p,
        Err(_) => {
            return problem(
                StatusCode::SERVICE_UNAVAILABLE,
                "image_rejected",
                "Image decoder unavailable",
            );
        }
    };
    // The decoder has a strict allocation ceiling and only one runs at a time.
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let metadata = crate::images::validate(&bytes);
        (metadata, bytes)
    })
    .await;
    let (metadata, bytes) = match result {
        Ok((Ok(a), b)) => (a, b),
        _ => {
            return problem(
                StatusCode::UNPROCESSABLE_ENTITY,
                "image_rejected",
                "Malformed, unsupported or oversized image (PNG/JPEG/WebP, 5 MiB, 16384px/40MP maximum)",
            );
        }
    };
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    let store = app.store.lock().unwrap();
    match store.upload_image(&session, &upload, metadata, &bytes) {
        Ok(a) => Json(a).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "image_rejected", e),
    }
}
async fn cancel_upload(
    State(app): State<App>,
    Path((session, upload)): Path<(String, String)>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    match app.store.lock().unwrap().cancel_upload(&session, &upload) {
        Ok(()) => Json(json!({"removed":true})).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "upload_retained", e),
    }
}
async fn upload_status(
    State(app): State<App>,
    Path((session, upload)): Path<(String, String)>,
) -> Response {
    match app.store.lock().unwrap().uploaded_image(&session, &upload) {
        Ok(a) => Json(a).into_response(),
        Err(e) => problem(StatusCode::NOT_FOUND, "upload_unavailable", e),
    }
}
async fn read_image(
    State(app): State<App>,
    Path((session, id)): Path<(String, String)>,
) -> Response {
    match app.store.lock().unwrap().image(&session, &id) {
        Ok((a, bytes)) => (
            [
                (header::CONTENT_TYPE, a.mime),
                (header::CONTENT_DISPOSITION, "inline".into()),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => problem(StatusCode::NOT_FOUND, "image_unavailable", e),
    }
}
async fn remove_image(
    State(app): State<App>,
    Path((session, id)): Path<(String, String)>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    match app.store.lock().unwrap().remove_image(&session, &id) {
        Ok(()) => Json(json!({"removed":true})).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "image_retained", e),
    }
}
async fn browser_submit(
 State(app):State<App>,
 axum::extract::Query(target):axum::extract::Query<crate::session_decisions::ReplyTarget>,
 headers:axum::http::HeaderMap,
 peer:Option<axum::Extension<axum::extract::ConnectInfo<std::net::SocketAddr>>>,
 Json(command):Json<crate::web_push::BrowserCommand>,
)->Response {
 match command {
  crate::web_push::BrowserCommand::Submit(command)=>submit(State(app),axum::extract::Query(target),Json(command)).await,
  crate::web_push::BrowserCommand::Notification(body)=>crate::web_push::notification_command(&app,&headers,peer.map(|p|p.0.0),body),
 }
}
async fn submit(
 State(app):State<App>,
 axum::extract::Query(target):axum::extract::Query<crate::session_decisions::ReplyTarget>,
 Json(mut command):Json<ScopedSubmit>,
)->Response {
    let received = std::time::Instant::now();
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if app.broken.load(Ordering::SeqCst) {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Receipt persistence failed; dispatch blocked",
        );
    }
    // Active registration and durable acceptance are serialized to prevent a
    // concurrent retry from launching a second native process.
    let mut trace = crate::latency::Trace::new("submit");
    let owner=trace.transient(&app.store).session_project(&command.session);
    let app=match owner {Ok(p)=>App{inner:app.inner.clone(),project:p.root},Err(e)=>return problem(StatusCode::CONFLICT,"session",e)};
    let scheduler_config = trace.transient(&app.web_identity).identity.scheduler_config();
    let mut active = trace.lock(&app.active, crate::latency::Lock::Active);
    let history = trace.lock(&app.history, crate::latency::Lock::History);
    let mut store = trace.lock(&app.store, crate::latency::Lock::Store);
    trace.acquired();
    let existing = match store.get(&command.id) {
        Ok(r) => r.is_some(),
        Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e),
    };
    if !existing && app.shutdown_requested.load(Ordering::SeqCst) {return problem(StatusCode::CONFLICT,"shutting_down","Host is shutting down; new input was not accepted");}
    let capacity = app.live_roots(&active, &store, &command.session).and_then(|live| {
        let raw=scheduler_config?;
        let cap=crate::session_scheduler::lead_limit(&store.configuration()?, &raw)?;
        store.root_available(&command.mode, &command.session, &live, cap)
    });
    // A normal canonical send is a durable next turn, never live steering.
    // Decide under the same admission lock as worker reservations and retries.
    // Do not let an idle-looking session jump ahead of its older queued input.
    if !existing && command.mode == deck2_shared::Mode::SessionV1 && !command.queue {
        let waiting = match store.pending_receipts() {
            Ok(rows) => rows.iter().any(|r| r.session == command.session && r.phase == deck2_shared::Phase::Queued),
            Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e),
        };
        let blocked = store.member_blocks_root(&command.mode, &command.session);
        command.queue = !matches!(capacity, Ok(true)) || waiting || !matches!(blocked, Ok(false));
    }
    if !existing && !command.queue && !matches!(capacity, Ok(true)) {
        return (StatusCode::CONFLICT, Json(json!({"api":API,"code":"command_not_accepted","id":command.id,"session":command.session,"message":"Project process ownership is still active; queue the next input"}))).into_response();
    }
    if !existing && command.mode == deck2_shared::Mode::Team && app.team.lock().unwrap().as_ref().is_none_or(|r|!r.matches_project(&app.project)) {
        return (StatusCode::CONFLICT,Json(json!({"api":API,"code":"command_not_accepted","id":command.id,"session":command.session,"message":app.team_unavailable.lock().unwrap().clone()}))).into_response();
    }
    if !existing && !command.queue {
        let selected = store.session_by_id(&command.session).ok().and_then(|s|s.contract)
            .and_then(|c|c.members.get("lead").cloned());
        let unavailable = match selected.as_ref().map(|a| a.runner_id.as_str()) {
            Some("opencode") => crate::connected_opencode::source::executable().err(),
            Some(crate::claude::RUNNER) => crate::claude::executable().and_then(|_| crate::claude::node_runtime()).err(),
            _ => app.runner_available_for(&store, &app.project),
        };
        if let Some(reason) = unavailable {
            return problem(StatusCode::SERVICE_UNAVAILABLE, "native_unavailable", reason);
        }
    }
    if !existing
        && command.mode == deck2_shared::Mode::Team
        && store
            .configuration_for(&app.project)
            .is_ok_and(|c| c.qualification() != app.qualification())
    {
        return problem(
            StatusCode::CONFLICT,
            "preparation_changed",
            "Prepared assignment does not match selected configuration; no fallback",
        );
    }
    if !existing && let Err(e) = app.retain_auth_scope() {
        return (StatusCode::CONFLICT,Json(json!({"api":API,"code":"command_not_accepted","id":command.id,"session":command.session,"message":e}))).into_response();
    }
    if !existing {
        let checked = store.session_by_id(&command.session).and_then(|s| {
            store.execution_project(&s.id)?;
            history.check_context(&s)
        });
        if let Err(e) = checked {
            app.release_auth_if_settled(&active, &store);
            return (StatusCode::CONFLICT,Json(json!({"api":API,"code":"command_not_accepted","id":command.id,"session":command.session,"message":e}))).into_response();
        }
    }
    let receipt = match crate::session_decisions::admit(&mut store, &command, &target) {
        Ok(r) => r,
        Err(e) => {
            app.release_auth_if_settled(&active, &store);
            if e.storage {
                app.mark_broken();
                return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e.message);
            }
            if !existing {
                return (StatusCode::CONFLICT,Json(json!({"api":API,"code":"command_not_accepted","id":command.id,"session":command.session,"message":e.message}))).into_response();
            }
            return problem(StatusCode::CONFLICT, "command_rejected", e.message);
        }
    };
    let commit_ms = received.elapsed().as_secs_f64() * 1000.0;
    if !existing {
        crate::latency::remember_submit(&command.id, trace.waits().clone());
    }
    if !existing && !command.queue {
        let (sender, receiver) = watch::channel(false);
        active.insert(command.id.clone(), sender);
        tokio::spawn(crate::native::run(
            app.clone(),
            command.id,
            app.binary.clone(),
            receiver,
        ));
    }
    let waits = trace.release();
    drop(store);
    drop(history);
    drop(active);
    // Let the browser receive the committed receipt independently of the
    // scheduler and optional automatic index maintenance.
    let needs_pump = !existing || receipt.phase == deck2_shared::Phase::Queued;
    let mut response = Json(receipt).into_response();
    let response_ms = received.elapsed().as_secs_f64() * 1000.0;
    let timing = if existing {
        format!("deck_receipt;dur={response_ms:.2}")
    } else {
        format!(
            "deck_commit;dur={commit_ms:.2}, deck_receipt;dur={response_ms:.2}, \
             deck_lock_active;dur={:.2}, deck_lock_history;dur={:.2}, deck_lock_store;dur={:.2}, \
             deck_lock_pre;dur={:.2}, deck_lock_blocker;dur={:.2};desc=\"{}\"",
            waits.active_us as f64 / 1000.0,
            waits.history_us as f64 / 1000.0,
            waits.store_us as f64 / 1000.0,
            waits.pre_us as f64 / 1000.0,
            waits.blocker_us as f64 / 1000.0,
            if waits.blocker.is_empty() { "none" } else { waits.blocker },
        )
    };
    response.headers_mut().insert("server-timing", timing.parse().unwrap());
    if needs_pump {
        tokio::task::spawn_blocking(move || {
            app.pump_queue();
            if !existing {
                crate::cbm_automatic::used(&app);
            }
        });
    }
    response
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RecallInput {
    api: u32,
    session: String,
    attempt: String,
}
async fn recall_input(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(body): Json<RecallInput>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if body.api != API || app.broken.load(Ordering::SeqCst) {
        return problem(
            StatusCode::CONFLICT,
            "recall_unconfirmed",
            "Incompatible API or unavailable store",
        );
    }
    let result = app
        .store
        .lock()
        .unwrap()
        .recall_input(&body.session, &id, &body.attempt);
    match result {
        Ok(r) => {
            if let Some(sender) = app.active.lock().unwrap().get(&id) {
                let _ = sender.send(true);
            }
            app.release_settled_auth_scope();
            Json(json!({"id":r.id,"session":r.session,"attempt":r.attempt,"state":"cancelled"}))
                .into_response()
        }
        Err(e) => problem(StatusCode::CONFLICT, "recall_unconfirmed", e),
    }
}
async fn cancel(State(app): State<App>, Path(id): Path<String>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    let receipt = {
        let mut store = app.store.lock().unwrap();
        match store.get(&id) {
            Ok(None) => {
                return problem(
                    StatusCode::CONFLICT,
                    "unknown_command",
                    "Unknown command identity",
                );
            }
            Err(e) => {
                app.storage_failed();
                return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e);
            }
            Ok(Some(r)) if r.steered_to.is_some() => {
                return problem(StatusCode::CONFLICT, "queue_moved", "This queued message already belongs to live delivery");
            }
            Ok(Some(_)) => {}
        }
        match store.request_cancel(&id) {
            Ok(r) => r,
            Err(e) => {
                app.storage_failed();
                return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e);
            }
        }
    };
    if app.signal_cancelled_roots().is_err() {app.storage_failed();return problem(StatusCode::SERVICE_UNAVAILABLE,"storage","Cancellation ownership unavailable");}
    if receipt.phase.active() {
        if let Some(sender) = app.active.lock().unwrap().get(&id) {
            let _ = sender.send(true);
        } else {
            return problem(
                StatusCode::CONFLICT,
                "unknown_owner",
                "Process ownership is unavailable; inspect state before recovery",
            );
        }
    }
    app.release_settled_auth_scope();
    Json(json!({"id":id,"cancellation_requested":receipt.phase.active()})).into_response()
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Trust {
    api: u32,
    project: String,
    trusted: bool,
    binding: Option<deck2_shared::ProjectBinding>,
}
async fn trust(State(app): State<App>, Json(body): Json<Trust>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if body.api != API || app.broken.load(Ordering::SeqCst) {
        return problem(
            StatusCode::CONFLICT,
            "trust_rejected",
            "Incompatible API or unavailable store",
        );
    }
    let mut store = app.store.lock().unwrap();
    if body.trusted || body.binding.is_some() {
        let result = store.project_by_id(&crate::projects::id(&body.project)).and_then(|p| {
            if body.binding.as_ref().is_some_and(|expected| *expected != p) {
                return Err("The project folder changed. Reopen Project settings and try again.".into());
            }
            if body.trusted {
                crate::projects::validate(&p)?;
            }
            Ok(())
        });
        if let Err(e) = result {
            return problem(StatusCode::CONFLICT, "project", e);
        }
    }
    match store.set_trust(&body.project, body.trusted) {
        Ok(()) => {
            if !body.trusted {
                crate::cbm_automatic::stop(&app, &body.project);
            }
            Json(json!({"trusted":body.trusted})).into_response()
        }
        Err(e) => problem(StatusCode::CONFLICT, "trust_rejected", e),
    }
}
async fn resolve(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(value): Json<serde_json::Value>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if app.broken.load(Ordering::SeqCst) {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Persistence unavailable; release blocked",
        );
    }
    let mut store = app.store.lock().unwrap();
    match store.resolve_submission(&id, &value) {
        Ok(d) => Json(d).into_response(),
        Err(crate::decisions::ResolveError::InvalidAnswers) => (
            StatusCode::CONFLICT,
            Json(json!({"api":API,"code":"answers_not_accepted","decision_id":id,
                "command_id":value["command_id"],"expected_revision":value["expected_revision"],
                "message":"Answer each question with one nonempty answer of at most 4096 UTF-8 bytes"})),
        ).into_response(),
        Err(crate::decisions::ResolveError::TerminalRejection) => match store.reconcile_permission(&id, &value) {
            Ok(proof) => (StatusCode::CONFLICT, Json(proof)).into_response(),
            Err(e) => problem(StatusCode::CONFLICT, "decision_rejected", e),
        },
        Err(crate::decisions::ResolveError::Other(e)) => problem(StatusCode::CONFLICT, "decision_rejected", e),
        Err(crate::decisions::ResolveError::InvalidScope) => problem(StatusCode::CONFLICT, "decision_rejected", "Stale or unsupported scope selection"),
    }
}
async fn reconcile_permission(
    State(app): State<App>, Path(id): Path<String>, Json(value): Json<serde_json::Value>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    if app.broken.load(Ordering::SeqCst) {
        return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", "Persistence unavailable");
    }
    match app.store.lock().unwrap().reconcile_permission(&id, &value) {
        Ok(proof) => (StatusCode::CONFLICT, Json(proof)).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "decision_rejected", e),
    }
}
async fn cancel_child(
    State(app): State<App>,
    Path((task, attempt)): Path<(String, String)>,
    Json(c): Json<SessionAction>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if c.api != API {
        return problem(
            StatusCode::CONFLICT,
            "incompatible",
            "Reload a compatible client",
        );
    }
    let mut s = app.store.lock().unwrap();
    let mut t = match s.task(&task) {
        Ok(t) => t,
        Err(e) => return problem(StatusCode::CONFLICT, "unknown_task", e),
    };
    let Some(a) = t.attempts.iter_mut().find(|a| a.id == attempt) else {
        return problem(
            StatusCode::CONFLICT,
            "unknown_attempt",
            "Unknown exact attempt",
        );
    };
    crate::tasks::cancel_attempt(a);
    let normal=match s.get(&t.root) {Ok(Some(r))=>r.mode==deck2_shared::Mode::SessionV1,Ok(None)=>return problem(StatusCode::CONFLICT,"root_missing","Task origin missing"),Err(e)=>{app.storage_failed();return problem(StatusCode::SERVICE_UNAVAILABLE,"storage",e);}};
    let saved=if normal {s.save_normal_task(&t)}else{s.save_task(&t)};
    if let Err(e) = saved {
        app.storage_failed();
        return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e);
    }
    if normal && t.attempts.iter().any(|a|a.id==attempt && a.phase==deck2_shared::Phase::Cancelled) && s.enqueue_task_outcome(&task,&attempt).is_err() {app.storage_failed();return problem(StatusCode::SERVICE_UNAVAILABLE,"storage","Cancellation outcome unavailable");}
    drop(s);
    app.pump_queue();
    Json(t).into_response()
}
async fn create_session(State(app): State<App>, Json(c): Json<SessionCommand>) -> Response {
    create_session_command(app,c,None).await
}
pub(crate) async fn create_session_command(app: App, mut c: SessionCommand, transition: Option<(String,String)>) -> Response {
    if crate::web_identity::authorize().is_err() { return problem(StatusCode::FORBIDDEN,"device-required","Device access ended"); }
    if let Some((source, expected)) = &transition {
        let checked=(|| {
            let store=app.store.lock().map_err(|_| "State lock failed")?;
            if &store.transition_source(source)? != expected { return Err("Historical source changed; refresh before transition".to_string()); }
            let old=store.session_by_id(source)?;
            if c.project_id.as_ref().is_some_and(|id|id!=&old.project.id) { return Err("Transition project must match its historical source".into()); }
            c.project_id=Some(old.project.id);
            if c.members.is_none() || c.approvals.as_deref().is_some_and(|a|a!="relay") { return Err("Transition requires explicit canonical assignments with Ask first permissions".into()); }
            Ok(())
        })();
        if let Err(e)=checked { return problem(StatusCode::CONFLICT,"session_transition",e); }
    }
    let project_id = c.project_id.get_or_insert_with(|| crate::projects::id(&app.project));
    let root = app.store.lock().unwrap().project_by_id(project_id);
    let app=match root {Ok(p)=>{if let Err(e)=crate::projects::validate(&p){return problem(StatusCode::CONFLICT,"project",e);}App {inner:app.inner.clone(),project:p.root}},Err(e)=>return problem(StatusCode::CONFLICT,"project",e)};
    crate::cbm_automatic::used(&app);
    let selected_runners=c.members.as_ref().map(|m|m.values().map(|a|a.runner_id.clone()).collect::<Vec<_>>()).unwrap_or_default();
    let runners=selected_runners.iter().map(String::as_str).collect::<Vec<_>>();
    let selection = if c.members.is_some() {
        match crate::session_contract::selection_snapshot(&app,&app.store.lock().unwrap(),&runners) {Ok(v)=>Some(v),Err(e)=>return problem(StatusCode::CONFLICT,"session_rejected",e)}
    } else {None};
    if let Some(members) = &c.members {
        match crate::session_contract::creation_members(&app, members).await {
            Ok(members) => c.members = Some(members),
            Err(e) => return problem(StatusCode::CONFLICT, "session_rejected", e),
        }
    }

    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    let result=(|| {
        let active=app.active.lock().unwrap();
        let mut store=app.store.lock().unwrap();
        if let Some((source,_))=&transition {
            for key in active.keys() {
                if let Some(attempt)=key.strip_prefix("child:") {
                    if store.tasks()?.iter().any(|t| t.session==*source && t.attempts.iter().any(|a|a.id==attempt)) { return Err("Historical native ownership is still settling".into()); }
                } else if key==&format!("session-restart:{source}") || store.get(key)?.is_some_and(|r|r.session==*source) { return Err("Historical native ownership is still settling".into()); }
            }
        }
        if let Some(before)=selection
            && crate::session_contract::selection_snapshot(&app,&store,&runners)? != before {
            return Err("Session configuration or executable changed during discovery".into());
        }
        crate::projects::validate(&store.project_by_id(c.project_id.as_ref().unwrap())?)?;
        crate::web_identity::admit().map_err(str::to_owned)?;
        if let Some((source,expected))=&transition { store.create_transition(&c,source,expected) } else { store.create_session(&c) }
    })();
    match result {
        Ok(s) => Json(s).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "session_rejected", e),
    }
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RegisterProject {
    api: u32,
    root: String,
    #[serde(default)]
    trusted: bool,
}
async fn register_project(State(app): State<App>, Json(c): Json<RegisterProject>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    if c.api != API || app.broken.load(Ordering::SeqCst) {
        return problem(
            StatusCode::CONFLICT,
            "project_rejected",
            "Incompatible API or unavailable persistence",
        );
    }
    let result = (|| -> Result<_, String> {
        let mut store = app.store.lock().unwrap();
        let home = std::env::var_os("HOME").unwrap_or_default();
        let input = crate::directories::expand(&c.root, std::path::Path::new(&home));
        if !input.is_absolute() { return Err("Enter an absolute project directory".into()); }
        let root = input.canonicalize().map_err(|_| "Project directory is unavailable")?;
        let root = root.to_str().ok_or("Project path must be UTF-8")?;
        let previous = store.project_by_id(&crate::projects::id(root)).ok();
        let p = store.select_project_folder_with_trust(root, c.trusted)?;
        if previous.is_some_and(|old| old != p) {
            crate::cbm_automatic::stop(&app, root);
        }
        // Only an explicit Add restores navigation; startup adoption never does.
        let mut n = store.navigation()?;
        if let Some(entry) = n.projects.get_mut(&p.id) {
            entry.hidden = false;
            store.save_navigation(&n)?;
        }
        Ok(p)
    })();
    match result {
        Ok(p) => {
            if c.trusted {
                crate::cbm_automatic::used(&App {
                    inner: app.inner.clone(),
                    project: p.root.clone(),
                });
            }
            Json(p).into_response()
        }
        Err(e) => problem(StatusCode::CONFLICT, "project_rejected", e),
    }
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoryNavigationAction {
    api: u32,
    title: Option<String>,
}
async fn history_navigation_action(
    State(app): State<App>,
    Path((project, id, action)): Path<(String, String, String)>,
    Json(c): Json<HistoryNavigationAction>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    // Same lock order as history activation/workspace. No original writer is opened.
    let history = app.history.lock().unwrap();
    let mut store = app.store.lock().unwrap();
    let result = (|| -> Result<_, String> {
        if c.api != API || app.broken.load(Ordering::SeqCst) {
            return Err("Incompatible API or unavailable persistence".into());
        }
        if history.navigation_project(&id)? != project {
            return Err("Session does not belong to this project".into());
        }
        let local = store.session_by_id(&id).ok();
        if let Some(local) = &local {
            history.navigation_identity(local)?;
        }
        let key = history.navigation_key(&project, &id)?;
        let mut n = store.navigation()?;
        match action.as_str() {
            "rename" => {
                let title = crate::sidebar::title(c.title.as_deref().unwrap_or(""))?;
                if local.is_some() {
                    store.rename_navigation_session(&id, &title)?;
                }
                n.sessions.entry(key).or_default().title = Some(title);
            }
            "remove" => {
                if local.is_some() {
                    store.navigation_settled(std::slice::from_ref(&id))?;
                }
                n.sessions.entry(key).or_default().hidden = true;
            }
            _ => return Err("Unknown session operation".into()),
        }
        store.save_navigation(&n)?;
        Ok(n)
    })();
    match result {
        Ok(n) => Json(n).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "session_rejected", e),
    }
}
async fn sidebar_navigation(State(app): State<App>) -> Response {
    let history = app.history.lock().unwrap();
    let store = app.store.lock().unwrap();
    let result = (|| -> Result<serde_json::Value, String> {
        let mut n =
            serde_json::to_value(store.navigation()?).map_err(|_| "Navigation unavailable")?;
        let mut counts = std::collections::BTreeMap::new();
        let mut adopted_order_keys = std::collections::BTreeMap::new();
        for session in store.sessions()? {
            if let Some(key) = history.adopted_navigation_key(&session) {
                adopted_order_keys.insert(session.id.clone(), key);
            }
            let list = crate::session_decisions::list(&store, &session.id)?;
            let count = list["decisions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|d| matches!(d["state"].as_str(), Some("pending" | "deferred")))
                .count();
            counts.insert(session.id, count);
        }
        n["decisions"] = json!(counts);
        n["adopted_order_keys"] = json!(adopted_order_keys);
        Ok(n)
    })();
    match result {
        Ok(n) => Json(n).into_response(),
        Err(e) => problem(StatusCode::SERVICE_UNAVAILABLE, "navigation_unavailable", e),
    }
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SidebarOrder {
    api: u32,
    project: Option<String>,
    keys: Vec<String>,
}
async fn reorder_sidebar(State(app): State<App>, Json(c): Json<SidebarOrder>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    let history = app.history.lock().unwrap();
    let store = app.store.lock().unwrap();
    let result = (|| -> Result<_, String> {
        if c.api != API || app.broken.load(Ordering::SeqCst) {
            return Err("Incompatible API or unavailable persistence".into());
        }
        let unique: std::collections::BTreeSet<_> = c.keys.iter().collect();
        if unique.len() != c.keys.len() || unique.is_empty() {
            return Err("Expected distinct navigation items".into());
        }
        let mut navigation = store.navigation()?;
        let order = if let Some(project) = c.project {
            let workspace_keys: std::collections::BTreeSet<_> = store
                .sessions()?
                .into_iter()
                .filter(|s| s.project.id == project)
                .map(|s| {
                    history
                        .adopted_navigation_key(&s)
                        .unwrap_or_else(|| json!(["local", project, s.id]).to_string())
                })
                .collect();
            for key in &c.keys {
                if workspace_keys.contains(key) {
                    continue;
                }
                let parts: Vec<String> = serde_json::from_str(key)
                    .map_err(|_| "Invalid session order key")?;
                let valid = match parts.as_slice() {
                    [kind, _, owner, id] if kind == "history" && owner == &project => {
                        *key == history.navigation_key(&project, id)?
                            && history.navigation_project(id)? == project
                    }
                    _ => false,
                };
                if !valid {
                    return Err("Session does not belong to this project and source".into());
                }
            }
            navigation.session_order.entry(project).or_default()
        } else {
            let projects = navigation_project_ids(&store, &history)?;
            if c.keys.iter().any(|id| !projects.contains(id)) {
                return Err("Unknown project".into());
            }
            &mut navigation.project_order
        };
        crate::sidebar::merge_order(order, c.keys);
        navigation.order_revision = navigation.order_revision.saturating_add(1);
        store.save_navigation(&navigation)?;
        Ok(navigation)
    })();
    match result {
        Ok(navigation) => Json(navigation).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "order_rejected", e),
    }
}

fn navigation_project_ids(
    store: &crate::Store,
    history: &crate::history::Reader,
) -> Result<std::collections::BTreeSet<String>, String> {
    let mut ids: std::collections::BTreeSet<_> =
        store.projects()?.into_iter().map(|p| p.id).collect();
    if let Ok(catalog) = history.catalog() {
        for project in catalog["projects"].as_array().into_iter().flatten() {
            if let Some(id) = project["projectId"].as_str() {
                ids.insert(id.to_owned());
            }
        }
    }
    Ok(ids)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectNavigationAction {
    api: u32,
    title: Option<String>,
}
async fn project_navigation_action(
    State(app): State<App>,
    Path((id, action)): Path<(String, String)>,
    Json(c): Json<ProjectNavigationAction>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    let history = app.history.lock().unwrap();
    let store = app.store.lock().unwrap();
    let result = (|| -> Result<_, String> {
        if c.api != API || app.broken.load(Ordering::SeqCst) {
            return Err("Incompatible API or unavailable persistence".into());
        }
        let project_ids = navigation_project_ids(&store, &history)?;
        if !project_ids.contains(&id) {
            return Err("Unknown project".into());
        }
        let mut n = store.navigation()?;
        match action.as_str() {
            "rename" => {
                n.projects.entry(id.clone()).or_default().title =
                    Some(crate::sidebar::title(c.title.as_deref().unwrap_or(""))?)
            }
            "remove" => {
                let ids = store
                    .sessions()?
                    .into_iter()
                    .filter(|s| s.project.id == id)
                    .map(|s| s.id)
                    .collect::<Vec<_>>();
                store.navigation_settled(&ids)?;
                if project_ids
                    .iter()
                    .filter(|p| *p != &id && !n.projects.get(*p).is_some_and(|v| v.hidden))
                    .count()
                    == 0
                {
                    return Err(
                        "Keep at least one project; add another before removing this one".into(),
                    );
                }
                if let Ok(p)=store.project_by_id(&id){crate::cbm_automatic::stop(&app,&p.root);}
                n.projects.entry(id).or_default().hidden = true;
            }
            _ => return Err("Unknown project operation".into()),
        }
        store.save_navigation(&n)?;
        Ok(n)
    })();
    match result {
        Ok(n) => Json(n).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "project_rejected", e),
    }
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct QueueControl {
    api: u32,
    paused: bool,
}
async fn queue_control(State(app): State<App>, Json(c): Json<QueueControl>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if c.api != API || app.broken.load(Ordering::SeqCst) {
        return problem(
            StatusCode::CONFLICT,
            "queue_rejected",
            "Incompatible API or unavailable persistence",
        );
    }
    if let Err(e) = app.store.lock().unwrap().pause_queue(c.paused) {
        return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e);
    }
    app.pump_queue();
    Json(json!({"paused":app.store.lock().unwrap().queue_paused().unwrap_or(true)})).into_response()
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionAction {
    api: u32,
}
async fn release_session(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(c): Json<SessionAction>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if c.api != API {
        return problem(StatusCode::CONFLICT, "session_rejected", "Incompatible API");
    }
    if let Err(e)=app.retire_native_session(&id).await {return problem(StatusCode::CONFLICT,"session_rejected",e);}
    match app.store.lock().unwrap().release_session(&id) {
        Ok(s) => Json(s).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "session_rejected", e),
    }
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RenameSession {
    api: u32,
    title: String,
}
async fn rename_session(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(c): Json<RenameSession>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    let title = match crate::sidebar::title(&c.title) {
        Ok(v) => v,
        Err(e) => return problem(StatusCode::CONFLICT, "session_rejected", e),
    };
    if c.api != API || title.is_empty() || title.len() > 160 {
        return problem(
            StatusCode::CONFLICT,
            "session_rejected",
            "Invalid title or incompatible API",
        );
    }
    let mut store = app.store.lock().unwrap();
    let result = (|| {
        let mut session = store.session_by_id(&id)?;
        session.title = title.clone();
        store.save_session(&session)?;
        Ok::<_, String>(session)
    })();
    match result {
        Ok(s) => Json(s).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "session_rejected", e),
    }
}
async fn remove_session(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(c): Json<SessionAction>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if c.api != API {
        return problem(StatusCode::CONFLICT, "session_rejected", "Incompatible API");
    }
    match remove_local_session(&app, &id).await {
        Ok(()) => Json(json!({"removed":id})).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "session_rejected", e),
    }
}

async fn remove_local_session(app: &App, id: &str) -> Result<(), String> {
    // Keep an older removal request from deleting a newly created session
    // with the same ID. Input admission still proceeds during native shutdown.
    if !app.session_removals.lock().unwrap().insert(id.to_owned()) {
        return Err("Removal is already in progress for this session.".into());
    }
    struct Removal<'a>(&'a App, &'a str);
    impl Drop for Removal<'_> {
        fn drop(&mut self) {
            self.0.session_removals.lock().unwrap().remove(self.1);
        }
    }
    let _removal = Removal(app, id);
    let restart = format!("session-restart:{id}");
    let ensure_idle = |active: &HashMap<String, watch::Sender<bool>>,
                       preview: &crate::sessions::RemovalPreview| {
        if active
            .keys()
            .any(|key| key == &restart || preview.owns_worker(key))
        {
            return Err(
                "Wait for this session's native process to settle before removing local history."
                    .into(),
            );
        }
        app.native_removal_ready(id)
    };
    let preview = || {
        let active = app.active.lock().unwrap();
        let store = app.store.lock().unwrap();
        let preview = store.removal_preview(id)?;
        ensure_idle(&active, &preview)?;
        Ok::<_, String>(preview)
    };
    let before = preview()?;
    app.retire_native_session_checked(id, || before.ensure_unchanged(&preview()?))
        .await?;

    // Hold the same locks as admission for the final worker and durable checks.
    let active = app.active.lock().unwrap();
    let mut store = app.store.lock().unwrap();
    ensure_idle(&active, &before)?;
    store.remove_session_checked(id, Some(&before))
}

async fn configuration(ProjectState(app): ProjectState<App>) -> Response {
    let s = app.store.lock().unwrap();
    let result = (|| -> Result<serde_json::Value, String> {
        let c = s.configuration_for(&app.project)?;
        let definitions = c
            .definitions
            .iter()
            .map(|id| {
                let mut d =
                    serde_json::to_value(s.definition(id)?).map_err(|_| "Cannot encode content")?;
                d.as_object_mut().unwrap().remove("body");
                Ok(d)
            })
            .collect::<Result<Vec<_>, String>>()?;
        let prepared = app.team.lock().unwrap();
        let team = prepared.as_ref().filter(|r| r.matches_project(&app.project));
        Ok(
            json!({"api":API,"selected":c,"definitions":definitions,"observed":team.map(|r|json!({"assignment":crate::configuration::assignment_from_runner(r),"preparation_ms":r.preparation_ms,"tool_connection_ms":r.tool_connection_ms,"provenance":r.provenance})),"unavailable":if team.is_none(){Some(app.team_unavailable.lock().unwrap().clone())}else{None},"limitations":["External skill discovery is disabled; managed policies are not standalone loaded skills.","Hidden provider/native prompts and model compliance are not observable.","The full role/skill catalog, arbitrary helper platforms and arbitrary runner/model selection remain unavailable."]}),
        )
    })();
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "configuration_unavailable",
            e,
        ),
    }
}
async fn content(State(app): State<App>, Path(id): Path<String>) -> Response {
    match app.store.lock().unwrap().definition(&id) {
        Ok(d) => Json(d).into_response(),
        Err(e) => problem(StatusCode::NOT_FOUND, "content_unavailable", e),
    }
}
async fn plan_configuration(
    ProjectState(app): ProjectState<App>,
    Json(r): Json<crate::configuration::PlanRequest>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if !app.persistence_available() {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Management blocked by unavailable persistence",
        );
    }
    let mut s = app.store.lock().unwrap();
    match s.plan_configuration_for(&app.project,&r, &app.qualification()) {
        Ok(p) => Json(p).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "plan_rejected", e),
    }
}
async fn apply_configuration(
    ProjectState(app): ProjectState<App>,
    Path(id): Path<String>,
    Json(r): Json<crate::configuration::ApplyRequest>,
) -> Response {
    if !app.persistence_available() {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Management blocked by unavailable persistence",
        );
    }
    let helper = app
        .store
        .lock()
        .unwrap()
        .helper_plan(&id)
        .is_ok_and(|p| p.helper.is_some());
    if helper {
        let root = match app.artifact_root() {
            Ok(p) => p,
            Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "helper_store", e),
        };
        let a =
            match tokio::task::spawn_blocking(move || crate::managed_tools::Artifacts::open(&root))
                .await
            {
                Ok(Ok(a)) => a,
                Ok(Err(e)) => return problem(StatusCode::CONFLICT, "helper_store", e),
                Err(_) => {
                    return problem(
                        StatusCode::CONFLICT,
                        "helper_store",
                        "Artifact inspection interrupted",
                    );
                }
            };
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
        let result = app
            .store
            .lock()
            .unwrap()
            .accept_helper(&id, &r, &a.identity);
        return match result {
            Ok(o) => {
                if !crate::managed_tools::terminal(&o.phase) {
                    tokio::spawn(crate::managed_tools::run_operation(
                        app.clone(),
                        o.id.clone(),
                    ));
                }
                Json(o).into_response()
            }
            Err(e) => {
                let s = app.store.lock().unwrap();
                if s.operation_not_recorded(&r.operation_id) {
                    (StatusCode::CONFLICT,Json(json!({"api":API,"code":"management_not_applied","plan":id,"operation_id":r.operation_id,"message":e}))).into_response()
                } else {
                    problem(StatusCode::CONFLICT, "management_rejected", e)
                }
            }
        };
    }
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    let mut s = app.store.lock().unwrap();
    match s.apply_configuration(&id, &r, &app.qualification()) {
        Ok(o) => Json(o).into_response(),
        Err(e) if s.operation_not_recorded(&r.operation_id) => (StatusCode::CONFLICT,Json(json!({"api":API,"code":"management_not_applied","plan":id,"operation_id":r.operation_id,"message":e}))).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "management_rejected", e),
    }
}
async fn discard_configuration(ProjectState(app): ProjectState<App>, Path(id): Path<String>, Json(r): Json<crate::configuration::ApplyRequest>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    if !app.persistence_available() { return problem(StatusCode::SERVICE_UNAVAILABLE,"storage","Cannot safely discard while storage is unavailable"); }
    let result = app.store.lock().unwrap().discard_configuration(&app.project,&id,&r);
    match result {
        Ok(o) => {
            if !crate::managed_tools::terminal(&o.phase) { tokio::spawn(crate::managed_tools::run_operation(app.clone(),o.id.clone())); }
            if o.phase == "cancelled" && !o.published {
                return (StatusCode::CONFLICT,Json(json!({"api":API,"code":"management_not_applied","plan":id,"operation_id":r.operation_id,"message":"Change discarded before activation"}))).into_response();
            }
            Json(o).into_response()
        },
        Err(e) => {
            let s = app.store.lock().unwrap();
            // A different immutable decision for this plan fences this absent
            // identity too. Storage errors or an uncertain identity prove nothing.
            let not_applied = s.operation_not_recorded(&r.operation_id)
                && s.helper_plan(&id).is_ok_and(|p| p.before.project == app.project && s.host_id().is_ok_and(|host| p.before.host_id == host))
                && s.conn.query_row("SELECT EXISTS(SELECT 1 FROM management_operations WHERE plan=?1)",[&id],|row|row.get::<_,bool>(0)).is_ok_and(|exists|exists);
            if not_applied {
                (StatusCode::CONFLICT,Json(json!({"api":API,"code":"management_not_applied","plan":id,"operation_id":r.operation_id,"message":"This change was not admitted; the review already has a decision"}))).into_response()
            } else { problem(StatusCode::CONFLICT,"management_rejected",e) }
        }
    }
}
async fn operation(ProjectState(app): ProjectState<App>, Path(id): Path<String>) -> Response {
    match app.store.lock().unwrap().operation(&id) {
        Ok(o) => Json(o).into_response(),
        Err(e) => problem(StatusCode::NOT_FOUND, "operation_unavailable", e),
    }
}

async fn helper_catalog(ProjectState(app): ProjectState<App>) -> Response {
    let root = match app.artifact_root() {
        Ok(p) => p,
        Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "helper_store", e),
    };
    let status=tokio::task::spawn_blocking(move||{
        if std::fs::symlink_metadata(&root).is_err_and(|e|e.kind()==std::io::ErrorKind::NotFound){
            let releases=["0.50.0","1.2.0"].into_iter().map(|v|crate::managed_tools::release(v).map(|r|json!({"installed":false,"issue":null,"release":r}))).collect::<Result<Vec<_>,String>>()?;
            return Ok(json!({"api":API,"store":"not initialized; review installation to create the private owned store","catalog":crate::managed_tools::catalog_digest(),"releases":releases}));
        }
        let a=crate::managed_tools::Artifacts::open(&root)?;
        let releases=["0.50.0","1.2.0"].into_iter().map(|v|{
            let r=crate::managed_tools::release(v)?;
            {let (installed,issue)=a.status(&r.selection);Ok(json!({"installed":installed,"issue":issue,"release":r}))}
        }).collect::<Result<Vec<_>,String>>()?;
        Ok::<_,String>(json!({"api":API,"store":a.identity,"catalog":crate::managed_tools::catalog_digest(),"releases":releases}))
    }).await;
    match status {
        Ok(Ok(v)) => Json(v).into_response(),
        Ok(Err(e)) => problem(StatusCode::SERVICE_UNAVAILABLE, "helper_store", e),
        Err(_) => problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "helper_store",
            "Artifact inspection interrupted",
        ),
    }
}
async fn helper_plan(
    ProjectState(app): ProjectState<App>,
    Json(r): Json<crate::managed_tools::ReviewRequest>,
) -> Response {
    if !app.persistence_available() {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Management persistence unavailable",
        );
    }
    let root = match app.artifact_root() {
        Ok(p) => p,
        Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "helper_store", e),
    };
    let a = match tokio::task::spawn_blocking(move || crate::managed_tools::Artifacts::open(&root))
        .await
    {
        Ok(Ok(a)) => a,
        Ok(Err(e)) => return problem(StatusCode::CONFLICT, "helper_store", e),
        Err(_) => {
            return problem(
                StatusCode::CONFLICT,
                "helper_store",
                "Artifact inspection interrupted",
            );
        }
    };
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    match app.store.lock().unwrap().plan_helper_for(&app.project,&r, &a.identity) {
        Ok(p) => Json(p).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "plan_rejected", e),
    }
}
async fn helper_cancel(ProjectState(app): ProjectState<App>, Path(id): Path<String>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    let result = app.store.lock().unwrap().cancel_helper(&id);
    match result {
        Ok(o) => {
            if !crate::managed_tools::terminal(&o.phase) {
                tokio::spawn(crate::managed_tools::run_operation(
                    app.clone(),
                    o.id.clone(),
                ));
            }
            Json(o).into_response()
        }
        Err(e) => problem(StatusCode::CONFLICT, "operation_rejected", e),
    }
}
async fn root_snapshots(State(app): State<App>, Path(id): Path<String>) -> Response {
    match app.store.lock().unwrap().root_snapshots(&id) {
        Ok(s) => Json(json!({"snapshots":s})).into_response(),
        Err(e) => problem(StatusCode::SERVICE_UNAVAILABLE, "snapshots_unavailable", e),
    }
}
async fn snapshot(State(app): State<App>, Path(id): Path<String>) -> Response {
    match app.store.lock().unwrap().read_snapshot(&id, None) {
        Ok(s) => Json(s).into_response(),
        Err(e) => problem(StatusCode::NOT_FOUND, "snapshot_unavailable", e),
    }
}

static ASSETS: include_dir::Dir =
    include_dir::include_dir!("$CARGO_MANIFEST_DIR/../../dist/assets");
async fn asset(req: Request) -> Response {
    let path = if req.uri().path() == "/" {
        "index.html"
    } else {
        req.uri().path().trim_start_matches('/')
    };
    match ASSETS.get_file(path) {
        Some(file) => {
            let mut res = Response::new(Body::from(file.contents()));
            res.headers_mut().insert(
                header::CONTENT_TYPE,
                mime_guess::from_path(path)
                    .first_or_octet_stream()
                    .as_ref()
                    .parse()
                    .unwrap(),
            );
            if path == "manifest.webmanifest" {res.headers_mut().insert(header::CONTENT_TYPE,"application/manifest+json".parse().unwrap());}
            if path == "service-worker.js" {res.headers_mut().insert("service-worker-allowed","/".parse().unwrap());}
            res
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
pub fn router(app: App) -> Router {
    crate::cbm_automatic::resume(&app);
    Router::new()
        .merge(crate::runner_management::routes())
        .merge(crate::ordinary::routes())
        .merge(crate::history::routes())
        .merge(crate::web_push::routes())
        .merge(crate::session_contract::routes())
        .route("/api/local-access", post(crate::web_identity::local_access))
        .route("/api/browser-device", get(crate::web_identity::browser_device_status).post(crate::web_identity::change_browser_device).layer(DefaultBodyLimit::max(1024)))
        .route("/pair", post(crate::web_identity::pair))
        .route("/web-control", post(crate::web_identity::control))
        .route("/launch", post(launch))
        .route("/auth", post(auth))
        .route("/api/application/restart", get(crate::application::status).post(crate::application::restart))
        .route("/api/health", get(|| async {
            ([(header::CACHE_CONTROL, "no-store")], Json(json!({"api": API})))
        }))
        .route("/api/workspace", get(workspace))
        .route("/api/workspace/events", get(crate::workspace_events::events))
.route("/api/sessions/{session}/activity", get(crate::activity::page))
.route("/api/sessions/{session}/activity/{seq}/output", get(crate::activity::output))
        .route("/api/dictation", get(crate::dictation::summary))
        .route(
            "/api/dictation/settings",
            axum::routing::put(crate::dictation::settings).layer(DefaultBodyLimit::max(4096)),
        )
        .route(
            "/api/dictation/transcriptions",
            post(crate::dictation::transcribe).layer(DefaultBodyLimit::max(10 * 1024 * 1024)),
        )
        .route(
            "/api/dictation/models/{id}/download",
            post(crate::dictation::download).delete(crate::dictation::cancel_download),
        )
        .route(
            "/api/dictation/models/{id}",
            axum::routing::delete(crate::dictation::delete),
        )
        .route("/api/quota", get(crate::quota::read))
        .route(
            "/api/sessions/{session}/tasks/{task}/attempts/{attempt}/transcript",
            get(crate::observations::transcript),
        )
        .route("/api/sessions/{session}/tasks/{task}/attempts/{attempt}/dismiss-failure", post(crate::task_panel::dismiss))
        .route("/api/sessions/{session}/tasks/{task}/attempts/{attempt}/exchanges", get(crate::task_panel::exchanges))
        .route("/api/quota/{runner}/refresh", post(crate::quota::refresh))
        .route(
            "/api/sessions/{session}/git",
            get(crate::git_review::catalog),
        )
        .route(
            "/api/sessions/{session}/git/{revision}/{file}",
            get(crate::git_review::diff),
        )
        .route("/api/changes", get(changes).post(create_change))
        .route("/api/tools", get(crate::external_tools::inspect))
        .route("/api/tools/{tool}", post(crate::external_tools::change))
        .route("/api/tools/rtk/runners/{runner}", post(crate::external_tools::runners::change))
        .route("/api/tools/context-mode", get(crate::external_tools::context_mode::inspect))
        .route("/api/tools/context-mode/runners/{runner}", get(crate::external_tools::context_mode::inspect_selected).post(crate::external_tools::context_mode::change))
        .route("/api/configuration", get(configuration))
        .route("/api/helpers", get(helper_catalog))
        .route("/api/helpers/plans", post(helper_plan))
        .route("/api/helpers/operations/{id}/cancel", post(helper_cancel))
        .route("/api/snapshots/{id}", get(snapshot))
        .route("/api/commands/{id}/snapshots", get(root_snapshots))
        .route("/api/content/{id}", get(content))
        .route("/api/cbm", get(crate::cbm_management::inspect))
        .route("/api/cbm/automatic", get(crate::cbm_automatic::inspect).post(crate::cbm_automatic::ensure))
        .route("/api/cbm/plans", post(crate::cbm_management::plan))
        .route(
            "/api/cbm/plans/{id}/apply",
            post(crate::cbm_management::apply),
        )
        .route(
            "/api/cbm/operations/{id}",
            get(crate::cbm_management::operation),
        )
        .route("/api/configuration/plans", post(plan_configuration))
        .route("/api/configuration/plans/{id}/discard", post(discard_configuration))
        .route(
            "/api/configuration/plans/{id}/apply",
            post(apply_configuration),
        )
        .route("/api/operations/{id}", get(operation))
        .route(
            "/api/tasks/{task}/attempts/{attempt}/cancel",
            post(cancel_child),
        )
        .route(
            "/api/sessions/{session}/uploads/{upload}",
            get(upload_status)
                .delete(cancel_upload)
                .post(upload_image)
                .layer(DefaultBodyLimit::max(crate::images::MAX_IMAGE)),
        )
        .route(
            "/api/sessions/{session}/images/{image}",
            get(read_image).delete(remove_image),
        )
        .route("/api/commands", post(browser_submit))
        .route("/api/sidebar", get(sidebar_navigation))
        .route("/api/sidebar/order", post(reorder_sidebar))
        .route(
            "/api/sidebar/projects/{project}/sessions/{id}/{action}",
            post(history_navigation_action),
        )
        .route(
            "/api/projects/{id}/{action}",
            post(project_navigation_action),
        )
        .route("/api/directories", get(crate::directories::suggestions))
        .route("/api/projects", post(register_project))
        .route("/api/sessions", post(create_session))
        .route("/api/sessions/{id}/release", post(release_session))
        .merge(crate::session_epoch::routes())
        .merge(crate::session_transition::routes())
        .route("/api/sessions/{id}/remove", post(remove_session))
        .route("/api/sessions/{id}/rename", post(rename_session))
        .route("/api/queue", post(queue_control))
        .route("/api/project/trust", post(trust))
        .route("/api/decisions/{id}/responses", post(resolve))
        .route("/api/decisions/{id}/responses/reconcile", post(reconcile_permission))
        .route("/api/commands/{id}/cancel", post(cancel))
        .route("/api/commands/{id}/steering", post(crate::steering::submit))
        .route("/api/commands/{id}/steering/queued", post(crate::steering::submit_queued))
        .route("/api/commands/{root}/steering/{id}/resend", post(crate::steering::resend_queued))
        .route("/api/commands/{id}/recall", post(recall_input))
        .route(
            "/api/sessions/{session}/git-identity",
            get(crate::git_review::identity),
        )
        .fallback(asset)
        .layer(DefaultBodyLimit::max(6 * 16384 + 1024))
        .layer(middleware::from_fn_with_state(app.clone(), boundary))
        .with_state(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;
    fn scope_fixture() -> (tempfile::TempDir, App) {
        let d = tempfile::tempdir().unwrap();
        let app = App::new(
            Store::open_memory(d.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:1234".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        *app.scope_root.lock().unwrap() = Some(d.path().join("scopes"));
        (d, app)
    }

    #[tokio::test]
    async fn workspace_stream_authorizes_and_replays_commit_between_bootstrap_and_subscribe() {
        use http_body_util::BodyExt;
        let dir = tempfile::tempdir().unwrap();
        let store =
            Store::open(&dir.path().join("state.db"), dir.path().to_str().unwrap()).unwrap();
        let app = App::new(
            store,
            "127.0.0.1:1234".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let router = router(app.clone());
        let get = |path: &str, authenticated| {
            let mut req = axum::http::Request::builder()
                .uri(path)
                .header("host", &app.host);
            if authenticated {
                req = req.header("cookie", format!("{}={}", app.cookie_name, app.cookie));
            }
            req.body(Body::empty()).unwrap()
        };
        let denied = router
            .clone()
            .oneshot(get("/api/workspace/events", false))
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        let bootstrap = router
            .clone()
            .oneshot(get("/api/workspace?transport=events", true))
            .await
            .unwrap();
        assert_eq!(bootstrap.status(), StatusCode::OK);
        let cursor = bootstrap.headers()["x-deck-workspace-cursor"]
            .to_str()
            .unwrap()
            .to_owned();
        let initial: serde_json::Value =
            serde_json::from_slice(&bootstrap.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(initial["queue_paused"], true);
        let change = sidebar_call(
            &app,
            "/api/queue",
            json!({"api": API, "paused": false}),
            true,
            true,
        )
        .await;
        assert_eq!(change.status(), StatusCode::OK);
        let path = format!("/api/workspace/events?after={cursor}");
        for _ in 0..2 {
            let response = router.clone().oneshot(get(&path, true)).await.unwrap();
            assert_eq!(
                response.headers()[header::CONTENT_TYPE],
                "text/event-stream"
            );
            let mut body = response.into_body();
            assert_eq!(
                body.frame().await.unwrap().unwrap().into_data().unwrap(),
                ": ready\n\n"
            );
            let frame = tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    let frame = body.frame().await.unwrap().unwrap().into_data().unwrap();
                    if !frame.starts_with(b"event: heartbeat") {
                        break frame;
                    }
                }
            })
            .await
            .unwrap();
            let frame = std::str::from_utf8(&frame).unwrap();
            assert!(frame.contains("event: delta"));
            let payload: serde_json::Value = serde_json::from_str(
                frame
                    .lines()
                    .find_map(|line| line.strip_prefix("data: "))
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(payload["fields"]["queue_paused"], false);
            assert_eq!(payload["collections"], json!({}));
        }
        // Publish enough committed revisions to evict the original cursor.
        for revision in 0..33 {
            let response = sidebar_call(
                &app,
                "/api/queue",
                json!({"api": API, "paused": revision % 2 == 0}),
                true,
                true,
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            let snapshot = router
                .clone()
                .oneshot(get("/api/workspace?transport=events", true))
                .await
                .unwrap();
            assert_eq!(snapshot.status(), StatusCode::OK);
        }
        let lagged = router.clone().oneshot(get(&path, true)).await.unwrap();
        let frames = lagged.into_body().collect().await.unwrap().to_bytes();
        assert!(
            std::str::from_utf8(&frames)
                .unwrap()
                .contains("event: resync")
        );
        let foreign_epoch = router
            .oneshot(get("/api/workspace/events?after=old:0", true))
            .await
            .unwrap();
        let frames = foreign_epoch
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        assert!(
            std::str::from_utf8(&frames)
                .unwrap()
                .contains("event: resync")
        );
    }

    async fn sidebar_call(
        app: &App,
        path: &str,
        body: serde_json::Value,
        auth: bool,
        origin: bool,
    ) -> Response {
        let mut r = axum::http::Request::builder()
            .method("POST")
            .uri(path)
            .header("host", &app.host)
            .header("content-type", "application/json");
        if auth {
            r = r.header("cookie", format!("{}={}", app.cookie_name, app.cookie));
        }
        if origin {
            r = r.header("origin", format!("http://{}", app.host));
        }
        router(app.clone())
            .oneshot(r.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap()
    }

    // Protects send-latency attribution: a send delayed by a workspace
    // projection must name it, with waits that fit inside the observed span.
    // Oracle: the holder's known hold time; fails if the blocker is untagged.
    #[tokio::test]
    async fn send_behind_a_workspace_projection_reports_the_projection() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("state.db"), dir.path().to_str().unwrap()).unwrap();
        let session = store.session.clone();
        let app = App::new(store, "127.0.0.1:1234".into(), "/missing".into(), None, "admin".into(), "recover".into());
        // Build the router before contention: production builds it once at startup.
        let routed = router(app.clone());
        let post = |id: &str| {
            let body = json!({"api":API,"session":session,"id":id,"prompt":"p","queue":true,"fresh":false});
            axum::http::Request::builder().method("POST").uri("/api/commands")
                .header("host", &app.host).header("content-type", "application/json")
                .header("cookie", format!("{}={}", app.cookie_name, app.cookie))
                .header("origin", format!("http://{}", app.host))
                .body(Body::from(body.to_string())).unwrap()
        };
        let (held_tx, held_rx) = std::sync::mpsc::channel();
        let holder = {
            let app = app.clone();
            std::thread::spawn(move || {
                let mut trace = crate::latency::Trace::new("workspace");
                let active = trace.lock(&app.active, crate::latency::Lock::Active);
                let history = trace.lock(&app.history, crate::latency::Lock::History);
                let store = trace.lock(&app.store, crate::latency::Lock::Store);
                held_tx.send(()).unwrap();
                std::thread::sleep(std::time::Duration::from_millis(150));
                trace.release();
                drop((store, history, active));
            })
        };
        held_rx.recv().unwrap();
        let blocked = routed.clone().oneshot(post("behind-projection")).await.unwrap();
        holder.join().unwrap();
        assert_eq!(blocked.status(), StatusCode::OK);
        let timing = blocked.headers()["server-timing"].to_str().unwrap().to_owned();
        let part = |name: &str| -> f64 {
            timing.split(", ").find_map(|p| p.strip_prefix(name)?.strip_prefix(";dur=")?.split(';').next()?.parse().ok())
                .unwrap_or_else(|| panic!("{name} missing in {timing}"))
        };
        assert!(timing.contains("deck_lock_blocker") && timing.contains("desc=\"workspace\""), "{timing}");
        assert!(part("deck_lock_blocker") >= 100.0, "{timing}");
        // The first lock the sender needs is the one being held.
        assert!(part("deck_lock_pre") + part("deck_lock_active") >= 100.0, "{timing}");
        assert!(part("deck_lock_pre") + part("deck_lock_active") + part("deck_lock_history") + part("deck_lock_store")
            <= part("deck_receipt"), "waits exceed the handler wall time: {timing}");
        let kept = crate::latency::take_submit("behind-projection").expect("submit waits retained for dispatch");
        assert_eq!(kept.blocker, "workspace");
        // A send after release is uncontended and says so.
        let idle = routed.clone().oneshot(post("after-release")).await.unwrap();
        assert_eq!(idle.status(), StatusCode::OK);
        let idle_timing = idle.headers()["server-timing"].to_str().unwrap().to_owned();
        assert!(idle_timing.contains("desc=\"none\""), "{idle_timing}");
        assert_eq!(crate::latency::ORDER_VIOLATIONS.load(std::sync::atomic::Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn remove_settled_local_session_with_task_history() {
        use deck2_shared::Phase;
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_str().unwrap();
        let path = dir.path().join("state.db");
        let project_file = dir.path().join("project.txt");
        let native_transcript = dir.path().join("native-transcript.jsonl");
        std::fs::write(&project_file, "Project contents").unwrap();
        std::fs::write(&native_transcript, "Native history").unwrap();
        let mut store = Store::open(&path, project).unwrap();
        let keep = store.session.clone();
        let session = "removal-fixture";
        store.register_codex("a".repeat(64)).unwrap();
        store
            .create_session(
                &serde_json::from_value(json!({
                    "api": API, "id": session, "title": "Disposable history",
                    "members": {"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"},
                                 "investigate":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}
                }))
                .unwrap(),
            )
            .unwrap();
        let mut root = store
            .admit(
                &serde_json::from_value(json!({
                    "api": API, "id": "removal-root", "session": session,
                    "prompt": "Coordinate the task", "mode": "session_v1"
                }))
                .unwrap(),
            )
            .unwrap();
        root.phase = Phase::Running;
        root.generation = "fixture-generation".into();
        root.dispatch_ms = Some(crate::now());
        root.thread = Some("fixture-thread".into());
        root.turn = Some("fixture-turn".into());
        store.save(&mut root).unwrap();
        let task = crate::session_tasks::tool(
            &mut store,
            &root.id,
            "deck_delegate",
            &json!({"agent":"investigate","task":"Inspect the project"}),
            "fixture-delegation",
        )
        .unwrap();
        let decision = crate::session_decisions::tool(
            &mut store,
            &root.id,
            "deck_decision_open",
            &json!({"commandId":"removal-open-question","key":"scope","question":"Continue?",
                "source":{"promptId":root.id}}),
        )
        .unwrap();
        let mut task = store.task(task["taskId"].as_str().unwrap()).unwrap();
        let attempt = task.attempts[0].id.clone();
        root.phase = Phase::Completed;
        store.save(&mut root).unwrap();
        let keep_input = store
            .admit(
                &serde_json::from_value(json!({
                    "api": API, "id": "unrelated-queued", "session": keep,
                    "prompt": "Keep this input", "mode": "read_only", "queue": true
                }))
                .unwrap(),
            )
            .unwrap();
        let snapshot = store
            .capture_snapshot(
                &root.id,
                &task.id,
                &attempt,
                "fixture-snapshot",
                "project.txt",
                "Project contents".into(),
                deck2_shared::HelperSelection {
                    version: "fixture".into(),
                    executable: "fixture".into(),
                    catalog: "fixture".into(),
                },
            )
            .unwrap();
        store
            .snapshot_access(&snapshot.id, &attempt, "fixture-read")
            .unwrap();
        let app = App::new(
            store,
            "127.0.0.1:32123".into(),
            "/missing-native".into(),
            Some("unavailable fixture".into()),
            "admin".into(),
            "reopen".into(),
        );

        let remove = || {
            sidebar_call(
                &app,
                "/api/sessions/removal-fixture/remove",
                json!({"api": API}),
                true,
                true,
            )
        };
        for (phase, message) in [
            (Phase::Accepted, "active and queued work"),
            (Phase::Uncertain, "uncertain process ownership"),
        ] {
            task.attempts[0].phase = phase;
            app.store.lock().unwrap().save_task(&task).unwrap();
            let response = remove().await;
            assert_eq!(response.status(), StatusCode::CONFLICT);
            let body = axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap();
            assert!(String::from_utf8_lossy(&body).contains(message));
            assert!(app.store.lock().unwrap().task(&task.id).is_ok());
        }
        {
            let store = app.store.lock().unwrap();
            task.attempts[0].phase = Phase::Completed;
            task.attempts[0].settled_ms = Some(crate::now());
            store.save_normal_task(&task).unwrap();
        }
        let response = remove().await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        assert!(String::from_utf8_lossy(&body).contains("outstanding decisions"));
        let outcome = {
            let mut store = app.store.lock().unwrap();
            crate::session_decisions::user(
                &mut store,
                session,
                &json!({
                    "commandId":"removal-cancel-question","decisionId":decision["decisionId"],
                    "expectedRevision":1,"type":"decision.cancel","note":"Cancelled by user"
                }),
            )
            .unwrap();
            store.enqueue_task_outcome(&task.id, &attempt).unwrap();
            store
                .all()
                .unwrap()
                .into_iter()
                .find(|r| r.continuation.is_some())
                .unwrap()
        };
        assert_eq!(remove().await.status(), StatusCode::CONFLICT);
        assert_eq!(
            sidebar_call(
                &app,
                &format!("/api/commands/{}/cancel", outcome.id),
                json!({}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::OK
        );
        {
            let store = app.store.lock().unwrap();
            Store::inspect(&store.conn, project).unwrap();
            store
                .conn
                .execute_batch(
                    "CREATE TRIGGER fail_removal BEFORE DELETE ON sessions
                BEGIN SELECT RAISE(ABORT, 'fixture fault'); END;",
                )
                .unwrap();
        }
        assert_eq!(remove().await.status(), StatusCode::CONFLICT);
        {
            let store = app.store.lock().unwrap();
            assert!(store.task(&task.id).is_ok());
            assert!(store.get(&root.id).unwrap().is_some());
            assert!(store.read_snapshot(&snapshot.id, Some(&attempt)).is_ok());
            Store::inspect(&store.conn, project).unwrap();
            store
                .conn
                .execute_batch("DROP TRIGGER fail_removal")
                .unwrap();
        }
        let response = remove().await;
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
        drop(app);

        let store = Store::open(&path, project).unwrap();
        assert!(store.session_by_id(session).is_err());
        assert!(store.get(&root.id).unwrap().is_none());
        assert!(store.task(&task.id).is_err());
        assert_eq!(store.session_by_id(&keep).unwrap().id, keep);
        assert_eq!(
            store.get(&keep_input.id).unwrap().unwrap().phase,
            Phase::Queued
        );
        for table in [
            "task_calls",
            "read_snapshots",
            "snapshot_accesses",
            "session_events",
            "session_decisions",
            "decision_commands",
        ] {
            let rows: usize = store
                .conn
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(rows, 0, "{table}");
        }
        assert_eq!(
            std::fs::read_to_string(&project_file).unwrap(),
            "Project contents"
        );
        assert_eq!(
            std::fs::read_to_string(&native_transcript).unwrap(),
            "Native history"
        );
    }

    // protects: Q91-01 rejects target authority reuse and mismatched retries at the production route.
    // Oracle: explicit transition creates a new current contract and leaves
    // historical session identity, selection, native context and grants intact.
    #[tokio::test]
    async fn legacy_transition_preserves_source_and_starts_with_relay_authority() {
        let d=tempfile::tempdir().unwrap();
        let binary=d.path().join("codex");
        std::fs::write(&binary,include_bytes!("../../../scripts/fixtures/s7-codex.py")).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&binary,std::fs::Permissions::from_mode(0o700)).unwrap();
        let app=App::new(Store::open_memory(d.path().to_str().unwrap()).unwrap(),"127.0.0.1:1234".into(),binary,None,"admin".into(),"recover".into());
        *app.scope_root.lock().unwrap()=Some(d.path().join("scopes"));
        *app.native_role_root.lock().unwrap()=d.path().join("roles");
        let mut source=app.store.lock().unwrap().create_session(&serde_json::from_value(json!({"api":API,"id":"legacy-source-session","title":"Legacy"})).unwrap()).unwrap();
        {
            let mut store=app.store.lock().unwrap();
            store.bind_native(&source.id,"historical-readonly-thread",deck2_shared::Mode::ReadOnly,deck2_shared::NativeRunner::Codex).unwrap();
            source=store.session_by_id(&source.id).unwrap();
            let mut config=store.configuration().unwrap();config.revision+=1;config.team_enabled=false;store.save_configuration(&config).unwrap();
        }
        let digest=crate::tasks::digest(&serde_json::to_vec(&source).unwrap());
        let body=json!({"api":API,"expected_source_digest":digest,"session":{"api":API,"id":"canonical-transition-session","title":"Canonical","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}}});
        let url="/api/sessions/legacy-source-session/transition";
        // An ordinary existing session must never be repurposed, even when all
        // normalized assignments/title match and approvals are omitted.
        for approvals in ["yolo", "relay"] {
            let mut existing=body["session"].clone();
            existing["id"]=json!(format!("existing-{approvals}-target"));
            existing["approvals"]=json!(approvals);
            assert_eq!(sidebar_call(&app,"/api/sessions",existing.clone(),true,true).await.status(),StatusCode::OK);
            let before={
                let mut store=app.store.lock().unwrap();
                store.bind_native(existing["id"].as_str().unwrap(),"unrelated-native-thread",deck2_shared::Mode::SessionV1,deck2_shared::NativeRunner::Codex).unwrap();
                serde_json::to_value(store.sessions().unwrap()).unwrap()
            };
            let mut collision=body.clone();
            existing.as_object_mut().unwrap().remove("approvals");
            collision["session"]=existing;
            assert_eq!(sidebar_call(&app,url,collision,true,true).await.status(),StatusCode::CONFLICT,"unrelated existing {approvals} target must be rejected");
            let store=app.store.lock().unwrap();
            assert_eq!(serde_json::to_value(store.sessions().unwrap()).unwrap(),before,"source and existing target must remain unchanged");
            assert_eq!(store.conn.query_row("SELECT COUNT(*) FROM meta WHERE key LIKE 'session-transition:%'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        }
        let response=sidebar_call(&app,url,body.clone(),true,true).await;
        let status=response.status();
        assert_eq!(status,StatusCode::OK);
        let value:serde_json::Value=serde_json::from_slice(&axum::body::to_bytes(response.into_body(),1024*1024).await.unwrap()).unwrap();
        assert_eq!(status,StatusCode::OK,"{value}");
        assert_eq!(value["contract"]["approvals"],"relay");
        assert!(value["native"].is_null());
        assert!(value["original"].is_null());
        assert_eq!(value["contract"]["members"].as_object().unwrap().len(),crate::session_contract::MEMBERS.len());
        let after=app.store.lock().unwrap().session_by_id(&source.id).unwrap();
        assert_eq!(serde_json::to_value(after).unwrap(),serde_json::to_value(&source).unwrap());
        assert_eq!(sidebar_call(&app,url,body.clone(),true,true).await.status(),StatusCode::OK,"retry must be idempotent");
        let before=serde_json::to_value(app.store.lock().unwrap().sessions().unwrap()).unwrap();
        let mut changed=body.clone(); changed["session"]["title"]=json!("Different retry");
        assert_eq!(sidebar_call(&app,url,changed,true,true).await.status(),StatusCode::CONFLICT);
        let mut changed=body.clone(); changed["session"]["members"]["lead"]["modelId"]=json!("gpt-6.1-terra");
        assert_eq!(sidebar_call(&app,url,changed,true,true).await.status(),StatusCode::CONFLICT);
        let other=app.store.lock().unwrap().create_session(&serde_json::from_value(json!({"api":API,"id":"other-legacy-source","title":"Other"})).unwrap()).unwrap();
        let mut changed=body.clone();changed["expected_source_digest"]=json!(crate::tasks::digest(&serde_json::to_vec(&other).unwrap()));
        assert_eq!(sidebar_call(&app,"/api/sessions/other-legacy-source/transition",changed,true,true).await.status(),StatusCode::CONFLICT);
        assert_eq!(serde_json::to_value(app.store.lock().unwrap().sessions().unwrap().into_iter().filter(|s|s.id!=other.id).collect::<Vec<_>>()).unwrap(),before);
        let mut foreign=body.clone();foreign["session"]["project_id"]=json!("foreign-project");
        assert_eq!(sidebar_call(&app,url,foreign,true,true).await.status(),StatusCode::CONFLICT);
        let mut explicit=body.clone();explicit["session"]["approvals"]=json!("relay");
        assert_eq!(sidebar_call(&app,url,explicit,true,true).await.status(),StatusCode::OK,"explicit and omitted relay are equivalent retries");
        let mut elevated=body.clone(); elevated["session"]["id"]=json!("forbidden-yolo-transition"); elevated["session"]["approvals"]=json!("yolo");
        assert_eq!(sidebar_call(&app,url,elevated,true,true).await.status(),StatusCode::CONFLICT);
        let mut stale=body;stale["expected_source_digest"]=json!("0".repeat(64));
        assert_eq!(sidebar_call(&app,url,stale,true,true).await.status(),StatusCode::CONFLICT);
        assert!(!app.store.lock().unwrap().configuration().unwrap().team_enabled,"historical disabled Investigator selection must remain unchanged");
        {
            let mut store=app.store.lock().unwrap();
            let mut r=store.admit(&serde_json::from_value(json!({"api":API,"id":"historical-unsettled-input","session":source.id,"mode":"read_only","prompt":"Do not replay"})).unwrap()).unwrap();
            r.phase=deck2_shared::Phase::Uncertain;store.save(&mut r).unwrap();
        }
        let guarded=json!({"api":API,"expected_source_digest":digest,"session":{"api":API,"id":"blocked-unsettled-transition","title":"Blocked","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}}});
        assert_eq!(sidebar_call(&app,url,guarded,true,true).await.status(),StatusCode::CONFLICT);
    }
    // Protects auth/CSRF and durable title validation at the real production router.
    #[tokio::test]
    async fn sidebar_mutations_keep_auth_scope_and_names() {
        let (_d, app) = scope_fixture();
        let id = app.store.lock().unwrap().session.clone();
        let url = format!("/api/sessions/{id}/rename");
        let body = json!({"api":API,"title":"Renamed"});
        assert_eq!(
            sidebar_call(&app, &url, body.clone(), false, true)
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            sidebar_call(&app, &url, body.clone(), true, false)
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            sidebar_call(
                &app,
                &url,
                json!({"api":API,"title":"bad\nname"}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            sidebar_call(&app, &url, body, true, true).await.status(),
            StatusCode::OK
        );
        assert_eq!(
            app.store.lock().unwrap().session_by_id(&id).unwrap().title,
            "Renamed"
        );
        assert_eq!(
            sidebar_call(
                &app,
                "/api/sessions/foreign-session/rename",
                json!({"api":API,"title":"Other"}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::CONFLICT
        );
    }
    #[tokio::test]
    async fn project_trust_is_explicit_and_bound_to_the_registered_folder() {
        let (d, app) = scope_fixture();
        let root = d.path().join("trust-target");
        std::fs::create_dir(&root).unwrap();
        let path = root.to_str().unwrap();
        let key = crate::projects::id(path);
        let add = json!({"api":API,"root":root,"trusted":true});
        let saved = || app.store.lock().unwrap().trusted_project(path).unwrap();

        for (auth, origin) in [(false, true), (true, false)] {
            assert_eq!(sidebar_call(&app, "/api/projects", add.clone(), auth, origin).await.status(), StatusCode::FORBIDDEN);
        }
        assert!(app.store.lock().unwrap().project_by_id(&key).is_err());
        let startup_trust = app.store.lock().unwrap().trusted_project(&app.project).unwrap();
        assert_eq!(sidebar_call(&app, "/api/projects", add, true, true).await.status(), StatusCode::OK);
        assert!(saved());
        let binding = app.store.lock().unwrap().project_by_id(&key).unwrap();
        let add_default = json!({"api":API,"root":root});
        assert_eq!(sidebar_call(&app, "/api/projects", add_default.clone(), true, true).await.status(), StatusCode::OK);
        assert!(saved());
        let revoke = json!({"api":API,"project":path,"binding":binding,"trusted":false});
        assert_eq!(sidebar_call(&app, "/api/project/trust", revoke.clone(), true, true).await.status(), StatusCode::OK);
        assert!(!saved());

        std::fs::rename(&root, d.path().join("previous-trust-target")).unwrap();
        std::fs::create_dir(&root).unwrap();
        let grant = json!({"api":API,"project":path,"binding":binding,"trusted":true});
        assert_eq!(sidebar_call(&app, "/api/project/trust", grant.clone(), true, true).await.status(), StatusCode::CONFLICT);
        assert_eq!(sidebar_call(&app, "/api/projects", add_default, true, true).await.status(), StatusCode::OK);
        assert!(!saved());
        assert_eq!(sidebar_call(&app, "/api/project/trust", grant, true, true).await.status(), StatusCode::CONFLICT);
        let replacement = app.store.lock().unwrap().project_by_id(&key).unwrap();
        assert_eq!(sidebar_call(&app, "/api/project/trust", json!({"api":API,"project":path,"binding":replacement,"trusted":true}), true, true).await.status(), StatusCode::OK);
        assert_eq!(sidebar_call(&app, "/api/project/trust", revoke, true, true).await.status(), StatusCode::CONFLICT);
        assert!(saved());
        assert_eq!(app.store.lock().unwrap().trusted_project(&app.project).unwrap(), startup_trust);
    }

    // Removal is a navigation preference: retain history, reject active and last-project removal.
    #[tokio::test]
    async fn sidebar_project_remove_guards_and_restore() {
        let (d, app) = scope_fixture();
        let first = {
            let store = app.store.lock().unwrap();
            store.session_by_id(&store.session).unwrap()
        };
        assert_eq!(
            sidebar_call(
                &app,
                &format!("/api/projects/{}/remove", first.project.id),
                json!({"api":API}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::CONFLICT
        );
        let dir = d.path().join("second");
        std::fs::create_dir(&dir).unwrap();
        assert_eq!(
            sidebar_call(
                &app,
                "/api/projects",
                json!({"api":API,"root":dir}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::OK
        );
        let project = crate::projects::id(dir.to_str().unwrap());
        {
            let mut store = app.store.lock().unwrap();
            store
                .create_session(&deck2_shared::SessionCommand {
                    api: API,
                    id: "sidebar-session".into(),
                    title: "Sidebar session".into(),
                    project_id: Some(project.clone()),
                    members: None,
                    approvals: None,
                })
                .unwrap();
            store
                .admit(&deck2_shared::ScopedSubmit {
                    api: API,
                    id: "sidebar-command".into(),
                    session: "sidebar-session".into(),
                    prompt: "queued fixture".into(),
                    attachments: vec![],
                    mode: deck2_shared::Mode::ReadOnly,
                    queue: true,
                    fresh: true,
                })
                .unwrap();
        }
        assert_eq!(
            sidebar_call(
                &app,
                &format!("/api/projects/{project}/remove"),
                json!({"api":API}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::CONFLICT
        );
        {
            let mut store = app.store.lock().unwrap();
            store.request_cancel("sidebar-command").unwrap();
        }
        assert_eq!(
            sidebar_call(
                &app,
                &format!("/api/projects/{project}/remove"),
                json!({"api":API}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::OK
        );
        {
            let store = app.store.lock().unwrap();
            assert!(store.navigation().unwrap().projects[&project].hidden);
            assert!(store.session_by_id("sidebar-session").is_ok());
            assert!(!store.trusted_project(dir.to_str().unwrap()).unwrap());
        }
        assert_eq!(
            sidebar_call(
                &app,
                "/api/projects",
                json!({"api":API,"root":dir}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::OK
        );
        assert!(!app.store.lock().unwrap().navigation().unwrap().projects[&project].hidden);
    }

    // Protects startup registration from reversing explicit removal, including first registration.
    #[tokio::test]
    async fn sidebar_hidden_registration_is_only_restored_by_explicit_add() {
        let (d, app) = scope_fixture();
        let dir = d.path().join("historical");
        std::fs::create_dir(&dir).unwrap();
        let id = crate::projects::id(dir.to_str().unwrap());
        {
            let mut store = app.store.lock().unwrap();
            let mut n = store.navigation().unwrap();
            n.projects.entry(id.clone()).or_default().hidden = true;
            store.save_navigation(&n).unwrap();
            store.register_project(dir.to_str().unwrap()).unwrap();
            store.register_project(dir.to_str().unwrap()).unwrap();
            assert!(
                store.navigation().unwrap().projects[&id].hidden,
                "automatic registration must retain removal"
            );
        }
        assert_eq!(
            sidebar_call(
                &app,
                "/api/projects",
                json!({"api":API,"root":dir}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::OK
        );
        assert!(!app.store.lock().unwrap().navigation().unwrap().projects[&id].hidden);
        // Previously unavailable history: Add reaches the new-registration branch.
        let dir = d.path().join("new-history");
        std::fs::create_dir(&dir).unwrap();
        let id = crate::projects::id(dir.to_str().unwrap());
        {
            let store = app.store.lock().unwrap();
            let mut n = store.navigation().unwrap();
            n.projects.entry(id.clone()).or_default().hidden = true;
            store.save_navigation(&n).unwrap();
        }
        assert_eq!(
            sidebar_call(
                &app,
                "/api/projects",
                json!({"api":API,"root":dir}),
                true,
                true
            )
            .await
            .status(),
            StatusCode::OK
        );
        assert!(!app.store.lock().unwrap().navigation().unwrap().projects[&id].hidden);
    }
    // Protects same-ID local sessions and navigation entries from historical mutations.
    #[tokio::test]
    async fn sidebar_historical_mutations_reject_local_identity_collision() {
        let (d, app) = scope_fixture();
        let history = d.path().join("history");
        let id = app.store.lock().unwrap().session.clone();
        let dir = history.join("sessions").join(&id);
        std::fs::create_dir_all(&dir).unwrap();
        let project = crate::projects::id(d.path().to_str().unwrap());
        let bytes=json!({"v":1,"sessionId":id,"projectRoot":d.path(),"projectId":project,"title":"Historical","createdAt":"2026-01-01T00:00:00Z","members":{}}).to_string();
        std::fs::write(dir.join("session.json"), &bytes).unwrap();
        app.history_root(Some(history.clone()));
        use std::os::unix::fs::PermissionsExt;
        for path in [&history, &history.join("sessions"), &dir] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        std::fs::set_permissions(
            dir.join("session.json"),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        assert_eq!(
            app.history.lock().unwrap().navigation_project(&id).unwrap(),
            project
        );
        let before = app.store.lock().unwrap().session_by_id(&id).unwrap().title;
        for action in ["rename", "remove"] {
            assert_eq!(
                sidebar_call(
                    &app,
                    &format!("/api/sidebar/projects/{project}/sessions/{id}/{action}"),
                    json!({"api":API,"title":"Historical renamed"}),
                    true,
                    true
                )
                .await
                .status(),
                StatusCode::CONFLICT
            );
        }
        let store = app.store.lock().unwrap();
        assert_eq!(store.session_by_id(&id).unwrap().title, before);
        assert!(store.navigation().unwrap().sessions.is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.join("session.json")).unwrap(),
            bytes
        );
    }

    // PROJECT73-Q03: HTTP omission resolves the startup selection once, before
    // preparation and persistence; explicit/retried identity cannot switch roots.
    #[tokio::test]
    async fn project74_create_default_is_consistent_with_startup_project() {
        use http_body_util::BodyExt;
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut s = Store::open_memory(a.path().to_str().unwrap()).unwrap();
        let pa = s
            .project_by_id(&crate::projects::id(a.path().to_str().unwrap()))
            .unwrap();
        let pb = s.register_project(b.path().to_str().unwrap()).unwrap();
        use std::os::unix::fs::PermissionsExt;
        let binary = a.path().join("codex");
        std::fs::write(
            &binary,
            include_bytes!("../../../scripts/fixtures/s7-codex.py"),
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let initial = App::new(
            s,
            "127.0.0.1:1234".into(),
            binary,
            None,
            "admin".into(),
            "recover".into(),
        );
        *initial.scope_root.lock().unwrap() = Some(a.path().join("scopes"));
        *initial.native_role_root.lock().unwrap() = a.path().join("roles");
        let app = initial.project_context(&pb.id).unwrap();
        for (id, project, expected) in [
            ("default-session", None, &pb),
            ("explicit-a-session", Some(&pa.id), &pa),
            ("explicit-b-session", Some(&pb.id), &pb),
            ("default-session", None, &pb),
        ] {
            let response = router(app.clone())
                .oneshot(
                    axum::http::Request::builder()
                        .method("POST")
                        .uri("/api/sessions")
                        .header("host", &app.host)
                        .header("origin", format!("http://{}", app.host))
                        .header("cookie", format!("{}={}", app.cookie_name, app.cookie))
                        .header("content-type", "application/json")
                        .body(Body::from(
                            json!({"api":API,"id":id,"title":id,"project_id":project}).to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let value: serde_json::Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert_eq!(value["project"]["id"], expected.id);
        }
        {
            let mut s = app.store.lock().unwrap();
            let r = s
                .admit(&ScopedSubmit {
                    api: API,
                    id: "default-fresh-input".into(),
                    session: "default-session".into(),
                    prompt: "fresh input".into(),
                    mode: deck2_shared::Mode::ReadOnly,
                    queue: true,
                    fresh: true,
                    attachments: vec![],
                })
                .unwrap();
            assert_eq!(r.configuration.unwrap().project, pb);
        }

        let response=router(app.clone()).oneshot(axum::http::Request::builder().method("POST").uri("/api/sessions")
                .header("host",&app.host).header("origin",format!("http://{}",app.host)).header("cookie",format!("{}={}",app.cookie_name,app.cookie)).header("content-type","application/json")
                .body(Body::from(json!({"api":API,"id":"prepared-default-session","title":"Prepared default","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            app.store
                .lock()
                .unwrap()
                .session_by_id("prepared-default-session")
                .unwrap()
                .project,
            pb
        );
        let calls = std::fs::read_to_string(a.path().join("calls.jsonl")).unwrap();
        let reads = calls
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
            .filter(|v| v["method"] == "config/read")
            .collect::<Vec<_>>();
        assert!(
            !reads.is_empty(),
            "creation must actually prepare native inventory"
        );
        assert!(
            reads.iter().all(|v| v["params"]["cwd"] == pb.root),
            "creation preparation crossed projects"
        );
        let conflict = create_session(
            State(app.clone()),
            Json(SessionCommand {
                api: API,
                id: "default-session".into(),
                title: "default-session".into(),
                project_id: Some(pa.id),
                members: None,
                approvals: None,
            }),
        )
        .await;
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
        let workspace = workspace_response(&app);
        let value: serde_json::Value =
            serde_json::from_slice(&workspace.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert!(value["project_availability"][&pb.id].is_null());
    }

    // PROJECT73-Q05: actual prepared Investigator evidence belongs only to its
    // root; a foreign project must remain unobserved until independently prepared.
    #[tokio::test]
    async fn project74_investigator_projection_is_project_bound() {
        use http_body_util::BodyExt;
        use std::os::unix::fs::PermissionsExt;
        let (d, app) = scope_fixture();
        let b = tempfile::tempdir().unwrap();
        let binary = d.path().join("codex");
        std::fs::write(d.path().join("case"), "ready").unwrap();
        std::fs::write(
            &binary,
            include_bytes!("../../../scripts/fixtures/codex-investigator.py"),
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let runner = crate::opencode::Runner::prepare_codex(
            &binary,
            d.path(),
            d.path(),
            crate::opencode::read_tools(),
            None,
        )
        .await
        .unwrap();
        *app.team.lock().unwrap() = Some(runner);
        let p = app
            .store
            .lock()
            .unwrap()
            .register_project(b.path().to_str().unwrap())
            .unwrap();
        let other = app.project_context(&p.id).unwrap();
        for (context, observed) in [(app.clone(), true), (other.clone(), false)] {
            let r = configuration(ProjectState(context.clone())).await;
            let v: serde_json::Value =
                serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap();
            assert_eq!(
                !v["observed"].is_null(),
                observed,
                "foreign Investigator appeared prepared"
            );
            let r = router(context.clone())
                .oneshot(
                    axum::http::Request::builder()
                        .uri("/api/runners")
                        .header("host", &context.host)
                        .header(
                            "cookie",
                            format!("{}={}", context.cookie_name, context.cookie),
                        )
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(r.status(), StatusCode::OK);
            let v: serde_json::Value =
                serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap();
            assert_eq!(v["open_code"]["ready"], observed);
        }
        let runner = crate::opencode::Runner::prepare_codex(
            &binary,
            d.path(),
            b.path(),
            crate::opencode::read_tools(),
            None,
        )
        .await
        .unwrap();
        *app.team.lock().unwrap() = Some(runner);
        let r = configuration(ProjectState(other)).await;
        let v: serde_json::Value =
            serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert!(!v["observed"].is_null());
    }

    #[tokio::test]
    async fn project74_workspace_availability_is_per_project() {
        use http_body_util::BodyExt;
        let (_d, app) = scope_fixture();
        let b = tempfile::tempdir().unwrap();
        let binary = b.path().join("codex");
        std::fs::write(&binary, b"fixture edge").unwrap();
        let pb = {
            let mut s = app.store.lock().unwrap();
            let p = s.register_project(b.path().to_str().unwrap()).unwrap();
            let mut c = s.configuration_for(&p.root).unwrap();
            c.runner = Some(deck2_shared::RunnerBinding {
                path: binary.to_str().unwrap().into(),
                executable: crate::tasks::digest(b"fixture edge"),
                ownership: "external_unknown".into(),
                model: None,
                qualification: crate::runner_management::QUALIFICATION.into(),
                catalog: None,
            });
            c.revision = s.next_configuration_revision().unwrap();
            s.save_configuration(&c).unwrap();
            p
        };
        let r = workspace_response(&app);
        let v: serde_json::Value =
            serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert!(v["availability"].is_string());
        assert!(v["project_availability"][crate::projects::id(&app.project)].is_string());
        assert_eq!(v["project_availability"][pb.id], serde_json::Value::Null);
    }

    fn admit_owned(app: &App) -> bool {
        let Ok(mut active) = app.active.try_lock() else {
            return false;
        };
        let Ok(mut store) = app.store.try_lock() else {
            return false;
        };
        app.retain_auth_scope().unwrap();
        let command = ScopedSubmit {
            attachments: Vec::new(),
            api: API,
            id: "new-owned-command".into(),
            session: store.session.clone(),
            prompt: "inspect".into(),
            mode: deck2_shared::Mode::ReadOnly,
            fresh: true,
            queue: true,
        };
        store.admit(&command).unwrap();
        active.insert(command.id, watch::channel(false).0);
        true
    }
    // S7A-Q01: deterministic scheduler probe at the settled-check/release boundary.
    // Oracle: concurrent admitted work must retain the kernel reservation until
    // both durable work and process ownership settle. No sleeps or fake locks.
    #[tokio::test]
    async fn auth_release_completion_interleaving() {
        release_interleaving(false).await;
    }
    #[tokio::test]
    async fn auth_release_cancellation_interleaving() {
        release_interleaving(true).await;
    }
    async fn release_interleaving(cancellation: bool) {
        {
            let (_d, app) = scope_fixture();
            app.retain_auth_scope().unwrap();
            let mut receipt = {
                let mut s = app.store.lock().unwrap();
                let c = ScopedSubmit {
                    attachments: Vec::new(),
                    api: API,
                    id: "old-command".into(),
                    session: s.session.clone(),
                    prompt: "inspect".into(),
                    mode: deck2_shared::Mode::ReadOnly,
                    fresh: true,
                    queue: false,
                };
                s.admit(&c).unwrap()
            };
            receipt.phase = deck2_shared::Phase::Completed;
            app.store.lock().unwrap().save(&mut receipt).unwrap();
            let admitted = Arc::new(AtomicBool::new(false));
            let other = app.clone();
            let observed = admitted.clone();
            *app.release_probe.lock().unwrap() = Some(Box::new(move || {
                observed.store(admit_owned(&other), Ordering::SeqCst);
            }));
            if cancellation {
                cancel(State(app.clone()), Path(receipt.id)).await;
            } else {
                app.clear_active(&receipt.id);
            }
            if !admitted.load(Ordering::SeqCst) {
                assert!(admit_owned(&app));
            }
            // Separate file description represents another host's exclusive login.
            assert!(
                app.scope_lock(true).is_err(),
                "cleanup lost new admission reservation"
            );
            let mut r = app.receipt("new-owned-command").unwrap();
            r.phase = deck2_shared::Phase::Completed;
            app.store.lock().unwrap().save(&mut r).unwrap();
            app.clear_active("unrelated-cleanup");
            assert!(
                app.scope_lock(true).is_err(),
                "terminal receipt still has a process owner"
            );
            r.phase = deck2_shared::Phase::Uncertain;
            app.store.lock().unwrap().save(&mut r).unwrap();
            app.clear_active(&r.id);
            assert!(
                app.scope_lock(true).is_err(),
                "uncertain receipt retains scope without a process registration"
            );
            r.phase = deck2_shared::Phase::Completed;
            app.store.lock().unwrap().save(&mut r).unwrap();
            app.clear_active(&r.id);
            assert!(
                app.scope_lock(true).is_ok(),
                "settled work must release reservation"
            );
        }
    }
    // A concurrently forked reader can briefly inherit this CLOEXEC descriptor.
    // Incidental copies must not retain a logically settled host reservation.
    #[tokio::test]
    async fn settled_auth_release_does_not_wait_for_incidental_descriptor() {
        let (_dir, app) = scope_fixture();
        app.retain_auth_scope().unwrap();
        let inherited = app
            .auth_scope
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .0
            .try_clone()
            .unwrap();
        app.release_settled_auth_scope();
        assert!(
            app.scope_lock(true).is_ok(),
            "settled scope must unlock despite incidental descriptor"
        );
        drop(inherited);
    }
    // Rejected queued input cannot release a terminal process's reservation.
    #[tokio::test]
    async fn auth_release_rejected_admission_retains_process_owner() {
        let (_d, app) = scope_fixture();
        app.retain_auth_scope().unwrap();
        app.active
            .lock()
            .unwrap()
            .insert("login:uncertain".into(), watch::channel(false).0);
        let command = ScopedSubmit {
            attachments: Vec::new(),
            api: API,
            id: "invalid-command".into(),
            session: "wrong-session".into(),
            prompt: "inspect".into(),
            mode: deck2_shared::Mode::ReadOnly,
            fresh: true,
            queue: true,
        };
        let response = submit(
            State(app.clone()),
            axum::extract::Query(Default::default()),
            Json(command),
        )
        .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert!(app.scope_lock(true).is_err());
        app.clear_active("unrelated");
        assert!(app.scope_lock(true).is_err());
        app.clear_active("login:uncertain");
        assert!(app.scope_lock(true).is_ok());
    }
    // S4-Q01: a durable terminal model state cannot bypass a live process owner.
    // Exercise the authenticated default router; queued input and retries remain safe.
    #[tokio::test]
    async fn direct_submission_respects_live_process_owner() {
        let root=tempfile::tempdir().unwrap();
        let store = Store::open_memory(root.path().to_str().unwrap()).unwrap();
        let app = App::new(
            store,
            "127.0.0.1:1234".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let (sender, _receiver) = watch::channel(false);
        app.active
            .lock()
            .unwrap()
            .insert("child:old-process".into(), sender);
        let command = |queue| {
            json!({"api":API,"id":"next-command-01","session":app.store.lock().unwrap().session,"prompt":"next","mode":"read_only","queue":queue,"fresh":true}).to_string()
        };
        let request = |body| {
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/commands")
                .header("host", &app.host)
                .header("origin", format!("http://{}", app.host))
                .header("cookie", format!("{}={}", app.cookie_name, app.cookie))
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap()
        };
        let response = router(app.clone())
            .oneshot(request(command(false)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert!(
            app.store
                .lock()
                .unwrap()
                .get("next-command-01")
                .unwrap()
                .is_none()
        );
        // Connected mode also needs positive proof of an independent owner;
        // the child: prefix alone cannot grant overlap eligibility.
        let mut connected:serde_json::Value=serde_json::from_str(&command(false)).unwrap();
        connected["id"]=json!("next-connected-01");connected["mode"]=json!("session_v1");
        let response=router(app.clone()).oneshot(request(connected.to_string())).await.unwrap();
        assert_eq!(response.status(),StatusCode::CONFLICT);
        assert!(app.store.lock().unwrap().get("next-connected-01").unwrap().is_none());
        for _ in 0..2 {
            let response = router(app.clone())
                .oneshot(request(command(true)))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }
        let s = app.store.lock().unwrap();
        assert_eq!(s.all().unwrap().len(), 1);
        assert_eq!(
            s.get("next-command-01").unwrap().unwrap().phase,
            deck2_shared::Phase::Queued
        );
    }
    // protects: authenticated busy canonical input admission, durable idempotence,
    // cancellation and live/uncertain execution fences. No provider calls.
    #[tokio::test]
    async fn busy_canonical_submission_queues_without_opt_in() {
        use tower::ServiceExt;
        use axum::body::Body;
        let (_d, app, _bridge)=crate::session_mcp::tests::fixture().await;
        let body=json!({"api":API,"id":"busy-user-input","session":"coordination-session","prompt":"Next message","mode":"session_v1"});
        let request=|body:serde_json::Value| axum::http::Request::builder().method("POST").uri("/api/commands")
            .header("host",&app.host).header("origin",format!("http://{}",app.host))
            .header("cookie",format!("{}={}",app.cookie_name,app.cookie)).header("content-type","application/json")
            .body(Body::from(body.to_string())).unwrap();
        for _ in 0..2 {
            let response=router(app.clone()).oneshot(request(body.clone())).await.unwrap();
            assert_eq!(response.status(),StatusCode::OK,"busy input must be accepted once");
            let value:serde_json::Value=serde_json::from_slice(&axum::body::to_bytes(response.into_body(),1024*1024).await.unwrap()).unwrap();
            assert_eq!(value["phase"],"queued");
        }
        let mut conflict=body.clone();conflict["prompt"]=json!("Changed payload");
        assert_eq!(router(app.clone()).oneshot(request(conflict)).await.unwrap().status(),StatusCode::CONFLICT);
        let mut s=app.store.lock().unwrap();
        assert_eq!(s.all().unwrap().len(),2);
        assert!(s.claim_next().unwrap().is_none());
        let mut r=s.get("coordination-root").unwrap().unwrap();r.phase=deck2_shared::Phase::Uncertain;s.save(&mut r).unwrap();
        assert!(s.claim_next().unwrap().is_none());
        let cancelled=s.request_cancel("busy-user-input").unwrap();
        assert_eq!(cancelled.phase,deck2_shared::Phase::Cancelled);assert!(cancelled.dispatch_ms.is_none());
        assert_eq!(s.get("coordination-root").unwrap().unwrap().phase,deck2_shared::Phase::Uncertain);
    }

}

#[cfg(test)]
#[path = "project_settings_tests.rs"]
mod project_settings_tests;

//! Bounded retained Codex threads. Process sharing never shares attempt authority.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) const MAX_THREADS: usize = 8;
pub(crate) const MAX_GROUPS: usize = 4;
pub(crate) const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Default)]
pub(crate) struct Slot {
    pub epoch: AtomicU64,
    pub(super) registry: std::sync::Arc<registry::Registry>,
    common_key: std::sync::Mutex<Option<String>>,
    idle: std::sync::Mutex<Vec<Idle>>,
    // Held from removal through observed settlement. The worker owns this
    // guard independently of the awaiting HTTP/expiry/replacement future.
    retirement: std::sync::Arc<tokio::sync::Mutex<Option<String>>>,
    #[cfg(test)]
    expiry_barrier:
        std::sync::Mutex<Option<std::sync::Arc<(tokio::sync::Notify, tokio::sync::Notify)>>>,
    #[cfg(test)]
    retire_entered: tokio::sync::Notify,
    #[cfg(test)]
    pub(super) preparation_timeout: std::sync::Mutex<Option<Duration>>,
}
impl Slot {
    pub(crate) fn recover(&self, store: &crate::Store) -> Result<(),String> { self.registry.recover(store) }
    pub(crate) fn resource_view(&self, session: &str) -> Value {
        let (threads,groups)=self.registry.counts();
        json!({"state":self.registry.session_state(session),"threads":threads,"processes":groups,"thread_limit":MAX_THREADS,"process_limit":MAX_GROUPS})
    }
    pub(crate) fn loaded_session(&self, session: &str) -> bool {
        self.idle.lock().unwrap().iter_mut().any(|i| {
            i.native.runtime_session.as_deref() == Some(session)
                && i.expires > Instant::now()
                && i.native.alive()
        })
    }
}
struct Idle {
    native: Native,
    key: String,
    epoch: u64,
    expires: Instant,
}

// Bind launch inputs and disk configuration independently of native's in-memory
// config cache. Account material is never read: inode/change metadata invalidates
// a process, and account/read remains mandatory on every attempt.
pub(super) fn key(
    app: &App,
    binary: &Path,
    receipt: &deck2_shared::Receipt,
) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    let home = app.native_role_root.lock().unwrap().clone();
    let mut paths = vec![
        home.join("config.toml"),
        home.join("auth.json"),
        home.join("managed_config.toml"),
        home.join("requirements.toml"),
        PathBuf::from("/etc/codex/managed_config.toml"),
        PathBuf::from("/etc/codex/requirements.toml"),
    ];
    for parent in Path::new(&app.project).ancestors() {
        paths.push(parent.join(".codex/config.toml"));
        paths.push(parent.join(".deck/config.json"));
    }
    let mut inputs = format!(
        "{:?}|{}|{}|{:?}",
        executable_identity(binary)?,
        app.project,
        receipt.session,
        receipt.configuration
    );
    for path in paths {
        inputs.push_str(&format!("{path:?}"));
        match std::fs::metadata(&path) {
            Ok(m) => inputs.push_str(&format!(
                "{:?}",
                [
                    m.dev(),
                    m.ino(),
                    m.len(),
                    m.mtime() as u64,
                    m.mtime_nsec() as u64,
                    m.ctime() as u64,
                    m.ctime_nsec() as u64
                ]
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => inputs.push_str("absent"),
            Err(_) => return Err("Cannot verify native launch inputs".into()),
        }
    }
    let mut env: Vec<_> = std::env::vars_os().collect();
    env.sort();
    inputs.push_str(&format!("{env:?}"));
    Ok(crate::tasks::digest(inputs.as_bytes()))
}

fn common_key(app: &App, binary: &Path) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    let home = app.native_role_root.lock().unwrap().clone();
    let mut inputs = format!("{:?}|{:?}|{:?}", executable_identity(binary)?, home, std::env::current_dir().map_err(|_| "Native spawn cwd unavailable")?);
    for path in [home.join("config.toml"), home.join("auth.json"), home.join("managed_config.toml"), home.join("requirements.toml"), PathBuf::from("/etc/codex/managed_config.toml"), PathBuf::from("/etc/codex/requirements.toml")] {
        inputs.push_str(&format!("{path:?}"));
        match std::fs::metadata(path) {
            Ok(m) => inputs.push_str(&format!("{:?}", [m.dev(),m.ino(),m.len(),m.mtime() as u64,m.mtime_nsec() as u64,m.ctime() as u64,m.ctime_nsec() as u64])),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => inputs.push_str("absent"),
            Err(_) => return Err("Cannot verify shared process inputs".into()),
        }
    }
    let mut env: Vec<_> = std::env::vars_os().collect(); env.sort();
    inputs.push_str(&format!("{env:?}"));
    Ok(crate::tasks::digest(inputs.as_bytes()))
}
pub(super) fn process_key(app: &App, binary: &Path) -> Result<String, String> {
    let home = app.native_role_root.lock().unwrap().clone();
    let mut inputs = common_key(app, binary)?;
    for parent in Path::new(&app.project).ancestors() {
        for path in [parent.join(".codex/config.toml"), parent.join(".deck/config.json")] {
            if path == home.join("config.toml") { continue; }
            if !path.try_exists().map_err(|_| "Cannot verify project override")? { continue; }
            let bytes = std::fs::read(&path).map_err(|_| "Cannot read project override")?;
            // This exact Deck-owned switch is thread-local and qualified. All
            // other project/native overrides conservatively isolate a group.
            let qualified = if path.ends_with(".deck/config.json") {
                serde_json::from_slice::<Value>(&bytes).ok().is_some_and(|v| {
                    let Some(root) = v.as_object() else { return false; };
                    if root.is_empty() { return true; }
                    if root.len()!=1 { return false; }
                    let Some(cap) = v["capabilities"].as_object() else { return false; };
                    if cap.len()!=1 { return false; }
                    let Some(cbm) = cap.get("codebase-memory").and_then(Value::as_object) else { return false; };
                    cbm.len()==1 && cbm.get("enabled").is_some_and(Value::is_boolean)
                })
            } else { false };
            if !qualified { inputs.push_str(&format!("unqualified-project:{}:{}", app.project, crate::tasks::digest(&bytes))); }
        }
    }
    Ok(crate::tasks::digest(inputs.as_bytes()))
}

impl App {
    pub(crate) fn shutdown_native(&self) {
        self.native_reuse.epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let app = self.clone();
            runtime.spawn(async move {
                let _ = app.retire_native().await;
            });
        } else {
            // No executor can observe settlement. Native::drop kills and
            // retains its reservation; a later restart must also fail closed.
            let idle = std::mem::take(&mut *self.native_reuse.idle.lock().unwrap());
            if !idle.is_empty() && let Ok(mut state) = self.native_reuse.retirement.try_lock() {
                *state = Some("Native shutdown settlement was not observed".into());
            }
            drop(idle);
        }
    }
    pub(crate) async fn retire_native(&self) -> Result<(), String> {
        #[cfg(test)]
        self.native_reuse.retire_entered.notify_one();
        self.native_reuse.epoch.fetch_add(1, Ordering::SeqCst);
        let state = self.native_reuse.retirement.clone().lock_owned().await;
        if let Some(error) = state.as_ref() {
            return Err(error.clone());
        }
        let idle = std::mem::take(&mut *self.native_reuse.idle.lock().unwrap());
        settle(self, idle, state).await
    }
    pub(crate) async fn retire_native_session(&self, session: &str) -> Result<(), String> {
        #[cfg(test)]
        self.native_reuse.retire_entered.notify_one();
        let state = self.native_reuse.retirement.clone().lock_owned().await;
        if let Some(error) = state.as_ref() { return Err(error.clone()); }
        let idle = {
            let mut entries = self.native_reuse.idle.lock().unwrap();
            entries.iter().position(|i| i.native.runtime_session.as_deref() == Some(session)).map(|i| entries.remove(i))
        };
        if let Some(idle) = idle { settle(self, vec![idle], state).await?; }
        Ok(())
    }
}

pub(super) struct Checkout {
    pub native: Option<Native>,
    pub reservation: Option<registry::Lease>,
}

pub(super) async fn take(app: &App, key: &str, group_key: &str, session: &str, fresh: bool) -> Result<Checkout, String> {
    app.native_reuse.registry.wait_retiring(session).await?;
    let mut state = app.native_reuse.retirement.clone().lock_owned().await;
    if let Some(error) = state.as_ref() { return Err(error.clone()); }
    if app.native_reuse.registry.occupied(session) {
        return Err("Retained session has loading, leased, retiring or uncertain ownership".into());
    }
    let common = common_key(app, &app.binary)?;
    let changed = {
        let mut current = app.native_reuse.common_key.lock().unwrap();
        let changed = current.as_ref().is_some_and(|old| old != &common);
        if changed && app.native_reuse.registry.counts().0 > app.native_reuse.idle.lock().unwrap().len() {
            return Err("Shared launch inputs changed while retained ownership is active; wait for settlement".into());
        }
        *current = Some(common);
        changed
    };
    if changed {
        let idle = std::mem::take(&mut *app.native_reuse.idle.lock().unwrap());
        settle(app, idle, state).await?;
        state = app.native_reuse.retirement.clone().lock_owned().await;
    }
    loop {
        let stale = {
            let mut entries = app.native_reuse.idle.lock().unwrap();
            entries.iter_mut().position(|i| !i.native.alive() || i.expires <= Instant::now()
                || (i.native.runtime_session.as_deref() == Some(session) && (fresh || i.key != key || i.native.role.as_ref().is_some_and(|r| r.verify().is_err()))))
                .map(|i| entries.remove(i))
        };
        let Some(stale) = stale else { break; };
        settle(app, vec![stale], state).await?;
        state = app.native_reuse.retirement.clone().lock_owned().await;
    }
    let victims = {
    let mut entries = app.native_reuse.idle.lock().unwrap();
    if let Some(i) = entries.iter().position(|i| i.key == key) {
        let mut idle = entries.remove(i);
        let n = &mut idle.native;
        n.timing = deck2_shared::StartupTiming { process_reused: true, thread_reused: true, ..Default::default() };
        n.reasoning = None; n.capability_note.clear();
        if let Some(images) = n.image_files.take() { n.retired_paths.push(images.keep()); }
        if let Some(mut backend) = n.codebase.take() && let Some(path) = backend.retain() { n.retired_paths.push(path); }
        idle.native.retained_lease.as_mut().ok_or("Retained ownership missing")?.started();
        return Ok(Checkout { native: Some(idle.native), reservation: None });
    }
    let available = |i: &Idle| i.native.retained_lease.as_ref().is_some_and(|l| app.native_reuse.registry.group_available(&l.group));
    let has_group = app.native_reuse.registry.compatible(group_key).is_some();
    let (threads, groups) = app.native_reuse.registry.counts();
    let mut victims = vec![];
    if !has_group && groups >= MAX_GROUPS {
        if let Some(oldest) = entries.iter().filter(|i| available(i)).min_by_key(|i| i.expires).and_then(|i| i.native.retained_lease.as_ref()).map(|l| l.group.clone()) {
            let mut i = 0;
            while i < entries.len() {
                if entries[i].native.retained_lease.as_ref().is_some_and(|l| l.group == oldest) { victims.push(entries.remove(i)); } else { i += 1; }
            }
        }
    } else if threads >= MAX_THREADS
        && let Some(i) = entries.iter().enumerate().min_by_key(|(_, i)| i.expires).map(|(i, _)| i) {
        victims.push(entries.remove(i));
    }
    victims
    };
    if !victims.is_empty() {
        eprintln!("Retiring {} settled native thread(s): retained runtime capacity", victims.len());
        settle(app, victims, state).await?;
    }
    // Loading is reserved only after retiring ownership has actually settled.
    // An eviction may have removed the last thread in the matching group.
    let compatible = app.native_reuse.registry.compatible(group_key);
    let mut reservation = app.native_reuse.registry.reserve(session, compatible.as_ref().map(|(group, _)| group.as_str()))?;
    if let Some((_, template)) = compatible {
        let mut selected = template.sibling()?;
        reservation.started();
        selected.retained_lease = Some(reservation);
        return Ok(Checkout { native: Some(selected), reservation: None });
    }
    Ok(Checkout { native: None, reservation: Some(reservation) })
}

pub(super) fn park(app: &App, mut native: Native, key: String, epoch: u64) {
    if let Some(t) = &native.transport { t.deactivate(); }
    if let Some(p) = &native.shared { p.park(&native.route); }
    native.events = None;
    native.process_owner = None; native.session_mcp = None;
    native.session_authorization = None; native.codebase_slot = None; native.queued.clear();
    let mut entries = app.native_reuse.idle.lock().unwrap();
    if app.shutdown_requested.load(Ordering::SeqCst) || epoch != app.native_reuse.epoch.load(Ordering::SeqCst) { return; }
    let expires = Instant::now() + IDLE_TIMEOUT;
    if let Some(lease) = &native.retained_lease { lease.state(registry::State::Idle); }
    entries.push(Idle { native, key, epoch, expires });
    let weak = std::sync::Arc::downgrade(&app.inner);
    tokio::spawn(async move {
        tokio::time::sleep(IDLE_TIMEOUT).await;
        if let Some(inner) = weak.upgrade() { expire(&App::from_inner(inner), epoch).await; }
    });
}

// Spawn before awaiting: cancellation cannot orphan an empty slot or release
// the retirement guard while Native::drop is still settling the process group.
async fn settle(
    app: &App,
    idle: Vec<Idle>,
    mut state: tokio::sync::OwnedMutexGuard<Option<String>>,
) -> Result<(), String> {
    *state = Some("Native retirement did not settle; inspect before recovery".into());
    #[cfg(test)]
    let barrier = app.native_reuse.expiry_barrier.lock().unwrap().clone();
    #[cfg(not(test))]
    let _ = app;
    tokio::spawn(async move {
        #[cfg(test)]
        if let Some(barrier) = barrier {
            barrier.0.notify_one();
            barrier.1.notified().await;
        }
        let mut result = Ok(());
        for mut entry in idle {
            if let Err(error) = entry.native.retire_thread().await { result = Err(error); break; }
        }
        *state = result.as_ref().err().cloned();
        result
    })
    .await
    .map_err(|_| "Native retirement worker did not settle".to_string())?
}

async fn expire(app: &App, epoch: u64) {
    let state = app.native_reuse.retirement.clone().lock_owned().await;
    if state.is_some() {
        return;
    }
    let idle = {
        let mut entries = app.native_reuse.idle.lock().unwrap();
        let mut expired = vec![];
        let mut i = 0;
        while i < entries.len() {
            if entries[i].epoch == epoch && entries[i].expires <= Instant::now() { expired.push(entries.remove(i)); } else { i += 1; }
        }
        expired
    };
    if !idle.is_empty() { let _ = settle(app, idle, state).await; }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Store;
    use deck2_shared::{API, Phase};
    use std::os::unix::fs::PermissionsExt;

    fn fixture() -> (tempfile::TempDir, App) { fixture_with_script(|script| script) }
    fn fixture_with_script(transform: impl FnOnce(String) -> String) -> (tempfile::TempDir, App) {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("codex");
        let script = include_str!("../tests/fake_session_native.py").replace(
            "if '--version' in sys.argv:",
            "if sys.argv[1:]==['update','--help']: print('Usage: codex update');sys.exit()\nif '--version' in sys.argv:",
        );
        let script = script.replace(
            "elif m in ['thread/start','thread/resume']:",
            "elif m in ['thread/start','thread/resume']:\n  thread=p.get('threadId') or ('normal-thread' if p['cwd']==str(root) else pathlib.Path(p['cwd']).name+'-thread')",
        );
        let script = script.replace("elif m=='turn/start':", "elif m=='turn/start':\n  thread=p['threadId']");
        let script = script.replace("  def tool(name,args):", "  if text=='Hold cancellation':continue\n  def tool(name,args):")
            .replace("elif m=='thread/unsubscribe':", "elif m=='turn/interrupt':\n  result(v,{})\n  out({'method':'turn/completed','params':{'threadId':p['threadId'],'turn':{'id':p['turnId'],'status':'interrupted'}}})\n elif m=='thread/unsubscribe':");
        // Hold a real wire reply after native has loaded the requested thread.
        let script = script.replace("  result(v,{'thread':", "  if (root/'hold-preparation').exists():\n   (root/'preparation-entered').touch()\n   while not (root/'release-preparation').exists():time.sleep(.005)\n   if (root/'crash-preparation').exists():sys.exit(0)\n  result(v,{'thread':");
        let script = script.replace("def result(v,r):out({'id':v['id'],'result':r})", "def result(v,r):\n if (root/'hold-method').exists() and v.get('method')==(root/'hold-method').read_text():\n  (root/'preparation-entered').touch()\n  while not (root/'release-preparation').exists():time.sleep(.005)\n out({'id':v['id'],'result':r})");
        std::fs::write(&binary, transform(script)).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(dir.path().join("startup-fixture"), "").unwrap();
        let app = App::new(
            Store::open_memory(dir.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:32123".into(),
            binary,
            None,
            "admin".into(),
            "recover".into(),
        );
        *app.scope_root.lock().unwrap() = Some(dir.path().join("scope-locks"));
        *app.native_role_root.lock().unwrap() = dir.path().join("native-home");
        let command = serde_json::from_value(json!({"api":API,"id":"reuse-session","title":"Reuse","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
        app.store.lock().unwrap().create_session(&command).unwrap();
        (dir, app)
    }
    // Protects exclusive checkout of a retained session while its Native is
    // outside the idle view. Oracle: architect28 one lease per thread/session.
    #[tokio::test]
    async fn borrowed_thread_remains_owned_until_observed_settlement() {
        let (_dir, app) = fixture();
        let first = turn(&app, "registry-first").await;
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        let (key, group) = {
            let entries = app.native_reuse.idle.lock().unwrap();
            let entry = entries.last().expect("completed thread retained");
            (entry.key.clone(), process_key(&app, &app.binary).unwrap())
        };
        let mut borrowed = take(&app, &key, &group, "reuse-session", false).await.unwrap().native.unwrap();
        let duplicate = take(&app, &key, &group, "reuse-session", false).await;
        let rejected = duplicate.is_err();
        drop(duplicate);
        borrowed.retire_thread().await.unwrap();
        app.retire_native().await.unwrap();
        assert!(rejected, "Borrowed session disappeared from ownership; a duplicate load was admitted");
    }
    fn add_project(app: &App, path: &Path, session: &str) -> App {
        std::fs::create_dir_all(path).unwrap();
        let mut s = app.store.lock().unwrap();
        let p = s.register_project(path.to_str().unwrap()).unwrap();
        let c = serde_json::from_value(json!({"api":API,"id":session,"title":session,"project_id":p.id,"members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
        s.create_session(&c).unwrap();
        drop(s);
        app.for_session(session).unwrap()
    }
    async fn turn(app: &App, id: &str) -> deck2_shared::Receipt { turn_for(app, id, "reuse-session").await }
    async fn turn_for(app: &App, id: &str, session: &str) -> deck2_shared::Receipt {
        let submit = serde_json::from_value(json!({"api":API,"id":id,"session":session,"prompt":"Remember and continue","mode":"session_v1"})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (_tx, rx) = watch::channel(false);
        super::super::run(app.clone(), id.into(), app.binary.clone(), rx).await;
        app.receipt(id).unwrap()
    }
    // Oracle: simultaneous warm Leads keep independent exact thread/turn routes,
    // and target cancellation retires only that thread's ownership reservation.
    #[tokio::test]
    async fn warm_leads_overlap_and_cancel_with_independent_registry_leases() {
        let (dir, app) = fixture();
        let b = add_project(&app, &dir.path().join("parallel-b"), "parallel-session-b");
        let first = turn(&app, "parallel-prime-a").await;
        let second = turn_for(&b, "parallel-prime-b", "parallel-session-b").await;
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        assert_eq!(second.phase, Phase::Completed, "{}", second.detail);
        assert_eq!(first.native_pid, second.native_pid);
        let mut running = vec![];
        for (view, id, session) in [(&app, "parallel-active-a", "reuse-session"), (&b, "parallel-active-b", "parallel-session-b")] {
            let submit = serde_json::from_value(json!({"api":API,"id":id,"session":session,"prompt":"Hold cancellation","mode":"session_v1"})).unwrap();
            app.store.lock().unwrap().admit(&submit).unwrap();
            let (tx,rx)=watch::channel(false);
            let worker=tokio::spawn(super::super::run(view.clone(), id.into(), app.binary.clone(), rx));
            running.push((tx,worker));
            tokio::time::timeout(Duration::from_secs(10), async {
                while app.receipt(id).unwrap().phase != Phase::Running {
                    let r=app.receipt(id).unwrap();
                    assert!(r.phase.active(), "{}", r.detail);
                    tokio::task::yield_now().await;
                }
            }).await.unwrap();
        }
        assert_eq!(app.native_reuse.registry.counts(), (2,1));
        assert!(app.native_reuse.registry.occupied("reuse-session"));
        assert!(app.native_reuse.registry.occupied("parallel-session-b"));
        let (tx,worker)=running.remove(0); tx.send(true).unwrap();
        tokio::time::timeout(Duration::from_secs(10), worker).await.unwrap().unwrap();
        assert_eq!(app.receipt("parallel-active-a").unwrap().phase, Phase::Cancelled);
        assert_eq!(app.receipt("parallel-active-b").unwrap().phase, Phase::Running);
        assert_eq!(app.native_reuse.registry.counts(), (1,1));
        let (tx,worker)=running.remove(0); tx.send(true).unwrap();
        tokio::time::timeout(Duration::from_secs(10), worker).await.unwrap().unwrap();
        assert_eq!(app.receipt("parallel-active-b").unwrap().phase, Phase::Cancelled);
        assert_eq!(app.native_reuse.registry.counts(), (0,0));
    }
    #[tokio::test]
    async fn cold_sibling_finds_compatible_group_while_every_thread_is_leased() {
        let (dir,app)=fixture();
        let b=add_project(&app,&dir.path().join("leased-b"),"leased-session-b");
        let first=turn(&app,"leased-prime-a").await;
        let submit=serde_json::from_value(json!({"api":API,"id":"leased-active-a","session":"reuse-session","prompt":"Hold cancellation","mode":"session_v1"})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (tx,rx)=watch::channel(false);
        let worker=tokio::spawn(super::super::run(app.clone(),"leased-active-a".into(),app.binary.clone(),rx));
        tokio::time::timeout(Duration::from_secs(10),async { while app.receipt("leased-active-a").unwrap().phase!=Phase::Running {tokio::task::yield_now().await;} }).await.unwrap();
        assert!(app.native_reuse.idle.lock().unwrap().is_empty());
        let second=turn_for(&b,"leased-cold-b","leased-session-b").await;
        assert_eq!(second.phase,Phase::Completed,"{}",second.detail);
        assert_eq!(second.native_pid,first.native_pid,"Borrowed groups must remain discoverable");
        assert_eq!(app.native_reuse.registry.counts(),(2,1));
        tx.send(true).unwrap();worker.await.unwrap();
        let again=turn_for(&b,"leased-warm-b","leased-session-b").await;
        assert_eq!(again.phase,Phase::Completed,"{}",again.detail);
        assert_eq!(again.native_pid,second.native_pid);
        app.retire_native().await.unwrap();
    }
    #[tokio::test]
    async fn target_restart_preserves_running_sibling_in_same_process() {
        use axum::{body::Body,http::Request};
        use tower::ServiceExt;
        let (dir,app)=fixture();
        let b=add_project(&app,&dir.path().join("restart-running-b"),"restart-running-session-b");
        let a=turn(&app,"restart-prime-a").await;
        let other=turn_for(&b,"restart-prime-b","restart-running-session-b").await;
        assert_eq!(a.native_pid,other.native_pid);
        let submit=serde_json::from_value(json!({"api":API,"id":"restart-other-active","session":"restart-running-session-b","prompt":"Hold cancellation","mode":"session_v1"})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (tx,rx)=watch::channel(false);
        app.active.lock().unwrap().insert("restart-other-active".into(),tx.clone());
        let worker=tokio::spawn(super::super::run(b,"restart-other-active".into(),app.binary.clone(),rx));
        tokio::time::timeout(Duration::from_secs(10),async{while app.receipt("restart-other-active").unwrap().phase!=Phase::Running{tokio::task::yield_now().await;}}).await.unwrap();
        let router=crate::server::router(app.clone());
        let auth=router.clone().oneshot(Request::post("/auth").header("host",&app.host).header("origin",format!("http://{}",app.host)).body(Body::from(app.issue_launch())).unwrap()).await.unwrap();
        let cookie=auth.headers()["set-cookie"].to_str().unwrap().split(';').next().unwrap();
        let response=router.oneshot(Request::post("/api/sessions/reuse-session/restart")
            .header("host",&app.host).header("origin",format!("http://{}",app.host)).header("cookie",cookie).header("content-type","application/json")
            .body(Body::from(json!({"api":API,"command_id":"restart-with-running-sibling","expected_epoch":1}).to_string())).unwrap()).await.unwrap();
        let status=response.status();
        let body=axum::body::to_bytes(response.into_body(),1024*1024).await.unwrap();
        let preserved=app.receipt("restart-other-active").unwrap().phase==Phase::Running;
        let count=app.native_reuse.registry.counts();
        tx.send(true).unwrap();worker.await.unwrap();
        assert_eq!(status,axum::http::StatusCode::OK,"{}",String::from_utf8_lossy(&body));
        assert!(preserved);
        assert_eq!(count,(1,1));
        assert_eq!(app.store.lock().unwrap().session_epoch("reuse-session").unwrap().epoch,2);
    }
    #[test]
    fn recovered_uncertain_root_retains_native_resource_reservation() {
        let (dir,app)=fixture();
        let command=serde_json::from_value(json!({"api":API,"id":"uncertain-native-root","session":"reuse-session","prompt":"Must not replay","mode":"session_v1"})).unwrap();
        let mut store=app.store.lock().unwrap();
        let mut r=store.admit(&command).unwrap();
        r.phase=Phase::Uncertain;r.native_pid=Some(777777);store.save(&mut r).unwrap();
        let durable=std::mem::replace(&mut *store,Store::open_memory(dir.path().to_str().unwrap()).unwrap());
        drop(store);
        let recovered=App::new(durable,app.host.clone(),app.binary.clone(),None,"admin".into(),"recover".into());
        assert_eq!(recovered.native_reuse.registry.counts(),(1,1));
        assert_eq!(recovered.native_reuse.registry.session_state("reuse-session"),Some("uncertain"));
        assert!(!dir.path().join("dispatch-count").exists());
    }
    // Protects cross-project retention at the default execution boundary. The
    // oracle is same process, distinct stable threads and per-thread discovery.
    #[tokio::test]
    async fn compatible_projects_keep_both_threads_across_a_b_a() {
        let (dir, app) = fixture();
        let project = dir.path().join("project-b");
        std::fs::create_dir(&project).unwrap();
        {
            let mut s = app.store.lock().unwrap();
            let p = s.register_project(project.to_str().unwrap()).unwrap();
            let c = serde_json::from_value(json!({"api":API,"id":"project-b-session","title":"B","project_id":p.id,"members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
            s.create_session(&c).unwrap();
        }
        let a = turn(&app, "multi-a-cold").await;
        let b_app = app.for_session("project-b-session").unwrap();
        let submit = serde_json::from_value(json!({"api":API,"id":"multi-b-cold","session":"project-b-session","prompt":"Remember B","mode":"session_v1"})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (_tx, rx) = watch::channel(false);
        super::super::run(b_app, "multi-b-cold".into(), app.binary.clone(), rx).await;
        let b = app.receipt("multi-b-cold").unwrap();
        let a2 = turn(&app, "multi-a-warm").await;
        app.retire_native().await.unwrap();
        for r in [&a, &b, &a2] { assert_eq!(r.phase, Phase::Completed, "{}", r.detail); }
        assert_eq!(a.native_pid, b.native_pid, "B evicted A's compatible process");
        assert_eq!(a.native_pid, a2.native_pid);
        assert_ne!(a.thread, b.thread);
        assert_eq!(a.thread, a2.thread);
        assert!(a2.startup_timing.unwrap().process_reused);
    }
    // Target retirement and an old expiry timer must preserve another thread,
    // including its transport and admitted catalog. No previous input is replayed.
    #[tokio::test]
    async fn target_retirement_and_expiry_preserve_sibling_admission() {
        let (dir, app) = fixture();
        let b = add_project(&app, &dir.path().join("project-b"), "session-b");
        let a1 = turn(&app, "isolation-a").await;
        let b1 = turn_for(&b, "isolation-b", "session-b").await;
        assert_eq!(a1.phase, Phase::Completed, "{}", a1.detail);
        assert_eq!(b1.phase, Phase::Completed, "{}", b1.detail);
        assert!(b1.startup_timing.as_ref().unwrap().process_reused);
        assert!(!b1.startup_timing.as_ref().unwrap().thread_reused);
        assert!(app.native_reuse.loaded_session("reuse-session"));
        assert!(app.native_reuse.loaded_session("session-b"));
        use axum::{body::{Body, to_bytes}, http::Request};
        use tower::ServiceExt;
        let router = crate::server::router(app.clone());
        let auth = router.clone().oneshot(Request::post("/auth").header("host", &app.host)
            .header("origin", format!("http://{}",app.host)).body(Body::from(app.issue_launch())).unwrap()).await.unwrap();
        let cookie = auth.headers()["set-cookie"].to_str().unwrap().split(';').next().unwrap();
        for _ in 0..2 {
            let response = router.clone().oneshot(Request::post("/api/sessions/reuse-session/restart")
                .header("host", &app.host).header("origin",format!("http://{}",app.host))
                .header("cookie", cookie).header("content-type","application/json")
                .body(Body::from(json!({"api":API,"command_id":"restart-a-preserve-b","expected_epoch":1}).to_string())).unwrap()).await.unwrap();
            assert!(response.status().is_success());
            let v: Value = serde_json::from_slice(&to_bytes(response.into_body(), 1024*1024).await.unwrap()).unwrap();
            assert_eq!(v["epoch"],2);
        }
        assert_eq!(app.store.lock().unwrap().session_epoch("session-b").unwrap().epoch,1);

        assert!(!app.native_reuse.loaded_session("reuse-session"));
        assert!(app.native_reuse.loaded_session("session-b"));
        let b2 = turn_for(&b, "isolation-b-warm", "session-b").await;
        assert_eq!(b2.native_pid, b1.native_pid);
        assert_eq!(b2.thread, b1.thread);
        assert!(b2.startup_timing.unwrap().thread_reused);
        let a2 = turn(&app, "isolation-a-reload").await;
        assert_eq!(a2.native_pid, b1.native_pid);
        assert!(!a2.startup_timing.unwrap().thread_reused);
        {
            let mut entries = app.native_reuse.idle.lock().unwrap();
            entries.iter_mut().find(|i| i.native.runtime_session.as_deref()==Some("reuse-session")).unwrap().expires = Instant::now();
        }
        let epoch = app.native_reuse.epoch.load(Ordering::SeqCst);
        expire(&app, epoch).await;
        assert!(!app.native_reuse.loaded_session("reuse-session"));
        assert!(app.native_reuse.loaded_session("session-b"));
        // A previous timer observes B's refreshed deadline, so it cannot evict B.
        expire(&app, epoch).await;
        assert!(app.native_reuse.loaded_session("session-b"));
        app.retire_native().await.unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("dispatch-count")).unwrap().lines().count(), 4);
    }
    // Q84-01: fresh input must settle the previous loaded thread and discover
    // its own catalog; native loaded-list accounting cannot leak predecessors.
    #[tokio::test]
    async fn repeated_fresh_replaces_only_target_with_cold_admission() {
        let (dir, app) = fixture();
        let b = add_project(&app, &dir.path().join("project-b"), "session-b");
        let mut a = turn(&app, "fresh-a-first").await;
        let b1 = turn_for(&b, "fresh-b-first", "session-b").await;
        for i in 0..3 {
            let id = format!("fresh-a-{i}");
            let submit = serde_json::from_value(json!({"api":API,"id":id,"session":"reuse-session","prompt":"New execution","mode":"session_v1","fresh":true})).unwrap();
            app.store.lock().unwrap().admit(&submit).unwrap();
            let (_tx, rx) = watch::channel(false);
            super::super::run(app.clone(), id.clone(), app.binary.clone(), rx).await;
            let next = app.receipt(&id).unwrap();
            assert_eq!(next.phase, Phase::Completed, "{}", next.detail);
            let p = app.native_reuse.idle.lock().unwrap().last().unwrap().native.shared.clone().unwrap();
            let loaded = p.request("thread/loaded/list", json!({}), None).await.unwrap();
            let ids = loaded["result"]["data"].as_array().unwrap();
            let previous_absent = !ids.contains(&json!(a.thread));
            let count = ids.len();
            let timing = next.startup_timing.as_ref().unwrap();
            let b2 = turn_for(&b, &format!("fresh-b-warm-{i}"), "session-b").await;
            assert_eq!(b2.phase, Phase::Completed, "{}", b2.detail);
            assert_eq!(b2.thread, b1.thread);
            assert_eq!(b2.native_pid, b1.native_pid);
            assert!(b2.startup_timing.unwrap().thread_reused);
            if !previous_absent || count != 2 || timing.thread_reused {
                app.retire_native().await.unwrap();
                panic!("fresh replacement leaked predecessor or borrowed admission: previous_absent={previous_absent}, loaded={count}, thread_reused={}",timing.thread_reused);
            }
            assert_ne!(a.thread, next.thread);
            assert_eq!(next.native_pid, b1.native_pid);
            // Each replacement must attest the session bridge before dispatch.
            assert!(timing.mcp_status_requests > 0);
            let checks: Vec<_> = std::fs::read_to_string(dir.path().join("startup-wire")).unwrap().lines()
                .map(|l|serde_json::from_str::<Value>(l).unwrap())
                .filter(|v|v["method"]=="mcpServerStatus/list").collect();
            assert_eq!(checks.len(), 2 * i + 4);
            assert!(checks.iter().all(|v| v["serverName"].is_null()));
            a = next;
        }
        app.retire_native().await.unwrap();
    }
    // Q84-02: Stop while thread/start or thread/resume is awaiting its reply
    // must retain ownership until that reply settles, then unload only A.
    #[tokio::test]
    async fn preparation_cancel_settles_target_and_keeps_sibling_warm() {
        for (warm, barrier, crash) in [
            (false, "thread-reply", false), (true, "thread-reply", false),
            (false, "account/read", false), (true, "account/read", false),
            (false, "mcpServerStatus/list", false), (true, "mcpServerStatus/list", false),
            (false, "thread-reply", true),
        ] {
            let (dir, app) = fixture();
            let b = add_project(&app, &dir.path().join("project-b"), "session-b");
            if warm { assert_eq!(turn(&app, "prep-a-seed").await.phase, Phase::Completed); }
            let b1 = turn_for(&b, "prep-b-seed", "session-b").await;
            assert_eq!(b1.phase, Phase::Completed,"{}",b1.detail);
            if barrier == "thread-reply" {
                std::fs::write(dir.path().join("hold-preparation"), "").unwrap();
            } else {
                std::fs::write(dir.path().join("hold-method"), barrier).unwrap();
            }
            if crash { std::fs::write(dir.path().join("crash-preparation"), "").unwrap(); }
            let submit = serde_json::from_value(json!({"api":API,"id":"prep-cancel-a","session":"reuse-session","prompt":"Never dispatched","mode":"session_v1"})).unwrap();
            app.store.lock().unwrap().admit(&submit).unwrap();
            let (tx, rx) = watch::channel(false);
            let task = tokio::spawn(super::super::run(app.clone(), "prep-cancel-a".into(), app.binary.clone(), rx));
            tokio::time::timeout(Duration::from_secs(10), async {
                while !dir.path().join("preparation-entered").exists() { tokio::task::yield_now().await; }
            }).await.unwrap();
            assert_eq!(app.receipt("prep-cancel-a").unwrap().phase, Phase::Preparing);
            tx.send(true).unwrap();
            // Observe cancellation before allowing the in-flight reply. The
            // old implementation returns terminal immediately and kills B.
            tokio::time::timeout(Duration::from_secs(10), async {
                while !app.receipt("prep-cancel-a").unwrap().cancel_requested { tokio::task::yield_now().await; }
            }).await.unwrap();
            let remained_owned = !task.is_finished();
            let sibling_loaded = app.native_reuse.loaded_session("session-b");
            for name in ["hold-preparation", "hold-method"] { let _ = std::fs::remove_file(dir.path().join(name)); }
            std::fs::write(dir.path().join("release-preparation"), "").unwrap();
            tokio::time::timeout(Duration::from_secs(10), task).await.unwrap().unwrap();
            let cancelled = app.receipt("prep-cancel-a").unwrap();
            assert_eq!(cancelled.phase, Phase::Cancelled,"{}",cancelled.detail);
            assert!(cancelled.dispatch_ms.is_none());
            let only_b_loaded = if crash { true } else {
                let p = app.native_reuse.idle.lock().unwrap().last().unwrap().native.shared.clone().unwrap();
                let loaded = p.request("thread/loaded/list", json!({}), None).await.unwrap();
                loaded["result"]["data"] == json!([b1.thread]) && p.route_count() == 1
            };
            let b2 = turn_for(&b, "prep-b-warm", "session-b").await;
            let survived = b2.phase == Phase::Completed && b2.thread == b1.thread && b2.native_pid == b1.native_pid
                && b2.startup_timing.as_ref().is_some_and(|t|t.thread_reused);
            app.retire_native().await.unwrap();
            assert!(remained_owned && sibling_loaded, "preparation ownership was dropped before the reply settled");
            assert!(only_b_loaded, "cancelled target remained loaded or retained an uncounted route");
            if crash {
                assert!(cancelled.detail.contains("sibling runtimes were lost"), "group loss was hidden: {}", cancelled.detail);
                assert_ne!(b1.native_pid, b2.native_pid);
                assert_eq!(b2.phase, Phase::Completed, "{}", b2.detail);
            } else {
                assert!(survived,"preparation cancellation killed retained sibling (warm={warm}, barrier={barrier}): {}",b2.detail);
                assert!(cancelled.detail.contains("sibling runtimes preserved"), "{}",cancelled.detail);
            }
            assert_eq!(std::fs::read_to_string(dir.path().join("dispatch-count")).unwrap().lines().count(),if warm {3} else {2});
        }
    }
    // Unproven RPC settlement at the drain deadline must retire the group,
    // instead of trying more RPCs over a possibly partially written stream.
    #[tokio::test]
    async fn preparation_deadline_retires_group_without_another_rpc() {
        let (dir, app) = fixture();
        let b = add_project(&app, &dir.path().join("project-b"), "session-b");
        assert_eq!(turn(&app,"deadline-a-seed").await.phase,Phase::Completed);
        let b1 = turn_for(&b,"deadline-b-seed","session-b").await;
        *app.native_reuse.preparation_timeout.lock().unwrap()=Some(Duration::from_millis(50));
        std::fs::write(dir.path().join("hold-method"),"account/read").unwrap();
        let submit=serde_json::from_value(json!({"api":API,"id":"deadline-a","session":"reuse-session","mode":"session_v1","prompt":"Never dispatched"})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (tx,rx)=watch::channel(false);
        let mut task=tokio::spawn(super::super::run(app.clone(),"deadline-a".into(),app.binary.clone(),rx));
        tokio::time::timeout(Duration::from_secs(10),async {
            while !dir.path().join("preparation-entered").exists(){tokio::task::yield_now().await;}
        }).await.unwrap();
        tx.send(true).unwrap();
        let settled=tokio::time::timeout(Duration::from_secs(5),&mut task).await;
        let timely=settled.is_ok();
        // Release even on RED so the fixture and its owner can settle normally.
        std::fs::remove_file(dir.path().join("hold-method")).unwrap();
        std::fs::write(dir.path().join("release-preparation"),"").unwrap();
        if let Ok(result)=settled {result.unwrap();} else {task.await.unwrap();}
        let cancelled=app.receipt("deadline-a").unwrap();
        let invalidated=!app.native_reuse.loaded_session("session-b");
        let b2=turn_for(&b,"deadline-b-explicit","session-b").await;
        app.retire_native().await.unwrap();
        assert!(timely,"preparation drain deadline issued another RPC on the unsettled stream");
        assert!(invalidated);
        assert!(cancelled.detail.contains("sibling runtimes were lost"),"{}",cancelled.detail);
        assert_eq!(cancelled.phase,Phase::Cancelled);
        assert!(cancelled.dispatch_ms.is_none());
        assert_eq!(b2.phase,Phase::Completed,"{}",b2.detail);
        assert_ne!(b1.native_pid,b2.native_pid);
        assert_eq!(b1.thread,b2.thread);
        assert_eq!(std::fs::read_to_string(dir.path().join("dispatch-count")).unwrap().lines().count(),3);
    }
    // The unchanged scheduler admits one root; while it runs, an interrupt
    // settles just its thread and does not kill an idle sibling's process.
    #[tokio::test]
    async fn acknowledged_cancel_keeps_sibling_warm() {
        let (dir, app) = fixture();
        let b = add_project(&app, &dir.path().join("project-b"), "session-b");
        let a = turn(&app, "cancel-sibling-a").await;
        let submit = serde_json::from_value(json!({"api":API,"id":"cancel-b","session":"session-b","prompt":"Hold cancellation","mode":"session_v1"})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (tx, rx) = watch::channel(false);
        let binary = app.binary.clone();
        let task = tokio::spawn(super::super::run(b, "cancel-b".into(), binary, rx));
        tokio::time::timeout(Duration::from_secs(10), async {
            while app.receipt("cancel-b").unwrap().phase != Phase::Running { tokio::task::yield_now().await; }
        }).await.unwrap();
        tx.send(true).unwrap();
        tokio::time::timeout(Duration::from_secs(10), task).await.unwrap().unwrap();
        assert_eq!(app.receipt("cancel-b").unwrap().phase, Phase::Cancelled);
        assert!(app.native_reuse.loaded_session("reuse-session"));
        let a2 = turn(&app, "cancel-sibling-a-warm").await;
        assert_eq!(a.native_pid, a2.native_pid);
        assert_eq!(a.thread, a2.thread);
        assert!(a2.startup_timing.unwrap().thread_reused);
        app.retire_native().await.unwrap();
    }
    // Crash recovery is explicit input only: every handle in one process is
    // invalid, another group survives, and completed history is not replayed.
    #[tokio::test]
    async fn group_crash_invalidates_siblings_without_replaying_history() {
        let (dir, app) = fixture();
        let b = add_project(&app, &dir.path().join("project-b"), "session-b");
        let c = add_project(&app, &dir.path().join("project-c"), "session-c");
        std::fs::create_dir(dir.path().join("project-c/.codex")).unwrap();
        std::fs::write(dir.path().join("project-c/.codex/config.toml"), "# isolated MCP policy\n").unwrap();
        let a1 = turn(&app, "crash-a-first").await;
        let b1 = turn_for(&b, "crash-b-first", "session-b").await;
        let c1 = turn_for(&c, "crash-c-first", "session-c").await;
        assert_eq!(a1.native_pid, b1.native_pid);
        assert_ne!(a1.native_pid, c1.native_pid);
        let p = app.native_reuse.idle.lock().unwrap().iter().find(|i| i.native.runtime_session.as_deref()==Some("reuse-session")).unwrap().native.shared.clone().unwrap();
        p.terminate().await.unwrap();
        assert!(!app.native_reuse.loaded_session("reuse-session"));
        assert!(!app.native_reuse.loaded_session("session-b"));
        assert!(app.native_reuse.loaded_session("session-c"));
        assert_eq!(std::fs::read_to_string(dir.path().join("dispatch-count")).unwrap().lines().count(),3);
        let b2 = turn_for(&b, "crash-b-explicit", "session-b").await;
        let c2 = turn_for(&c, "crash-c-warm", "session-c").await;
        assert_eq!(b2.phase,Phase::Completed,"{}",b2.detail);
        assert_ne!(b1.native_pid,b2.native_pid);
        assert_eq!(b1.thread,b2.thread);
        assert_eq!(c1.native_pid,c2.native_pid);
        assert!(c2.startup_timing.unwrap().thread_reused);
        assert_eq!(std::fs::read_to_string(dir.path().join("dispatch-count")).unwrap().lines().count(),5);
        app.retire_native().await.unwrap();
    }
    // A replacement may reserve a new native route only after the oldest
    // retiring owner settles. Loading plus retiring slots must stay bounded.
    #[tokio::test]
    async fn capacity_reservation_waits_for_victim_settlement() {
        let (dir, app) = fixture();
        assert_eq!(turn(&app,"capacity-seed").await.phase,Phase::Completed);
        for i in 0..7 {
            let session=format!("reserved-session-{i}");
            let b=add_project(&app,&dir.path().join(format!("reserved-{i}")),&session);
            assert_eq!(turn_for(&b,&format!("reserved-turn-{i}"),&session).await.phase,Phase::Completed);
        }
        let p=app.native_reuse.idle.lock().unwrap().last().unwrap().native.shared.clone().unwrap();
        let next=add_project(&app,&dir.path().join("reserved-next"),"reserved-session-next");
        let barrier=std::sync::Arc::new((tokio::sync::Notify::new(),tokio::sync::Notify::new()));
        *app.native_reuse.expiry_barrier.lock().unwrap()=Some(barrier.clone());
        let task=tokio::spawn(async move { turn_for(&next,"reserved-turn-next","reserved-session-next").await });
        tokio::time::timeout(Duration::from_secs(10),barrier.0.notified()).await.unwrap();
        let count=p.route_count();
        *app.native_reuse.expiry_barrier.lock().unwrap()=None;
        barrier.1.notify_one();
        let r=tokio::time::timeout(Duration::from_secs(10),task).await.unwrap().unwrap();
        app.retire_native().await.unwrap();
        assert_eq!(r.phase,Phase::Completed,"{}",r.detail);
        assert!(count<=MAX_THREADS,"loading and retiring ownership exceeded capacity: {count}");
    }
    // Bounds are on retained ownership, not messages. At pressure the oldest
    // settled thread is evicted while later siblings retain their native IDs.
    #[tokio::test]
    async fn capacity_evicts_idle_threads_and_conservatively_groups_overrides() {
        let (dir, app) = fixture();
        let a = turn(&app, "capacity-first").await;
        for i in 0..8 {
            let session = format!("capacity-session-{i}");
            let b = add_project(&app, &dir.path().join(format!("project-{i}")), &session);
            let r = turn_for(&b, &format!("capacity-{i}"), &session).await;
            assert_eq!(r.phase, Phase::Completed, "{}", r.detail);
            assert_eq!(r.native_pid, a.native_pid);
            assert!(app.native_reuse.idle.lock().unwrap().len() <= 8);
        }
        assert!(!app.native_reuse.loaded_session("reuse-session"));
        assert!(app.native_reuse.loaded_session("capacity-session-7"));
        app.retire_native().await.unwrap();
        let mut pids = std::collections::BTreeSet::new();
        for i in 0..5 {
            let session = format!("incompatible-session-{i}");
            let path = dir.path().join(format!("configured-{i}"));
            let b = add_project(&app, &path, &session);
            std::fs::create_dir(path.join(".codex")).unwrap();
            std::fs::write(path.join(".codex/config.toml"), format!("# unqualified MCP override {i}\n")).unwrap();
            let r = turn_for(&b, &format!("incompatible-{i}"), &session).await;
            assert_eq!(r.phase, Phase::Completed, "{}", r.detail);
            assert!(pids.insert(r.native_pid));
            let entries = app.native_reuse.idle.lock().unwrap();
            assert!(entries.iter().map(|i| &i.native.retained_lease.as_ref().unwrap().group).collect::<std::collections::BTreeSet<_>>().len() <= 4);
        }
        app.retire_native().await.unwrap();
        assert!(app.scope_lock(true).is_ok());
    }
    // Contract: each cold and warm Lead dispatch verifies its full inventory.
    // Compatible continuation retains the loaded runtime and bridge credentials.
    #[tokio::test]
    async fn cold_and_warm_lead_attest_the_owned_transport() {
        let (dir, app) = fixture();
        let first = turn(&app, "fast-first").await;
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        let checks = || std::fs::read_to_string(dir.path().join("startup-wire")).unwrap()
            .lines().map(|l| serde_json::from_str::<Value>(l).unwrap())
            .filter(|v| v["method"] == "mcpServerStatus/list")
            .map(|v| v["serverName"].clone()).collect::<Vec<_>>();
        assert_eq!(checks(), vec![Value::Null]);
        let second = turn(&app, "fast-second").await;
        app.retire_native().await.unwrap();
        assert_eq!(second.phase, Phase::Completed, "{}", second.detail);
        assert_eq!(first.native_pid, second.native_pid);
        assert_eq!(first.thread, second.thread);
        assert_eq!(checks(), vec![Value::Null; 2]);
        let wire = std::fs::read_to_string(dir.path().join("wire")).unwrap();
        let specs: Vec<_> = wire.lines().map(|l| serde_json::from_str::<Value>(l).unwrap())
            .filter(|v| v["method"] == "thread/start" || v["method"] == "thread/resume")
            .map(|v| v["params"]["config"]["mcp_servers"]["deck-session"].clone()).collect();
        assert_eq!(specs.len(), 2);
        assert!(specs[0] == specs[1], "loaded transport credentials changed");
        let third = turn(&app, "fast-third").await;
        app.retire_native().await.unwrap();
        assert_eq!(third.phase, Phase::Completed, "{}", third.detail);
        assert_eq!(checks(), vec![Value::Null; 3]);
    }
    // Native auto-approved tools need an inventory before the model can run.
    #[tokio::test]
    async fn unverified_optional_mcp_blocks_dispatch() {
        let (dir, app) = fixture_with_script(|script| script.replace(
            "  entries+=[] if member",
            "  if not member:entries.append({'name':'direct-demo','runtimeStatus':'connected','tools':{},'toolsError':'catalog unavailable'})\n  entries+=[] if member",
        ));
        let receipt = turn(&app, "unverified-optional-mcp").await;
        app.retire_native().await.unwrap();
        assert_eq!(receipt.phase, Phase::Failed, "{}", receipt.detail);
        assert!(receipt.dispatch_ms.is_none());
        assert!(!dir.path().join("dispatch-count").exists());
    }
    // Protects installed Test2: model-declared native v2 must not bypass Deck's
    // canonical scheduler. Oracle: effective native opt-out before any turn,
    // including cold resume; a true or unknown acknowledgement must block input.
    #[tokio::test]
    async fn native_delegation_opt_out_is_required_before_dispatch() {
        for enabled in [json!(true), Value::Null] {
            let (dir, app) = fixture();
            std::fs::write(dir.path().join("reasoning-config.json"),
                json!({"agents":{"enabled":enabled}}).to_string()).unwrap();
            let receipt = turn(&app, "native-agents-rejected").await;
            app.retire_native().await.unwrap();
            assert_eq!(receipt.phase, Phase::Failed, "{}", receipt.detail);
            assert!(receipt.dispatch_ms.is_none(), "native delegation was not disabled before input");
        }
        let (dir, app) = fixture();
        let first = turn(&app, "native-agents-cold").await;
        app.retire_native().await.unwrap();
        let resumed = turn(&app, "native-agents-resumed").await;
        app.retire_native().await.unwrap();
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        assert_eq!(resumed.phase, Phase::Completed, "{}", resumed.detail);
        assert_eq!(first.thread, resumed.thread);
        let wire = std::fs::read_to_string(dir.path().join("wire")).unwrap();
        let loads: Vec<Value> = wire.lines().map(|l| serde_json::from_str(l).unwrap())
            .filter(|v: &Value| matches!(v["method"].as_str(), Some("thread/start" | "thread/resume"))).collect();
        assert_eq!(loads.len(), 2);
        assert_eq!(loads[1]["method"], "thread/resume");
        assert!(loads.iter().all(|v| v["params"]["config"]["agents"]["enabled"] == false));
    }
    // Pinned native config/read -> thread/start contract: an absent optional
    // timeout cannot be passed through the JSON-to-TOML override as null.
    #[tokio::test]
    async fn nullable_native_timeout_survives_default_managed_fallback() {
        let (dir, app) = fixture();
        let artifacts = dir.path().join("artifacts");
        std::fs::create_dir(&artifacts).unwrap();
        *app.artifact_store.lock().unwrap() = Some(artifacts.clone());
        let helper = crate::session_codebase::Selection::helper_path_at(&artifacts).unwrap();
        std::fs::write(dir.path().join("native-config.json"), json!({"codebase-memory":{"command":helper,"args":[],"env":{},"enabled":true,"tool_timeout_sec":null}}).to_string()).unwrap();
        let first = turn(&app, "nullable-cold").await;
        let second = turn(&app, "nullable-warm").await;
        app.retire_native().await.unwrap();
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        assert_eq!(second.phase, Phase::Completed, "{}", second.detail);
        assert!(second.startup_timing.unwrap().process_reused);
    }
    // Q76-01: missing-history replacement must exclude a second host for its
    // entire lifetime, including idle parking after normal admission clears.
    #[tokio::test]
    async fn missing_history_replacement_holds_scope_until_settlement() {
        let (dir, app) = fixture();
        let second = App::new(
            Store::open_memory(dir.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:32124".into(),
            app.binary.clone(),
            None,
            "other-admin".into(),
            "other-recover".into(),
        );
        *second.scope_root.lock().unwrap() = app.scope_root.lock().unwrap().clone();
        let first = turn(&app, "reseed-first").await;
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        let retired_transport = app.native_reuse.idle.lock().unwrap().last().unwrap().native.transport.clone().unwrap();
        std::fs::write(dir.path().join("missing-history"), "").unwrap();
        let submit = serde_json::from_value(json!({"api":API,"id":"reseed-second","session":"reuse-session","prompt":"Waiting-policy hold replacement","mode":"session_v1"})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (_tx, rx) = watch::channel(false);
        let running = tokio::spawn(super::super::run(
            app.clone(),
            "reseed-second".into(),
            app.binary.clone(),
            rx,
        ));
        tokio::time::timeout(Duration::from_secs(10), async {
            while !dir.path().join("ready-replacement").exists() {
                let receipt = app.receipt("reseed-second").unwrap();
                assert!(receipt.phase.active(), "{}", receipt.detail);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let running_excluded = second.scope_lock(true).is_err();
        // A reader from the old native process may finish after replacement.
        // Its closure must affect only that retired runtime's endpoint.
        retired_transport.deactivate();
        std::fs::write(dir.path().join("release-replacement"), "").unwrap();
        tokio::time::timeout(Duration::from_secs(10), running)
            .await
            .unwrap()
            .unwrap();
        let receipt = app.receipt("reseed-second").unwrap();
        assert_eq!(receipt.phase, Phase::Completed, "{}", receipt.detail);
        assert_ne!(receipt.native_pid, first.native_pid);
        assert_eq!(receipt.thread.as_deref(), Some("reseed-thread"));
        assert!(
            receipt
                .delivery
                .contains("Confirmed missing native history")
        );
        let pid = receipt.native_pid.unwrap();
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, 0);
        assert!(app.native_reuse.idle.lock().unwrap().len() == 1);
        let parked_excluded = second.scope_lock(true).is_err();
        // Always settle the fixture, including on the expected pre-fix failure.
        app.retire_native().await.unwrap();
        assert!(
            second.scope_lock(true).is_ok(),
            "settlement must release exclusion"
        );
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("dispatch-count"))
                .unwrap()
                .lines()
                .count(),
            2,
            "missing history must never replay the previous input"
        );
        assert!(
            running_excluded,
            "second host acquired exclusive scope while replacement was running"
        );
        assert!(
            parked_excluded,
            "second host acquired exclusive scope while replacement was parked"
        );
    }
    // Oracle: current account/config and fresh bridge authority are mandatory
    // on every turn; process continuity cannot authorize another dispatch.
    #[tokio::test]
    async fn reuse_revalidates_account_and_never_replays_a_rejected_turn() {
        let (dir, app) = fixture();
        let first = turn(&app, "reuse-first").await;
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        std::fs::write(dir.path().join("revoked-auth"), "").unwrap();
        let rejected = turn(&app, "reuse-rejected").await;
        assert_eq!(rejected.phase, Phase::Failed, "{}", rejected.detail);
        assert_eq!(rejected.native_pid, first.native_pid);
        assert!(rejected.dispatch_ms.is_none());
        std::fs::remove_file(dir.path().join("revoked-auth")).unwrap();
        let third = turn(&app, "reuse-explicit-next").await;
        assert_eq!(third.phase, Phase::Completed, "{}", third.detail);
        assert_ne!(third.native_pid, first.native_pid);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("dispatch-count"))
                .unwrap()
                .lines()
                .count(),
            2
        );
        app.retire_native().await.unwrap();
    }
    // Oracle: disk configuration drift and a dead cached process force a fresh
    // process while preserving the durable thread and one dispatch per input.
    #[tokio::test]
    async fn changed_configuration_and_idle_crash_replace_process_without_replay() {
        let (dir, app) = fixture();
        let first = turn(&app, "reuse-first").await;
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        std::fs::create_dir(dir.path().join(".deck")).unwrap();
        std::fs::write(dir.path().join(".deck/config.json"), "{}").unwrap();
        let second = turn(&app, "reuse-config-changed").await;
        assert_eq!(second.phase, Phase::Completed, "{}", second.detail);
        assert_ne!(first.native_pid, second.native_pid);
        let p = app.native_reuse.idle.lock().unwrap().last().unwrap().native.shared.clone().unwrap();
        p.terminate().await.unwrap();
        let third = turn(&app, "reuse-after-idle-crash").await;
        assert_eq!(third.phase, Phase::Completed, "{}", third.detail);
        assert_ne!(second.native_pid, third.native_pid);
        assert_eq!(first.thread, third.thread);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("dispatch-count"))
                .unwrap()
                .lines()
                .count(),
            3
        );
        app.retire_native().await.unwrap();
    }
    // Default HTTP composition must retire and settle idle native work before
    // requesting the exclusive account/maintenance reservation; no updater runs.
    #[tokio::test]
    async fn maintenance_retires_idle_native_before_exclusive_inspection() {
        use axum::{
            body::{Body, to_bytes},
            http::Request,
        };
        use tower::ServiceExt;
        let (_dir, app) = fixture();
        let first = turn(&app, "reuse-first").await;
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        let router = crate::server::router(app.clone());
        let auth = router
            .clone()
            .oneshot(
                Request::post("/auth")
                    .header("host", &app.host)
                    .header("origin", format!("http://{}", app.host))
                    .body(Body::from(app.issue_launch()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = auth.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap();
        let revision = app.store.lock().unwrap().configuration().unwrap().revision;
        let response = router
            .oneshot(
                Request::post("/api/runners/maintenance")
                    .header("host", &app.host)
                    .header("origin", format!("http://{}", app.host))
                    .header("cookie", cookie)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({"api":API,"expected_revision":revision}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert!(status.is_success(), "{body}");
        assert_eq!(body["phase"], "terminal_handoff");
        assert_eq!(body["updated"], false);
        assert!(app.native_reuse.idle.lock().unwrap().is_empty());
        assert!(app.scope_lock(true).is_ok());
    }
    // Workspace must publish process ownership independently of terminal receipt
    // state, so the ordinary browser can queue without weakening admission.
    #[tokio::test]
    async fn workspace_reports_settlement_ownership_after_terminal_receipt() {
        use axum::{
            body::{Body, to_bytes},
            http::Request,
        };
        use tower::ServiceExt;
        let (_dir, app) = fixture();
        assert_eq!(turn(&app, "reuse-first").await.phase, Phase::Completed);
        let router = crate::server::router(app.clone());
        let auth = router
            .clone()
            .oneshot(
                Request::post("/auth")
                    .header("host", &app.host)
                    .header("origin", format!("http://{}", app.host))
                    .body(Body::from(app.issue_launch()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = auth.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        for owned in [false, true, false] {
            if owned {
                let (tx, _) = watch::channel(false);
                app.active.lock().unwrap().insert("reuse-first".into(), tx);
            } else {
                app.active.lock().unwrap().remove("reuse-first");
            }
            let response = router
                .clone()
                .oneshot(
                    Request::get("/api/workspace")
                        .header("host", &app.host)
                        .header("cookie", &cookie)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let body: Value =
                serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                    .unwrap();
            assert_eq!(body["process_active"], owned);
        }
        app.retire_native().await.unwrap();
    }
    // Restart owns settlement even if its HTTP response future is dropped. The
    // next explicit input resumes history once through a fresh native process.
    #[tokio::test]
    async fn session_restart_settles_after_disconnect_without_replay() {
        restart_during_expiry(0).await;
    }
    #[tokio::test]
    async fn cancelled_expiry_keeps_settlement_owned_through_restart() {
        restart_during_expiry(1).await;
    }
    #[tokio::test]
    async fn shutdown_during_expiry_keeps_settlement_owned_through_restart() {
        restart_during_expiry(2).await;
    }
    #[tokio::test]
    async fn retirement_error_prevents_restart_and_new_dispatch() {
        restart_during_expiry(3).await;
    }
    async fn restart_during_expiry(mode: u8) {
        use axum::{
            body::{Body, to_bytes},
            http::{Request, StatusCode},
        };
        use tower::ServiceExt;
        let (dir, app) = fixture();
        let first = turn(&app, "restart-first").await;
        assert_eq!(first.phase, Phase::Completed, "{}", first.detail);
        let router = crate::server::router(app.clone());
        let auth = router
            .clone()
            .oneshot(
                Request::post("/auth")
                    .header("host", &app.host)
                    .header("origin", format!("http://{}", app.host))
                    .body(Body::from(app.issue_launch()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = auth.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap();
        let req = |method: &str, path: &str, body: Value| {
            Request::builder()
                .method(method)
                .uri(path)
                .header("host", &app.host)
                .header("origin", format!("http://{}", app.host))
                .header("cookie", cookie)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap()
        };
        let runtime = router
            .clone()
            .oneshot(req(
                "GET",
                "/api/sessions/reuse-session/runtime",
                Value::Null,
            ))
            .await
            .unwrap();
        assert_eq!(runtime.status(), StatusCode::OK);
        let runtime: Value =
            serde_json::from_slice(&to_bytes(runtime.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(runtime["state"], "loaded");
        assert_eq!(runtime["catalog_verified"], true);
        assert!(
            runtime["catalog"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["name"] == "deck-session" && !s["tools"].as_array().unwrap().is_empty())
        );
        assert!(!runtime.to_string().contains("Authorization"));
        let before = serde_json::to_value(
            app.store
                .lock()
                .unwrap()
                .session_by_id("reuse-session")
                .unwrap(),
        )
        .unwrap();
        // Q79-01: expire the retained process, then pause at the external
        // termination edge. Restart must retain admission and the durable epoch.
        let barrier = std::sync::Arc::new((tokio::sync::Notify::new(), tokio::sync::Notify::new()));
        *app.native_reuse.expiry_barrier.lock().unwrap() = Some(barrier.clone());
        if mode == 3 {
            let invalid_cleanup = dir.path().join("cleanup-is-file");
            std::fs::write(&invalid_cleanup, "").unwrap();
            app.native_reuse
                .idle
                .lock()
                .unwrap()
                .last_mut()
                .unwrap()
                .native
                .retired_paths
                .push(invalid_cleanup);
        }
        let epoch = app.native_reuse.epoch.load(Ordering::SeqCst);
        app.native_reuse
            .idle
            .lock()
            .unwrap()
            .last_mut()
            .unwrap()
            .expires = Instant::now();
        let expiry_app = app.clone();
        let expiry = tokio::spawn(async move { expire(&expiry_app, epoch).await });
        barrier.0.notified().await;
        if mode == 2 {
            app.shutdown_native();
            app.native_reuse.retire_entered.notified().await;
        }
        if mode == 1 || mode == 2 {
            expiry.abort();
            // The expiry waiter can disappear; the settlement worker must live.
            tokio::task::yield_now().await;
        }
        let command = json!({"api":API,"command_id":"restart-lost-response","expected_epoch":1});
        let mut response = Box::pin(router.clone().oneshot(req(
            "POST",
            "/api/sessions/reuse-session/restart",
            command.clone(),
        )));
        assert!(
            std::future::poll_fn(|cx| std::task::Poll::Ready(std::future::Future::poll(
                response.as_mut(),
                cx
            )))
            .await
            .is_pending()
        );
        assert!(
            app.active
                .lock()
                .unwrap()
                .contains_key("session-restart:reuse-session")
        );
        drop(response);
        app.native_reuse.retire_entered.notified().await;
        let pending_epoch = app
            .store
            .lock()
            .unwrap()
            .session_epoch("reuse-session")
            .unwrap()
            .epoch;
        let admission_held = app
            .active
            .lock()
            .unwrap()
            .contains_key("session-restart:reuse-session");
        let account_held = app.scope_lock(true).is_err();
        *app.native_reuse.expiry_barrier.lock().unwrap() = None;
        barrier.1.notify_one();
        let expiry_result = expiry.await;
        if mode == 0 || mode == 3 {
            expiry_result.unwrap();
        } else {
            assert!(expiry_result.unwrap_err().is_cancelled());
        }
        assert_eq!(
            pending_epoch, 1,
            "restart advanced epoch before expiry settlement"
        );
        assert!(
            admission_held,
            "restart released admission before expiry settlement"
        );
        assert!(
            account_held,
            "expiry released account ownership before settlement"
        );
        if mode == 3 {
            tokio::time::timeout(Duration::from_secs(5), async {
                while !app.active.lock().unwrap().is_empty() {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            assert_eq!(
                app.store
                    .lock()
                    .unwrap()
                    .session_epoch("reuse-session")
                    .unwrap()
                    .epoch,
                1
            );
            assert!(
                app.retire_native().await.is_err(),
                "an empty slot must not hide failed settlement"
            );
            let response = router
                .clone()
                .oneshot(req("POST", "/api/sessions/reuse-session/restart", command))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::CONFLICT);
            let rejected = turn(&app, "after-failed-retirement").await;
            assert_eq!(rejected.phase, Phase::Failed);
            assert!(rejected.dispatch_ms.is_none());
            assert_eq!(
                std::fs::read_to_string(dir.path().join("dispatch-count"))
                    .unwrap()
                    .lines()
                    .count(),
                1
            );
            return;
        }
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if app.active.lock().unwrap().is_empty()
                    && app
                        .store
                        .lock()
                        .unwrap()
                        .session_epoch("reuse-session")
                        .unwrap()
                        .epoch
                        == 2
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            unsafe { libc::kill(first.native_pid.unwrap() as i32, 0) },
            -1
        );
        assert!(app.native_reuse.idle.lock().unwrap().is_empty());
        assert!(app.scope_lock(true).is_ok());
        let response = router
            .clone()
            .oneshot(req("POST", "/api/sessions/reuse-session/restart", command))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let runtime: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(runtime["epoch"], 2);
        assert_eq!(runtime["catalog_verified"], false);
        assert!(runtime["catalog"].as_array().unwrap().is_empty());
        assert_eq!(
            before,
            serde_json::to_value(
                app.store
                    .lock()
                    .unwrap()
                    .session_by_id("reuse-session")
                    .unwrap()
            )
            .unwrap()
        );
        let second = turn(&app, "restart-explicit-next").await;
        assert_eq!(second.phase, Phase::Completed, "{}", second.detail);
        assert_ne!(second.native_pid, first.native_pid);
        assert_eq!(second.thread, first.thread);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("dispatch-count"))
                .unwrap()
                .lines()
                .count(),
            2
        );
        app.retire_native().await.unwrap();
    }
    // protects: real native elicitation -> explicit session consent -> repeated
    // native turns, and authenticated busy input -> durable queue -> automatic
    // settlement dispatch. Oracle: one consent, three distinct effects in FIFO,
    // one retained thread/process, exact UUID retries and no duplicate dispatch.
    #[tokio::test]
    async fn session_scope_and_busy_queue_follow_real_native_protocol() {
        use tower::ServiceExt;
        use axum::{body::{Body,to_bytes},http::Request};
        let (dir,app)=fixture_with_script(|script| script.replace("second='Synthetic MCP second' in text", "second=False"));
        let auth=crate::server::router(app.clone()).oneshot(Request::post("/auth")
            .header("host",&app.host).header("origin",format!("http://{}",app.host))
            .body(Body::from(app.issue_launch())).unwrap()).await.unwrap();
        let cookie=auth.headers()["set-cookie"].to_str().unwrap().split(';').next().unwrap().to_string();
        {
            let mut s=app.store.lock().unwrap();let mut session=s.session_by_id("reuse-session").unwrap();
            let assignment=session.contract.as_ref().unwrap().members["lead"].clone();
            session.contract.as_mut().unwrap().members.insert("apply-deep".into(),assignment);
            s.save_session(&session).unwrap();
            let command=serde_json::from_value(json!({"api":API,"id":"consent-first","session":"reuse-session","prompt":"Synthetic MCP first","mode":"session_v1"})).unwrap();
            s.admit(&command).unwrap();
        }
        let (tx,rx)=watch::channel(false);app.active.lock().unwrap().insert("consent-first".into(),tx);
        let worker=tokio::spawn(super::super::run(app.clone(),"consent-first".into(),app.binary.clone(),rx));
        let d=tokio::time::timeout(Duration::from_secs(15),async {
            loop {
                let r=app.receipt("consent-first").unwrap();
                if let Some(d)=r.decisions.first() {break d.clone();}
                assert!(r.phase.active(),"{}",r.detail);tokio::task::yield_now().await;
            }
        }).await.unwrap();
        assert_eq!(d.native.as_ref().unwrap().method,"mcpServer/elicitation/request");
        assert_eq!(d.state,deck2_shared::DecisionState::Pending);
        for (id,prompt) in [("consent-second","Synthetic MCP second"),("consent-third","Synthetic MCP third")] {
            let body=json!({"api":API,"id":id,"session":"reuse-session","prompt":prompt,"mode":"session_v1"});
            for _ in 0..2 {
                let response=crate::server::router(app.clone()).oneshot(Request::post("/api/commands")
                    .header("host",&app.host).header("origin",format!("http://{}",app.host))
                    .header("cookie",&cookie).header("content-type","application/json")
                    .body(Body::from(body.to_string())).unwrap()).await.unwrap();
                let status=response.status();let bytes=to_bytes(response.into_body(),1024*1024).await.unwrap();
                assert_eq!(status,axum::http::StatusCode::OK,"{}",String::from_utf8_lossy(&bytes));
                let receipt:serde_json::Value=serde_json::from_slice(&bytes).unwrap();assert_eq!(receipt["phase"],"queued");
            }
        }
        let resolve=deck2_shared::Resolve{api:API,command_id:"wire-session-consent".into(),expected_revision:d.revision,response:deck2_shared::DecisionResponse::AllowSession};
        app.store.lock().unwrap().resolve(&d.id,&resolve).unwrap();
        app.store.lock().unwrap().resolve(&d.id,&resolve).unwrap();
        worker.await.unwrap();
        tokio::time::timeout(Duration::from_secs(20),async {
            loop {
                let last=app.receipt("consent-third").unwrap();
                for id in ["consent-first","consent-second","consent-third"] {
                    let r=app.receipt(id).unwrap();
                    assert!(r.phase.active() || r.phase==Phase::Queued || r.phase==Phase::Completed,"{}: {}",id,r.detail);
                    assert!(!r.decisions.iter().any(|d|d.state==deck2_shared::DecisionState::Pending),"repeated session scope reprompted");
                }
                if last.phase==Phase::Completed && app.active.lock().unwrap().is_empty() {break;}
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        let first=app.receipt("consent-first").unwrap();
        let source=&first.decisions[0];
        assert_eq!(source.native.as_ref().unwrap().resolution_provenance,Some(deck2_shared::PermissionProvenance::User));
        for id in ["consent-second","consent-third"] {
            let r=app.receipt(id).unwrap();
            assert_eq!(r.decisions[0].native.as_ref().unwrap().resolution_provenance,Some(deck2_shared::PermissionProvenance::ReusedGrant{source_decision:source.id.clone()}));
        }
        for id in ["consent-second","consent-third"] {let r=app.receipt(id).unwrap();assert_eq!(r.native_pid,first.native_pid);assert_eq!(r.thread,first.thread);}
        assert_eq!(std::fs::read_to_string(dir.path().join("dispatch-count")).unwrap().lines().count(),3);
        let approvals:Vec<serde_json::Value>=std::fs::read_to_string(dir.path().join("mcp-approved")).unwrap().lines().map(|s|serde_json::from_str(s).unwrap()).collect();
        assert_eq!(approvals.len(),3);
        assert_eq!(approvals[0],approvals[1]);
        app.retire_native().await.unwrap();
    }

    // Protects the first and subsequent configured coordination requests at the
    // production native loop, with no pre-existing user grant. A foreign MCP
    // remains covered by the adjacent explicit-consent/queue regression.
    #[tokio::test]
    async fn intrinsic_coordination_needs_no_first_or_later_consent() {
        let (dir,app)=fixture_with_script(|script| script
            .replace("'serverName':'synthetic-mail'", "'serverName':'deck-session'")
            .replace("'toolName':'send_message'", "'toolName':'deck_delegate'")
            .replace("Allow the synthetic-mail MCP server to run tool \"send_message\"?", "Allow the deck-session MCP server to run tool \"deck_delegate\"?")
            .replace("   params={'threadId':thread,'turnId':turn,'serverName':'deck-session'", "   pending_mcp={'agent':'apply-deep','task':text}\n   params={'threadId':thread,'turnId':turn,'serverName':'deck-session'"));
        {
            let mut s=app.store.lock().unwrap();let mut session=s.session_by_id("reuse-session").unwrap();
            let assignment=session.contract.as_ref().unwrap().members["lead"].clone();
            session.contract.as_mut().unwrap().members.insert("apply-deep".into(),assignment);
            s.save_session(&session).unwrap();
        }
        let mut receipts=vec![];
        for (id,prompt) in [("intrinsic-first","Synthetic MCP first"),("intrinsic-second","Synthetic MCP second")] {
            let submit=serde_json::from_value(json!({"api":API,"id":id,"session":"reuse-session","prompt":prompt,"mode":"session_v1"})).unwrap();
            app.store.lock().unwrap().admit(&submit).unwrap();
            let (_tx,rx)=watch::channel(false);
            let execution=super::super::run(app.clone(),id.into(),app.binary.clone(),rx);
            let observe=async {
                loop {
                    let r=app.receipt(id).unwrap();
                    assert!(!r.decisions.iter().any(|d|d.state==deck2_shared::DecisionState::Pending),"configured coordination demanded extra consent");
                    if !r.phase.active() && r.phase!=Phase::Queued {break;}
                    tokio::task::yield_now().await;
                }
            };
            tokio::time::timeout(Duration::from_secs(15),async{tokio::join!(execution,observe);}).await.unwrap();
            let r=app.receipt(id).unwrap();assert_eq!(r.phase,Phase::Completed,"{}",r.detail);
            assert_eq!(r.decisions.len(),1);
            let d=&r.decisions[0];
            assert_eq!(d.native.as_ref().unwrap().resolution_provenance,Some(deck2_shared::PermissionProvenance::Intrinsic));
            assert_eq!(d.state,deck2_shared::DecisionState::Settled);
            assert!(d.dispatch_ms.is_some());
            assert!(d.delivered_ms.is_some());
            assert_eq!(d.resolution.as_ref().unwrap().response,deck2_shared::DecisionResponse::AllowOnce);
            receipts.push(r);
        }
        // Reopen actual successfully delivered native-loop receipts, without
        // manufacturing a user consent or a grant source from automatic replies.
        {
            let store=app.store.lock().unwrap();
            let db=dir.path().join("intrinsic-delivered.db");
            store.conn.backup("main",&db,None).unwrap();
            let reopened=Store::open(&db,&store.project).unwrap();
            for receipt in &receipts {
                let persisted=reopened.get(&receipt.id).unwrap().unwrap();
                assert_eq!(persisted.decisions,receipt.decisions);
                assert_eq!(persisted.decisions[0].native.as_ref().unwrap().resolution_provenance,Some(deck2_shared::PermissionProvenance::Intrinsic));
                assert!(reopened.grant_source(&persisted.decisions[0]).unwrap().is_none());
            }
        }
        assert_eq!(receipts[0].native_pid,receipts[1].native_pid);
        assert_eq!(receipts[0].thread,receipts[1].thread);
        assert_eq!(std::fs::read_to_string(dir.path().join("mcp-approved")).unwrap().lines().count(),2);
        let overrides:Vec<Value>=std::fs::read_to_string(dir.path().join("overrides")).unwrap().lines().map(|s|serde_json::from_str(s).unwrap()).collect();
        for config in overrides {
            let spec=&config["deck-session"];
            assert!(spec.get("default_tools_approval_mode").is_none(),"blanket MCP trust introduced");
            let tools=spec["tools"].as_object().unwrap();
            for name in ["deck_delegate","deck_task_list","deck_task_wait","deck_task_result","deck_task_integrate","deck_task_cancel","deck_session_history","deck_approve"] {
                assert_eq!(tools[name]["approval_mode"],"approve","{name}");
            }
            for name in ["deck_exec","deck_decision_resolve","send_message"] {assert!(!tools.contains_key(name));}
        }
        app.retire_native().await.unwrap();
    }

}

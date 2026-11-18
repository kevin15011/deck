//! Automatic native indexing on trusted project roots. A persistent MCP session
//! owns the native watcher; idle and untrusted projects release that connection.
use crate::{
    Store, cbm_management as cbm,
    server::{App, ProjectState, problem},
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashMap, time::Duration};
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Status {
    pub phase: String,
    pub updated_ms: Option<u64>,
    pub indexed_at: Option<String>,
    pub files: Option<usize>,
    pub detail: Option<String>,
    pub plan: Option<String>,
    pub operation: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub api: u32,
    #[serde(default)]
    pub rebuild: bool,
}
fn key(project: &str) -> String {
    format!("cbm-native:{}", crate::projects::id(project))
}
fn load(s: &Store, project: &str) -> Result<Status, String> {
    let b = s
        .conn
        .query_row("SELECT value FROM meta WHERE key=?1", [key(project)], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .map_err(|_| "Cannot read indexing status")?;
    match b {
        Some(b) => serde_json::from_str(&b).map_err(|_| "Cannot decode indexing status".into()),
        None => Ok(Status {
            phase: "pending".into(),
            ..Default::default()
        }),
    }
}
fn save(app: &App, status: &Status) -> Result<(), String> {
    if !app.persistence_available() {
        return Err("Host persistence unavailable".into());
    }
    let store=app.store.lock().unwrap();
    if !store.trusted_project(&app.project)? {return Err("Project trust changed".into());}
    crate::projects::validate(&store.project_by_id(&crate::projects::id(&app.project))?)?;
    store.conn.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",rusqlite::params![key(&app.project),serde_json::to_string(status).unwrap()]).map_err(|_|"Cannot retain indexing status")?;
    Ok(())
}
pub(crate) fn authority(app: &App) -> Result<bool, String> {
    let s = app.store.lock().unwrap();
    let p = s.project_by_id(&crate::projects::id(&app.project))?;
    crate::projects::validate(&p)?;
    if s.navigation()?.projects.get(&p.id).is_some_and(|n|n.hidden){return Ok(false);}
    s.trusted_project(&app.project)
}
fn target(app: &App, q: &HashMap<String, String>) -> Result<App, String> {
    let root = if let Some(id) = q.get("projectId") {
        app.store.lock().unwrap().project_by_id(id)?.root
    } else {
        app.project.clone()
    };
    Ok(App {
        inner: app.inner.clone(),
        project: root,
    })
}
fn status(app: &App) -> Result<Status, String> {
    let trusted = authority(app)?;
    let mut value = load(&app.store.lock().unwrap(), &app.project)?;
    if !trusted || !enabled(app) {
        value.phase = if !trusted {"paused"}else{"disabled"}.into();
        value.detail = None;
    }
    Ok(value)
}
pub async fn inspect(State(app): State<App>, Query(q): Query<HashMap<String, String>>) -> Response {
    match target(&app, &q).and_then(|a| { if a.git_review.automatic.lock().unwrap().contains_key(&a.project) { used(&a); } status(&a) }) {
        Ok(s) => Json(json!({"api":deck2_shared::API,"status":s})).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "project_unavailable", e),
    }
}
pub async fn ensure(
    State(app): State<App>,
    Query(q): Query<HashMap<String, String>>,
    Json(r): Json<Request>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    if r.api != deck2_shared::API {
        return problem(StatusCode::BAD_REQUEST, "api", "Unsupported API");
    }
    let app = match target(&app, &q) {
        Ok(a) => a,
        Err(e) => return problem(StatusCode::NOT_FOUND, "project_unknown", e),
    };
    match authority(&app){Ok(true)=>{},Ok(false)=>return Json(json!({"api":deck2_shared::API,"status":Status{phase:"paused".into(),..Default::default()}})).into_response(),Err(e)=>return problem(StatusCode::CONFLICT,"project_unavailable",e)}
    if !app.persistence_available() {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Indexing is paused because storage is unavailable",
        );
    }
    used(&app);
    start(&app, r.rebuild);
    inspect(State(app), Query(HashMap::new())).await
}
const IDLE_MS:u64=30*60*1000;
fn activity_key(project:&str)->String {format!("cbm-use:{}",crate::projects::id(project))}
fn in_use(app:&App, now:u64)->bool {
    let store=app.store.lock().unwrap();
    let recent=store.conn.query_row("SELECT value FROM meta WHERE key=?1",[activity_key(&app.project)],|r|r.get::<_,String>(0)).ok().and_then(|s|s.parse::<u64>().ok()).is_some_and(|last|now.saturating_sub(last)<IDLE_MS);
    recent || store.conn.query_row("SELECT EXISTS(SELECT 1 FROM receipts r JOIN sessions s ON s.id=json_extract(r.body,'$.session') WHERE json_extract(s.body,'$.project.root')=?1 AND json_extract(r.body,'$.phase') IN ('accepted','preparing','dispatching','running','cancelling'))",[&app.project],|r|r.get::<_,bool>(0)).unwrap_or(false)
}
// A retiring job keeps its slot until the native connection and rendezvous drain.
// A restart requests a replacement rather than creating a concurrent watcher.
#[derive(Clone)]
pub(crate) struct Job {
    tx: tokio::sync::mpsc::Sender<()>,
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    restart: std::sync::Arc<std::sync::atomic::AtomicBool>,
    settled: std::sync::Arc<std::sync::atomic::AtomicBool>,
}
impl Job {
    fn same_channel(&self, other:&Self)->bool {self.tx.same_channel(&other.tx)}
}
fn owns(app:&App,owner:&Job)->bool {
    !owner.cancelled.load(std::sync::atomic::Ordering::SeqCst) &&
        app.git_review.automatic.lock().unwrap().get(&app.project).is_some_and(|job|job.same_channel(owner))
}
pub(crate) fn stop(app:&App,project:&str){
    if let Some(job)=app.git_review.automatic.lock().unwrap().get(project){job.cancelled.store(true,std::sync::atomic::Ordering::SeqCst);let _=job.tx.try_send(());}
}
pub(crate) fn used(app:&App) {
    if authority(app)!=Ok(true) || !app.persistence_available() {return;}
    {let store=app.store.lock().unwrap();let last=store.conn.query_row("SELECT value FROM meta WHERE key=?1",[activity_key(&app.project)],|r|r.get::<_,String>(0)).ok().and_then(|s|s.parse::<u64>().ok()).unwrap_or(0);
    if crate::now().saturating_sub(last)>=60_000 {let _=store.conn.execute("INSERT INTO meta VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",rusqlite::params![activity_key(&app.project),crate::now().to_string()]);}}

    start(app,false);
}
pub(crate) fn resume(app:&App) {
    let roots:Vec<String>={let s=app.store.lock().unwrap();s.projects().unwrap_or_default().into_iter().map(|p|p.root).collect()};
    for project in roots {let a=App{inner:app.inner.clone(),project};if in_use(&a,crate::now()) && authority(&a)==Ok(true){start(&a,false);}}
}
fn finish(app:&App,project:&str,owner:&Job) {
    let mut jobs=app.git_review.automatic.lock().unwrap();
    if !jobs.get(project).is_some_and(|job|job.same_channel(owner)){return;}
    jobs.remove(project);
    drop(jobs);
    if owner.restart.load(std::sync::atomic::Ordering::SeqCst) && authority(app)==Ok(true) && in_use(app,crate::now()) {start(app,false);}
}
fn enabled(app:&App)->bool {app.store.lock().unwrap().external_settings().is_ok_and(|s|s.codebase_memory)}
fn start(app: &App, rebuild: bool) {
    if !enabled(app){return;}
    let mut jobs=app.git_review.automatic.lock().unwrap();
    if let Some(job)=jobs.get(&app.project){
        if job.cancelled.load(std::sync::atomic::Ordering::SeqCst){job.restart.store(true,std::sync::atomic::Ordering::SeqCst);}
        else if rebuild{let _=job.tx.try_send(());}
        return;
    }
    let (tx,mut rx)=tokio::sync::mpsc::channel(1);
    let owner=Job{tx,cancelled:Default::default(),restart:Default::default(),settled:std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true))};jobs.insert(app.project.clone(),owner.clone());
    let weak=std::sync::Arc::downgrade(&app.inner);let project=app.project.clone();
    tokio::spawn(async move {
        let mut runtime=None;let mut client=None;let mut index=true;
        async { loop {
            let Some(inner)=weak.upgrade() else{return;};let app=App{inner,project:project.clone()};
            if !owns(&app,&owner){return;}
            // Keep the global index admission permit through inventory and indexing.
            let permit=if index {match app.git_review.auto_gate.clone().acquire_owned().await{Ok(p)=>Some(p),Err(_)=>return}}else{None};
            if !owns(&app,&owner)||authority(&app)!=Ok(true)||!in_use(&app,crate::now())||!enabled(&app){return;}
            if index {
                #[cfg(test)] if let Some(tx)=app.git_review.native_starts.lock().unwrap().as_ref(){let _=tx.send(owner.tx.clone());return;}
                if client.is_none() && let Err(e)=crate::external_tools::bound_cbm().await {
                    if owns(&app,&owner){let _=save(&app,&Status{phase:"unavailable".into(),detail:Some(e),..Default::default()});}return;
                }
                if !owns(&app,&owner){return;}
                let checked=app.clone();let worker=owner.clone();let previous=client.take();
                let result=tokio::task::spawn_blocking(move || native_index(&checked,previous,&worker)).await;
                match result {
                    Ok(Ok((next,dir,files)))=>{
                        client=Some(next);if let Some(dir)=dir {runtime=Some(dir);}
                        if !owns(&app,&owner)||authority(&app)!=Ok(true)||!enabled(&app){return;}
                        let _=save(&app,&Status{phase:"indexed".into(),updated_ms:Some(crate::now()),files:Some(files),detail:Some("CBM native index and watcher".into()),..Default::default()});
                    }
                    result=>{
                        let message=match result {Ok(Err(e))=>e,_=>"Code index task interrupted".into()};
                        if owns(&app,&owner)&&authority(&app)==Ok(true){let _=save(&app,&Status{phase:if message.contains("Too large"){"too_large"}else{"unavailable"}.into(),detail:Some(message),..Default::default()});}
                        return;
                    }
                }
            }
            if let Some(mut current)=client.take(){
                let checked=app.clone();let worker=owner.clone();
                match tokio::task::spawn_blocking(move||{let health=native_health(&mut current,&checked,&worker)?;Ok::<_,String>((current,health))}).await {
                    Ok(Ok((current,health)))=>{
                        client=Some(current);
                        let mut status=load(&app.store.lock().unwrap(),&project).unwrap_or_default();
                        let timestamp=health["indexed_at"].as_str().map(str::to_owned);
                        let phase=if health["status"]=="ready"{"indexed"}else{"indexing"};
                        if owns(&app,&owner) && (timestamp!=status.indexed_at || status.phase!=phase) {
                            status.indexed_at=timestamp;status.phase=phase.into();let _=save(&app,&status);
                        }
                    }
                    _=>{if owns(&app,&owner){let _=save(&app,&Status{phase:"unavailable".into(),detail:Some("Native code index watcher unavailable".into()),..Default::default()});}return;}
                }
            }
            drop(permit);drop(app);
            // No scheduled reindex: the live MCP session owns CBM's native watch.
            // Wake only to check activity/trust and process an explicit rebuild.
            index=tokio::select!{_ = tokio::time::sleep(Duration::from_secs(5))=>false,v=rx.recv()=>{if v.is_none(){return;}true}};
            // Retain the isolated rendezvous until the native client has drained.
            let _=&runtime;
        }}.await;
        // Client settlement precedes rendezvous cleanup and releasing the slot.
        drop(client);
        if !owner.settled.load(std::sync::atomic::Ordering::SeqCst){
            if let Some(dir)=runtime{let _=dir.keep();}
            return; // Keep the project slot when process settlement is uncertain.
        }
        drop(runtime);
        if let Some(inner)=weak.upgrade(){let app=App{inner,project:project.clone()};finish(&app,&project,&owner);}
    });
}
fn native_health(client:&mut crate::cbm_runtime::Client,app:&App,owner:&Job)->Result<Value,String>{
    let value=client.rpc_checked("tools/call",json!({"name":"index_status","arguments":{"project":app.project,"format":"json"}}),Duration::from_secs(10),||if owns(app,owner)&&authority(app)==Ok(true)&&enabled(app){Ok(())}else{Err("Project authority changed".into())})?;
    let body=if value["structuredContent"].is_object(){value["structuredContent"].clone()}else{
        let text=value["content"].as_array().and_then(|v|v.iter().find_map(|c|c["text"].as_str())).ok_or("Native code index status unavailable")?;
        serde_json::from_str::<Value>(text).map_err(|_|"Native code index status invalid")?
    };
    if value["isError"]==true || body["root_path"]!=app.project || body["watch"]["watched"]!=true{return Err("Native code index watcher unavailable".into());}
    Ok(body)
}
fn native_index(app:&App,previous:Option<crate::cbm_runtime::Client>,owner:&Job)->Result<(crate::cbm_runtime::Client,Option<tempfile::TempDir>,usize),String>{
    let _permit=app.git_review.gate.clone().try_acquire_owned().map_err(|_|"Another code scan is running")?;
    let permit=std::sync::Arc::new(_permit);
    let deadline=std::time::Instant::now()+Duration::from_secs(120);
    let check=||{if !owns(app,owner)||authority(app)!=Ok(true)||!enabled(app){Err("Project trust or tool selection changed".into())}else if std::time::Instant::now()>deadline{Err("Code index deadline".into())}else{Ok(())}};
    let paths=crate::git_review::project_source_paths_checked(std::path::Path::new(&app.project),permit.clone(),&check)?;
    check()?;
    let mut state=Status{phase:"indexing".into(),files:Some(paths.len()),..Default::default()};save(app,&state)?;
    let (mut client,runtime)=if let Some(client)=previous{(client,None)}else{
        let dir=tempfile::Builder::new().prefix("d2watch-").tempdir_in("/tmp").map_err(|_|"CBM runtime unavailable")?;
        let spec=json!({"command":crate::external_tools::executable(crate::external_tools::Tool::CodebaseMemory)?,"cwd":app.project,"env":{"CBM_RUNTIME_DIR":dir.path(),"PWD":app.project,"CBM_ALLOWED_ROOT":app.project}});
        let client=match crate::cbm_runtime::Client::native_tracked(&spec,&crate::cbm_runtime::native_environment(&spec)?,owner.settled.clone()){
            Ok(client)=>client,
            Err(e)=>{if !owner.settled.load(std::sync::atomic::Ordering::SeqCst){let _=dir.keep();}return Err(e);}
        };
        (client,Some(dir))
    };
    let result=(||{
        check()?;
        let result=client.rpc_checked("tools/call",json!({"name":"index_repository","arguments":{"repo_path":app.project,"mode":"fast"}}),deadline.saturating_duration_since(std::time::Instant::now()),&check)?;
        if result["isError"]==true{return Err("CBM could not index this project".into());}
        check()
    })();
    if let Err(e)=result {
        drop(client);
        if !owner.settled.load(std::sync::atomic::Ordering::SeqCst) && let Some(dir)=runtime{let _=dir.keep();}
        return Err(e);
    }
    state.phase="indexed".into();
    Ok((client,runtime,paths.len()))
}
#[cfg(test)]
async fn body(r: Response) -> Result<Value, String> {
    let ok = r.status().is_success();
    let bytes = axum::body::to_bytes(r.into_body(), 256 * 1024 * 1024)
        .await
        .map_err(|_| "Index response unavailable")?;
    let v: Value = serde_json::from_slice(&bytes).map_err(|_| "Index response invalid")?;
    if !ok {
        return Err(format!(
            "{}: {}",
            v["code"].as_str().unwrap_or("indexing"),
            v["message"].as_str().unwrap_or("Indexing could not finish")
        ));
    }
    Ok(v)
}
// Run outside the executor and before creating another generation. Retained
// superseded leases delay refresh rather than accumulating snapshots.
#[cfg(test)]
pub(crate) fn retire_previous(app:&App)->Result<bool,String>{
    let (root,selected,owned)={let store=app.store.lock().unwrap();
        // Ownership outlives the operation and review retention windows.
        let mut q=store.conn.prepare("SELECT service FROM cbm_automatic_services WHERE project=?1").map_err(|_|"Cannot inspect automatic ownership")?;
        let ids=q.query_map([&app.project],|r|r.get::<_,String>(0)).map_err(|_|"Cannot inspect automatic ownership")?.collect::<Result<Vec<_>,_>>().map_err(|_|"Cannot inspect automatic ownership")?;
        (app.artifact_root()?,store.configuration_for(&app.project)?.cbm.map(|b|b.service),ids)};
    for id in owned {
        if selected.as_ref()==Some(&id){continue;}
        // Already retired generations have no directory. All other errors belong
        // to this project's attributed service and must remain visible to it.
        if !root.join("cbm-services").join(&id).try_exists().map_err(|_|"Cannot inspect owned code index")? {
            let store=app.store.lock().unwrap();
            if store.cbm_service_retired(&app.project,&id)? {
                store.conn.execute("DELETE FROM cbm_automatic_services WHERE project=?1 AND service=?2",rusqlite::params![app.project,id]).map_err(|_|"Cannot finish code index retirement")?;
                continue;
            }
            return Err("Owned code index is missing".into());
        }
        let service=crate::cbm_service::Service::open(&root,&id)?;
        {let _gate=service.gate()?;let mut record=service.record()?;
         if record.automatic_project.as_deref().is_some_and(|p|p!=app.project){return Err("Code index ownership conflicts".into());}
         if record.automatic_project.is_none(){record.automatic_project=Some(app.project.clone());service.save(&record)?;}}
        if !service.retire_with(||app.store.lock().unwrap().retire_cbm_service(&app.project,&id))? {return Ok(false);}
        // Remove only after filesystem retirement completes; failures and active
        // reservations keep cleanup authority for the next pass/restart.
        app.store.lock().unwrap().conn.execute("DELETE FROM cbm_automatic_services WHERE project=?1 AND service=?2",rusqlite::params![app.project,id]).map_err(|_|"Cannot finish code index retirement")?;
    }
    Ok(true)
}
#[cfg(test)]
async fn capture_current(app:&App)->Result<crate::cbm_service::Snapshot,String>{
            let permit = app
                .git_review
                .gate
                .clone()
                .try_acquire_owned()
                .map_err(|_| "Another code scan is running")?;
            let project = app.project.clone();
            let checked=app.clone();
            tokio::task::spawn_blocking(move || {
                let permit=std::sync::Arc::new(permit);
                let end=std::time::Instant::now()+Duration::from_secs(120);
                let check=|| {if std::time::Instant::now()>end {return Err("Code scan deadline".into());} if authority(&checked)==Ok(true){Ok(())}else{Err("Project trust changed".into())}};
                let paths = crate::git_review::project_source_paths_checked(std::path::Path::new(&project),permit.clone(),&check)?;
                #[cfg(test)] let calls=std::cell::Cell::new(0);
                crate::cbm_service::Snapshot::capture_checked(std::path::Path::new(&project), &paths,||{
                    check()?;
                    #[cfg(test)] {calls.set(calls.get()+1);if calls.get()==3 {if let Some((reached,resume))=checked.git_review.scan_pause.lock().unwrap().take(){let _=reached.send(());let _=resume.recv_timeout(Duration::from_secs(3));check()?;}}}
                    Ok(())
                })
            })
            .await
            .map_err(|_| "Index scan interrupted")?

}
#[cfg(test)]
async fn refresh(app: &App, rebuild: bool) -> Result<(), String> {
    let mut state = load(&app.store.lock().unwrap(), &app.project)?;
    if state.operation.is_none(){let a=app.clone();if !tokio::task::spawn_blocking(move||retire_previous(&a)).await.map_err(|_|"Code index retirement interrupted")?? {return Ok(());}}
    let q = HashMap::from([("projectId".into(), crate::projects::id(&app.project))]);
    // Retain and reconcile the exact durable operation after delivery loss/restart.
    if state.operation.is_none() {
        state.phase = "indexing".into();
        state.detail = None;
        save(app, &state)?;
        let selected = app
            .store
            .lock()
            .unwrap()
            .configuration_for(&app.project)?
            .cbm;
        if let Some(binding) = selected.filter(|_| !rebuild) {
            let captured = capture_current(app).await?;
            if authority(app) != Ok(true) {
                return Err("Project trust changed".into());
            }
            if binding.snapshot == captured.digest {
                let root = std::path::Path::new(&binding.store);
                let service = crate::cbm_service::Service::open(root, &binding.service)?;
                let record = service.record()?;
                if record.phase == "ready"
                    && record.admission_open
                    && service.check_supervisor().is_ok()
                {
                    state.files = Some(captured.files.len());
                    state.phase = "indexed".into();
                    state.updated_ms.get_or_insert_with(crate::now);
                    save(app, &state)?;
                    return Ok(());
                }
            }
        }
        let revision = app
            .store
            .lock()
            .unwrap()
            .configuration_for(&app.project)?
            .revision;
        let p = body(
            cbm::plan(
                ProjectState(app.clone()),
                Query(q.clone()),
                Json(cbm::PlanRequest {
                    api: deck2_shared::API,
                    expected_revision: revision,
                    action: "prepare_project".into(),
                    paths: vec![],
                    service: None,
                    operation: None,
                    root: None,
                }),
            )
            .await,
        )
        .await?;
        state.files = p["plan"]["snapshot"]["files"].as_object().map(|f| f.len());
        state.plan = Some(p["plan"]["id"].as_str().ok_or("Missing index plan")?.into());
        state.operation = Some(uuid::Uuid::new_v4().to_string());
        save(app, &state)?;
    }
    let op = state
        .operation
        .clone()
        .ok_or("Missing indexing operation")?;
    let admitted = body(
        cbm::apply(
            ProjectState(app.clone()),
            Path(state.plan.clone().ok_or("Missing indexing plan")?),
            Query(q),
            Json(cbm::Apply {
                api: deck2_shared::API,
                operation_id: op.clone(),
                allow: true,
            }),
        )
        .await,
    )
    .await;
    if let Err(e) = admitted {
        // Only the typed non-admission outcome permits a new identity. Delivery
        // loss or any uncertain outcome keeps the original plan/operation.
        if e.starts_with("cbm_not_applied:") {
            state.operation = None;
            state.plan = None;
            save(app, &state)?;
        }
        return Err(e);
    }
    // Native work is supervised elsewhere. No store lock spans a wait.
    for _ in 0..240 {
        let o = app.store.lock().unwrap().cbm_operation(&op)?;
        match o.phase.as_str() {
            "prepared" => {
                state.phase = "indexed".into();
                state.updated_ms = Some(crate::now());
                state.detail = None;
                state.operation = None;
                state.plan = None;
                save(app, &state)?;
                return Ok(());
            }
            "not_applied" | "denied" => {
                state.operation = None;
                state.plan = None;
                save(app, &state)?;
                return Err(o.detail);
            }
            "recovery_required" => return Err(o.detail),
            _ => {}
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err("Indexing is taking longer than expected; its operation is retained".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture()->(tempfile::TempDir,App){
        let d=tempfile::tempdir().unwrap();let app=App::new(Store::open_memory(d.path().to_str().unwrap()).unwrap(),"127.0.0.1:1234".into(),"/missing".into(),None,"admin".into(),"recover".into());
        app.store.lock().unwrap().set_trust(&app.project,true).unwrap();(d,app)
    }
    // Protects automatic refresh isolation from incomplete foreign/unknown services.
    // Oracle: only the project with durable ownership may fail on its bad journal;
    // healthy projects reach scan admission and unknown directories survive unchanged.
    #[tokio::test]
    async fn settings_model_automatic_retirement_isolates_incomplete_services(){
        let (d,app)=fixture();
        let artifacts=tempfile::tempdir().unwrap();
        *app.artifact_store.lock().unwrap()=Some(artifacts.path().into());
        let other=d.path().join("other");std::fs::create_dir(&other).unwrap();
        let b={let mut s=app.store.lock().unwrap();s.register_project(other.to_str().unwrap()).unwrap();s.set_trust(other.to_str().unwrap(),true).unwrap();
            let c=s.configuration_for(other.to_str().unwrap()).unwrap();
            let p=cbm::Plan{target:None,id:"foreign-auto-plan".into(),host:c.host_id,revision:c.revision,store:artifacts.path().to_str().unwrap().into(),request:cbm::PlanRequest{api:deck2_shared::API,expected_revision:c.revision,action:"prepare_project".into(),paths:vec![],service:None,operation:None,root:None},snapshot:None,binding:None,instruction:String::new()};
            let o=cbm::Operation{execution_target:None,id:"foreign-auto-op".into(),plan:p.id.clone(),allow:true,phase:"prepared".into(),detail:String::new(),service:Some("b".repeat(64)),effect_started:Some(true)};
            s.conn.execute("INSERT INTO cbm_plans VALUES(?1,?2)",rusqlite::params![p.id,serde_json::to_string(&p).unwrap()]).unwrap();
            s.conn.execute("INSERT INTO cbm_operations VALUES(?1,?2,?3)",rusqlite::params![o.id,o.plan,serde_json::to_string(&o).unwrap()]).unwrap();
            App{inner:app.inner.clone(),project:other.to_str().unwrap().into()}};
        app.store.lock().unwrap().init_cbm().unwrap();
        let parent=artifacts.path().join("cbm-services");
        for id in ["a".repeat(64),"b".repeat(64)] {let path=parent.join(id);std::fs::create_dir_all(&path).unwrap();std::fs::set_permissions(&path,artifacts.path().metadata().unwrap().permissions()).unwrap();}
        std::fs::set_permissions(&parent,artifacts.path().metadata().unwrap().permissions()).unwrap();
        let permit=app.git_review.gate.clone().acquire_owned().await.unwrap();
        let error=refresh(&app,false).await.unwrap_err();
        assert!(error.contains("scan"),"healthy refresh failed before scan admission: {error}");
        let owner_error=refresh(&b,false).await.unwrap_err();
        assert!(!owner_error.contains("scan"),"owner skipped its incomplete service: {owner_error}");
        let expected=crate::cbm_service::Service::open(artifacts.path(),&"b".repeat(64)).and_then(|s|s.record()).err().unwrap();
        assert_eq!(owner_error,expected);
        assert!(parent.join("a".repeat(64)).is_dir());assert!(parent.join("b".repeat(64)).is_dir());
        assert_eq!(std::fs::read_dir(parent.join("a".repeat(64))).unwrap().count(),0);
        drop(permit);
    }

    // SM-Q2/Q5: the automatic comparison capture owns scan admission until all
    // bytes are read; revocation while suspended aborts and releases admission.
    // Protects scan admission through capture and cancellation on trust revocation.
    #[tokio::test(flavor="current_thread")]
    async fn settings_model_automatic_capture_holds_admission_and_cancels(){
        let (_d,app)=fixture();std::fs::write(std::path::Path::new(&app.project).join("a.rs"),"fn a(){}\n").unwrap();std::fs::write(std::path::Path::new(&app.project).join("b.rs"),"fn b(){}\n").unwrap();
        let (tx,rx)=tokio::sync::oneshot::channel();let (resume,wait)=std::sync::mpsc::channel();
        *app.git_review.scan_pause.lock().unwrap()=Some((tx,wait));
        let worker=app.clone();let task=tokio::spawn(async move{capture_current(&worker).await});
        tokio::time::timeout(Duration::from_secs(3),rx).await.unwrap().unwrap();
        assert!(app.git_review.gate.clone().try_acquire_owned().is_err());
        app.store.lock().unwrap().set_trust(&app.project,false).unwrap();resume.send(()).unwrap();
        assert!(task.await.unwrap().is_err());assert!(app.git_review.gate.clone().try_acquire_owned().is_ok());
    }

    // Protects idle-project expiry using an injected timestamp without sleeps.
    #[test]
    fn settings_model_idle_lease_expires_without_a_session(){
        let (_d,app)=fixture();let now=crate::now();
        app.store.lock().unwrap().conn.execute("INSERT INTO meta VALUES(?1,?2)",rusqlite::params![activity_key(&app.project),now.to_string()]).unwrap();
        assert!(in_use(&app,now));assert!(!in_use(&app,now+IDLE_MS+1));
    }

    // Protects restart while a retired worker waits for scan admission.
    // Oracle: only the replacement may reach the native process boundary while
    // trust, activity and enablement remain valid throughout the race.
    #[tokio::test(flavor="current_thread")]
    async fn native_restart_cancels_worker_waiting_for_admission(){
        let (_d,app)=fixture();
        let (tx,mut rx)=tokio::sync::mpsc::unbounded_channel();
        *app.git_review.native_starts.lock().unwrap()=Some(tx);
        used(&app);tokio::task::yield_now().await;
        let old=app.git_review.automatic.lock().unwrap().get(&app.project).unwrap().clone();
        stop(&app,&app.project);resume(&app);
        app.git_review.auto_gate.add_permits(1);
        let next=tokio::time::timeout(Duration::from_secs(3),rx.recv()).await.unwrap().unwrap();
        assert!(!next.same_channel(&old.tx),"retired worker reached native indexing after restart");
        tokio::task::yield_now().await;
        assert!(rx.try_recv().is_err(),"duplicate native worker");
        assert!(app.git_review.automatic.lock().unwrap().is_empty());
    }

    // SM-Q3/Q4 oracle: use deduplicates, idle expiry removes the job; only recent
    // registered trusted projects resume at startup, without opening settings.
    // Protects activity deduplication, restart resumption and retiring-job ownership.
    #[tokio::test]
    async fn settings_model_activity_lease_dedup_and_restart(){
        let (_d,app)=fixture();app.git_review.auto_gate.add_permits(1);let gate=app.git_review.auto_gate.clone().acquire_owned().await.unwrap();
        used(&app);used(&app);
        assert_eq!(app.git_review.automatic.lock().unwrap().len(),1);
        assert!(in_use(&app,crate::now()));assert!(!in_use(&app,crate::now()+IDLE_MS+1));
        let prior=app.git_review.automatic.lock().unwrap().get(&app.project).unwrap().clone();
        stop(&app,&app.project);assert_eq!(app.git_review.automatic.lock().unwrap().len(),1);
        resume(&app);assert_eq!(app.git_review.automatic.lock().unwrap().len(),1);
        assert!(prior.cancelled.load(std::sync::atomic::Ordering::SeqCst));
        app.store.lock().unwrap().conn.execute("UPDATE meta SET value='0' WHERE key=?1",[activity_key(&app.project)]).unwrap();
        drop(gate);
        for _ in 0..100 {if app.git_review.automatic.lock().unwrap().is_empty(){break;}tokio::task::yield_now().await;}
        assert!(app.git_review.automatic.lock().unwrap().is_empty());
        let s=app.store.lock().unwrap();assert_eq!(s.conn.query_row("SELECT count(*) FROM cbm_plans",[],|r|r.get::<_,i64>(0)).unwrap(),0);drop(s);
        app.store.lock().unwrap().set_trust(&app.project,false).unwrap();used(&app);resume(&app);
        assert!(app.git_review.automatic.lock().unwrap().is_empty());
    }
}

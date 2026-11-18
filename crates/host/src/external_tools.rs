#[path = "tool_updates.rs"]
mod updates;
#[path = "rtk_runners.rs"]
pub mod runners;
// Host-wide tool intent and standard tool locations. Installers own their artifacts.
use crate::{Store, server::{App, problem}};
use axum::{Json, extract::{State, Path}, response::{IntoResponse, Response}, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use rusqlite::OptionalExtension;
use std::{path::{Path as FsPath, PathBuf}, time::Duration};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all="kebab-case")]
pub enum Tool { CodebaseMemory, Rtk, Context7 }
impl Tool {
    pub const ALL:[Self;3]=[Self::CodebaseMemory,Self::Rtk,Self::Context7];
    pub fn executable(self, home:&FsPath)->PathBuf {home.join(".local/bin").join(match self {Self::CodebaseMemory=>"codebase-memory-mcp",Self::Rtk=>"rtk",Self::Context7=>"context7-mcp"})}
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {pub codebase_memory:bool,pub rtk:bool,pub context7:bool}
impl Settings {
    pub fn enabled(&self,t:Tool)->bool {match t {Tool::CodebaseMemory=>self.codebase_memory,Tool::Rtk=>self.rtk,Tool::Context7=>self.context7}}
    fn set(&mut self,t:Tool,v:bool) {match t {Tool::CodebaseMemory=>self.codebase_memory=v,Tool::Rtk=>self.rtk=v,Tool::Context7=>self.context7=v}}
}
impl Store {
    pub(crate) fn init_external_tools(&self)->Result<(),String>{
        let settings=self.external_settings()?;
        let exists=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM meta WHERE key='external_tools_v1')",[],|r|r.get::<_,bool>(0)).map_err(|_|"Cannot inspect tool migration")?;
        if exists{return Ok(());}
        self.conn.execute_batch("SAVEPOINT external_tools").map_err(|_|"Cannot begin tool migration")?;
        let result=(||{
            // Preserve intent before removing private selections from new work.
            // Historical revisions and admitted snapshots remain immutable.
            self.set_external(&settings)?;self.select_host_helper(None)?;Ok::<_,String>(())
        })();
        if result.is_ok(){self.conn.execute_batch("RELEASE external_tools").map_err(|_|"Cannot commit tool migration")?;}
        else{let _=self.conn.execute_batch("ROLLBACK TO external_tools; RELEASE external_tools");}
        result
    }
    pub(crate) fn external_settings(&self)->Result<Settings,String>{
        let value=self.conn.query_row("SELECT value FROM meta WHERE key='external_tools_v1'",[],|r|r.get::<_,String>(0)).optional().map_err(|_|"Cannot read tool settings")?;
        if let Some(value)=value {return serde_json::from_str(&value).map_err(|_|"Invalid tool settings".into());}
        // Preserve previous global RTK intent; CBM was automatic, Context7 is opt-in.
        let rtk=self.conn.query_row("SELECT value FROM meta WHERE key='host_rtk'",[],|r|r.get::<_,String>(0)).optional().map_err(|_|"Cannot read RTK selection")?.is_some_and(|v|v!="null");
        Ok(Settings{codebase_memory:true,rtk,context7:false})
    }
    fn set_external(&self,settings:&Settings)->Result<(),String>{
        self.conn.execute("INSERT INTO meta VALUES('external_tools_v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(settings).map_err(|_|"Cannot encode tool settings")?]).map_err(|_|"Cannot save tool settings")?;
        Ok(())
    }
}
pub(crate) fn home()->Result<PathBuf,String>{std::env::var_os("HOME").map(PathBuf::from).filter(|p|p.is_absolute()).ok_or("Home unavailable".into())}
pub(crate) fn executable(t:Tool)->Result<PathBuf,String>{Ok(t.executable(&home()?))}
#[derive(Serialize)]
pub struct Status {id:Tool,enabled:bool,installed:bool,version:Option<String>,update:updates::Update,runners:Vec<runners::RunnerStatus>}
async fn version(t:Tool,home:&FsPath)->Option<String>{
    let exe=t.executable(home);
    if !exe.is_file(){return None;}
    if t==Tool::Context7 {
        let body=tokio::fs::read(home.join(".local/lib/node_modules/@upstash/context7-mcp/package.json")).await.ok()?;
        let v:Value=serde_json::from_slice(&body).ok()?;
        return v["version"].as_str().filter(|s|s.len()<80 && !s.chars().any(char::is_control)).map(str::to_owned);
    }
    let mut c=tokio::process::Command::new(exe);c.arg("--version");
    let b=run(c,Duration::from_secs(5)).await.ok()?;
    let s=String::from_utf8(b).ok()?;
    s.split_whitespace().last().filter(|s|s.len()<80).map(str::to_owned)
}
pub async fn inspect(State(app):State<App>)->Response{
    let settings=match app.store.lock().unwrap().external_settings(){Ok(s)=>s,Err(e)=>return problem(StatusCode::CONFLICT,"tool_settings",e)};
    let home=match home(){Ok(p)=>p,Err(e)=>return problem(StatusCode::CONFLICT,"tool_home",e)};
    let mut statuses=vec![];
    let row=|t| {let home=&home;let settings=&settings;async move {
        let v=version(t,home).await;let update=updates::check(t,v.as_deref(),false).await;
        let runners=if t==Tool::Rtk{runners::statuses(home).await}else{vec![]};
        Status{id:t,enabled:settings.enabled(t),installed:v.is_some(),version:v,update,runners}
    }};
    let (a,b,c)=tokio::join!(row(Tool::CodebaseMemory),row(Tool::Rtk),row(Tool::Context7));
    statuses.extend([a,b,c]);
    Json(json!({"api":deck2_shared::API,"tools":statuses})).into_response()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {api:u32,action:Action,enabled:Option<bool>}
#[derive(Deserialize,Clone,Copy)]
#[serde(rename_all="snake_case")]
enum Action{Install,Update,Enable,CheckUpdates}
// One host-level installer at a time; no Store mutex held during subprocess work.
static INSTALL:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());
pub async fn change(State(app):State<App>,Path(tool):Path<Tool>,Json(r):Json<Request>)->Response{
    if let Some(r)=crate::web_identity::effect_denied(){return r;}
    if r.api!=deck2_shared::API{return problem(StatusCode::BAD_REQUEST,"api","Unsupported API");}
    if !app.persistence_available(){return problem(StatusCode::SERVICE_UNAVAILABLE,"storage","Tool settings are unavailable");}
    let _gate=match INSTALL.try_lock(){Ok(g)=>g,Err(_)=>return problem(StatusCode::CONFLICT,"tool_busy","Another tool change is running")};
    let result=async {
        match r.action {
            Action::Enable=>{
                let enabled=r.enabled.ok_or("Choose whether the tool is enabled")?;
                let store=app.store.lock().unwrap();let mut settings=store.external_settings()?;settings.set(tool,enabled);store.set_external(&settings)?;
            }
            Action::CheckUpdates=>{
                if r.enabled.is_some(){return Err("Update check cannot change enablement".into());}
                let v=version(tool,&home()?).await;
                updates::check(tool,v.as_deref(),true).await;
            }
            Action::Install|Action::Update=>{
                if r.enabled.is_some(){return Err("Installer request cannot change enablement".into());}
                if matches!(r.action,Action::Update) {
                    let v=version(tool,&home()?).await;
                    if !matches!(updates::check(tool,v.as_deref(),false).await,updates::Update::Available{..}) {
                        return Err("No newer version is confirmed. Check for updates and try again.".into());
                    }
                }
                install(tool,&home()?).await?;
                updates::invalidate(tool).await;
            }
        }
        Ok::<_,String>(())
    }.await;
    if let Err(e)=result {return problem(StatusCode::CONFLICT,"tool_change_failed",e);}
    if tool==Tool::CodebaseMemory && !matches!(r.action,Action::CheckUpdates) {
        let roots=app.store.lock().unwrap().projects().unwrap_or_default();
        for p in roots {crate::cbm_automatic::stop(&app,&p.root);}
        crate::cbm_automatic::resume(&app);
    }
    inspect(State(app)).await
}
// A bounded process group, including installer descendants and output drain.
async fn run(mut command:tokio::process::Command,limit:Duration)->Result<Vec<u8>,String>{
    use tokio::io::AsyncReadExt;
    use std::process::Stdio;
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true).process_group(0);
    let mut child=command.spawn().map_err(|_|"Tool command could not start")?;
    let pid=child.id().ok_or("Tool process missing")?;
    struct Group(u32);impl Drop for Group{fn drop(&mut self){unsafe{libc::kill(-(self.0 as i32),libc::SIGKILL);}}}
    let _group=Group(pid);
    let out=child.stdout.take().unwrap();let err=child.stderr.take().unwrap();
    let work=async {
        let mut stdout=vec![];let mut stderr=vec![];
        let mut out=out.take(1024*1024+1);let mut err=err.take(1024*1024+1);
        let (status,a,b)=tokio::join!(child.wait(),out.read_to_end(&mut stdout),err.read_to_end(&mut stderr));
        if a.is_err()||b.is_err()||stdout.len()>1024*1024||stderr.len()>1024*1024{return Err("Tool output exceeded its limit".into());}
        if !status.map_err(|_|"Tool process unavailable")?.success(){return Err("Tool command failed. Check network access and the tool installer; refresh to see the current installation.".into());}
        Ok(stdout)
    };
    tokio::time::timeout(limit,work).await.map_err(|_|"Tool command exceeded its deadline")?
}
fn installer_url(t:Tool)-> &'static str {match t {Tool::CodebaseMemory=>"https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh",Tool::Rtk=>"https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh",Tool::Context7=>""}}
async fn install(t:Tool,home:&FsPath)->Result<(),String>{
    let mut c;
    let _script;
    if t==Tool::Context7 {
        c=tokio::process::Command::new("npm");
        c.args(["install","--global","--ignore-scripts","--no-audit","--no-fund","--prefix"]).arg(home.join(".local")).arg("@upstash/context7-mcp@latest");
    }else{
        _script=tempfile::tempdir().map_err(|_|"Installer scratch unavailable")?;
        let path=_script.path().join("install.sh");
        // Download only the upstream installer; binary acquisition, checksums and
        // publication belong to that installer, not a Deck release catalog.
        let mut fetch=tokio::process::Command::new("curl");
        fetch.args(["--fail","--silent","--show-error","--location","--proto","=https","--proto-redir","=https","--max-time","30","--output"]).arg(&path).arg(installer_url(t));
        run(fetch,Duration::from_secs(35)).await?;
        c=tokio::process::Command::new(if t==Tool::CodebaseMemory{"bash"}else{"sh"});c.arg(path);
        if t==Tool::CodebaseMemory {c.arg("--skip-config").arg(format!("--dir={}",home.join(".local/bin").display()));}
        else {c.env("RTK_INSTALL_DIR",home.join(".local/bin"));}
    }
    c.env("HOME",home);
    // --skip-config suppresses client registration, but native activation still
    // edits shell profiles even when the destination is already on PATH. Keep
    // activation state and shell writes in a disposable home; --dir above is
    // the explicit standard executable destination used by detection/runtime.
    let sandbox=if t==Tool::CodebaseMemory {
        let dir=tempfile::Builder::new().prefix("d2install-").tempdir().map_err(|_|"Installer home unavailable")?;
        c.env("HOME",dir.path())
            .env("XDG_CONFIG_HOME",dir.path().join(".config"))
            .env("XDG_DATA_HOME",dir.path().join(".local/share"))
            .env("XDG_CACHE_HOME",dir.path().join(".cache"))
            .env("CBM_CACHE_DIR",dir.path().join(".cache/codebase-memory-mcp"))
            .env("CBM_RUNTIME_DIR",dir.path())
            .env("XDG_RUNTIME_DIR",dir.path());
        Some(dir)
    }else{None};
    // Do not let a runner's inherited npm/CBM testing overrides retarget installs.
    for key in ["CBM_DOWNLOAD_URL","RTK_SKIP_CHECKSUM","RTK_VERSION","NPM_CONFIG_PREFIX","npm_config_prefix"]{c.env_remove(key);}
    run(c,Duration::from_secs(180)).await?;
    drop(sandbox);
    if version(t,home).await.is_none(){return Err("Installer finished but the standard executable could not be detected".into());}
    Ok(())
}
/// Use the tool's own standard config; preserve stricter user limits. The
/// watcher shares these native limits, so later additions remain bounded too.
pub(crate) async fn bound_cbm()->Result<(),String>{
    let runtime=tempfile::Builder::new().prefix("d2limits-").tempdir_in("/tmp").map_err(|_|"CBM configuration runtime unavailable")?;
    for (key,maximum) in [("index_max_files",50_000u64),("index_max_source_mb",128u64)] {
        let mut get=tokio::process::Command::new(executable(Tool::CodebaseMemory)?);
        get.args(["config","get",key]).env("CBM_RUNTIME_DIR",runtime.path());
        let value=run(get,Duration::from_secs(10)).await?;
        let text=String::from_utf8(value).map_err(|_|"CBM limit unavailable")?;
        let current=text.trim().parse::<u64>().ok();
        if text.trim()!="off" && current.is_none(){return Err("CBM limit could not be read".into());}
        if current.is_none_or(|n|n==0||n>maximum){
            let mut set=tokio::process::Command::new(executable(Tool::CodebaseMemory)?);
            set.args(["config","set",key,&maximum.to_string()]).env("CBM_RUNTIME_DIR",runtime.path());
            run(set,Duration::from_secs(10)).await?;
        }
    }
    for key in ["auto_watch","watcher_enabled","watch_non_git"] {
        let mut get=tokio::process::Command::new(executable(Tool::CodebaseMemory)?);
        get.args(["config","get",key]).env("CBM_RUNTIME_DIR",runtime.path());
        let value=run(get,Duration::from_secs(10)).await?;
        if String::from_utf8_lossy(&value).trim()!="true" {
            let mut set=tokio::process::Command::new(executable(Tool::CodebaseMemory)?);
            set.args(["config","set",key,"true"]).env("CBM_RUNTIME_DIR",runtime.path());
            run(set,Duration::from_secs(10)).await?;
        }
    }
    Ok(())
}
/// Launch-only overrides. Personal server names and policies are never rewritten.
pub(crate) fn servers(settings:&Settings,home:&FsPath,project:&FsPath,trusted:bool,readonly:bool)->Value{
    let mut entries=serde_json::Map::new();
    for (t,name) in [(Tool::CodebaseMemory,"deck-codebase-memory"),(Tool::Context7,"deck-context7")] {
        let exe=t.executable(home);
        let enabled=trusted && settings.enabled(t) && exe.is_file();
        let mut spec=json!({"command":exe,"args":[],"enabled":enabled,"required":false});
        if t==Tool::CodebaseMemory {spec["env"]=json!({"CBM_ALLOWED_ROOT":project,"PWD":project});}
        if readonly {spec["enabled_tools"]=if t==Tool::Context7{json!(["resolve-library-id","query-docs"])}else{json!(["search_graph","trace_path","get_code_snippet","check_index_coverage","query_graph","get_architecture","search_code","index_status","list_projects"])};}
        entries.insert(name.into(),spec);
    }
    Value::Object(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn executable_at(p:&FsPath,body:&str){std::fs::create_dir_all(p.parent().unwrap()).unwrap();std::fs::write(p,body).unwrap();std::fs::set_permissions(p,std::fs::Permissions::from_mode(0o755)).unwrap();}
    // Protects standard executable identity, read-only tool restrictions and trust.
    // Oracle: no private artifact or personal name is consulted; trust is required.
    #[tokio::test]
    async fn external_tools_detection_and_launch_share_standard_paths(){
        let d=tempfile::tempdir().unwrap();let h=d.path();
        let settings=Settings{codebase_memory:true,rtk:true,context7:true};
        assert!(version(Tool::Rtk,h).await.is_none());
        for t in Tool::ALL {executable_at(&t.executable(h),"#!/bin/sh\nprintf 'fixture 42.0.0\\n'\n");}
        let package=h.join(".local/lib/node_modules/@upstash/context7-mcp");std::fs::create_dir_all(&package).unwrap();std::fs::write(package.join("package.json"),r#"{"version":"42.0.0"}"#).unwrap();
        for t in Tool::ALL {assert_eq!(version(t,h).await.as_deref(),Some("42.0.0"));}
        let selected=servers(&settings,h,h,true,true);
        assert_eq!(selected["deck-codebase-memory"]["command"],Tool::CodebaseMemory.executable(h).to_str().unwrap());
        assert_eq!(selected["deck-context7"]["command"],Tool::Context7.executable(h).to_str().unwrap());
        assert_eq!(selected["deck-codebase-memory"]["env"]["CBM_ALLOWED_ROOT"],json!(h));
        assert_eq!(selected["deck-codebase-memory"]["env"]["PWD"],json!(h));
        assert!(selected.get("codebase-memory").is_none());assert!(selected.get("context7").is_none());
        assert!(!selected["deck-codebase-memory"]["enabled_tools"].as_array().unwrap().contains(&json!("index_repository")));
        assert!(servers(&settings,h,h,false,false).as_object().unwrap().values().all(|v|v["enabled"]==false));
        assert!(servers(&Settings{codebase_memory:false,rtk:false,context7:false},h,h,true,false).as_object().unwrap().values().all(|v|v["enabled"]==false));
    }
    // Protects install/update from writing user shell profiles. The fake upstream
    // installer deliberately writes all profiles under its HOME. Oracle: existing
    // bytes/mtimes and absent profiles in the target home survive both actions.
    #[tokio::test]
    async fn external_tools_cbm_installer_keeps_profiles_untouched(){
        const CHILD:&str="DECK_TEST_INSTALLER_HOME";
        if std::env::var_os(CHILD).is_none(){
            let d=tempfile::tempdir().unwrap();
            let installer=d.path().join("installer.sh");
            std::fs::write(&installer,r#"#!/bin/bash
set -eu
for p in .bashrc .bash_profile .profile .zshrc; do echo changed >> "$HOME/$p"; done
for arg in "$@"; do case "$arg" in --dir=*) dest="${arg#--dir=}";; esac; done
mkdir -p "$dest"
printf '#!/bin/sh\nprintf "fixture 42.0.0\\n"\n' > "$dest/codebase-memory-mcp"
chmod 755 "$dest/codebase-memory-mcp"
"#).unwrap();
            executable_at(&d.path().join("bin/curl"),r#"#!/bin/sh
while [ "$1" != "--output" ]; do shift; done
cp "$DECK_TEST_INSTALLER" "$2"
"#);
            let output=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","external_tools::tests::external_tools_cbm_installer_keeps_profiles_untouched","--nocapture","--test-threads=1"])
                .env(CHILD,d.path()).env("DECK_TEST_INSTALLER",installer).env("HOME",d.path())
                .env("PATH",format!("{}:/usr/bin:/bin",d.path().join("bin").display())).output().unwrap();
            assert!(output.status.success(),"{}\n{}",String::from_utf8_lossy(&output.stdout),String::from_utf8_lossy(&output.stderr));return;
        }
        let root=PathBuf::from(std::env::var_os(CHILD).unwrap());
        for present in [true,false]{
            let home=root.join(if present{"existing"}else{"absent"});std::fs::create_dir(&home).unwrap();
            let profiles=[".bashrc",".bash_profile",".profile",".zshrc"];
            if present {for p in profiles{std::fs::write(home.join(p),"sentinel\n").unwrap();}}
            let capture=||profiles.map(|p|{let p=home.join(p);p.exists().then(||(std::fs::read(&p).unwrap(),p.metadata().unwrap().modified().unwrap()))});
            let before=capture();
            for _ in 0..2{install(Tool::CodebaseMemory,&home).await.unwrap();assert_eq!(capture(),before);assert_eq!(version(Tool::CodebaseMemory,&home).await.as_deref(),Some("42.0.0"));}
        }
    }

    // Protects migration without rewriting historical project selections or receipts.
    // Oracle: the prior global RTK switch survives first open, then the new global
    // selections survive restart independently of changes to old metadata.
    #[test]
    fn external_tools_migration_preserves_old_state_and_global_intent(){
        let d=tempfile::tempdir().unwrap();let path=d.path().join("state.db");let project=d.path().to_str().unwrap();
        let mut store=Store::open(&path,project).unwrap();
        let other=d.path().join("other");std::fs::create_dir(&other).unwrap();store.register_project(other.to_str().unwrap()).unwrap();
        store.select_host_helper(Some(crate::managed_tools::release("1.2.0").unwrap().selection)).unwrap();
        store.conn.execute("DELETE FROM meta WHERE key='external_tools_v1'",[]).unwrap();
        let before=store.configuration_for(project).unwrap();let sessions=store.sessions().unwrap().len();
        drop(store);
        let store=Store::open(&path,project).unwrap();let s=store.external_settings().unwrap();
        assert!(s.rtk && s.codebase_memory && !s.context7);
        assert!(store.configuration_for(project).unwrap().helper.is_none(),"new work must not retain a private RTK selection");
        let historical:String=store.conn.query_row("SELECT body FROM configurations WHERE revision=?1",[before.revision],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&historical).unwrap(),serde_json::to_value(&before).unwrap());
        assert_eq!(store.sessions().unwrap().len(),sessions);
        store.set_external(&Settings{codebase_memory:false,rtk:false,context7:true}).unwrap();drop(store);
        let store=Store::open(&path,project).unwrap();let s=store.external_settings().unwrap();
        assert!(!s.rtk && !s.codebase_memory && s.context7);
        assert_eq!(store.conn.query_row("PRAGMA quick_check",[],|r|r.get::<_,String>(0)).unwrap(),"ok");
    }
    // Protects bounded installer execution and cancellation of descendant pipes.
    // Oracle: a stalled command cannot block an HTTP worker or retain authority.
    #[tokio::test]
    async fn external_tools_process_limits(){
        let mut c=tokio::process::Command::new("/bin/sh");c.args(["-c","sleep 30 & wait"]);
        let start=std::time::Instant::now();assert!(run(c,Duration::from_millis(50)).await.unwrap_err().contains("deadline"));assert!(start.elapsed()<Duration::from_secs(3));
        let mut c=tokio::process::Command::new("/bin/sh");c.args(["-c","printf ok"]);assert_eq!(run(c,Duration::from_secs(2)).await.unwrap(),b"ok");
    }
}

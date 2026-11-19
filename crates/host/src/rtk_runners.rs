//! RTK owns all writes. Deck invokes only its global Codex integration commands.
use super::{Tool, INSTALL, home, run};
use crate::server::{App, problem};
use axum::{Json, extract::{Path, State}, http::StatusCode, response::{IntoResponse, Response}};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{path::{Path as FsPath, PathBuf}, time::Duration};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all="snake_case")]
enum Integration { Installed, NotInstalled, Incomplete, CheckFailed }
#[derive(Serialize)]
pub(super) struct RunnerStatus {id:&'static str, state:Integration}

pub(super) fn codex_home(home:&FsPath)->Result<PathBuf,String>{
    match std::env::var_os("CODEX_HOME").filter(|v|!v.is_empty()) {
        Some(p)=>{let p=PathBuf::from(p);if !p.is_absolute(){return Err("Codex home must be an absolute path".into());}Ok(p)},
        None=>Ok(home.join(".codex")),
    }
}
fn command(home:&FsPath)->Result<tokio::process::Command,String>{
    let mut c=tokio::process::Command::new(Tool::Rtk.executable(home));
    c.args(["init","-g","--codex"]).env("HOME",home).env("CODEX_HOME",codex_home(home)?)
        .env("NO_COLOR","1").current_dir(home);
    Ok(c)
}
const OWNED:&str="<!-- rtk-owned: written by `rtk init --codex`, removed by `rtk init --codex --uninstall` -->";
pub(super) async fn read(path:&FsPath)->Result<Option<String>,String>{
    use tokio::io::AsyncReadExt;
    match tokio::fs::metadata(path).await {
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),
        Ok(m) if m.is_file() && m.len()<=1024*1024=>{},
        _=>return Err("Cannot safely inspect Codex configuration".into()),
    }
    let file=match tokio::fs::File::open(path).await {
        Ok(f)=>f,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),
        Err(_)=>return Err("Cannot read Codex configuration".into()),
    };
    let mut bytes=vec![];file.take(1024*1024+1).read_to_end(&mut bytes).await.map_err(|_|"Cannot read Codex configuration")?;
    if bytes.len()>1024*1024{return Err("Codex configuration exceeds its inspection limit".into());}
    String::from_utf8(bytes).map(Some).map_err(|_|"Codex configuration is not UTF-8".into())
}
async fn detect(root:&FsPath)->Result<Integration,String>{
    let document=read(&root.join("RTK.md")).await?.is_some_and(|s|s.starts_with(OWNED));
    let reference=format!("@{}",root.join("RTK.md").display());
    let agents=read(&root.join("AGENTS.md")).await?.is_some_and(|s|s.lines().any(|l|l.trim()==reference||l.trim()=="@RTK.md"));
    let hook=if let Some(text)=read(&root.join("hooks.json")).await? {
        let value:serde_json::Value=serde_json::from_str(&text).map_err(|_|"Codex hooks could not be read")?;
        value.pointer("/hooks/PreToolUse").and_then(|v|v.as_array()).is_some_and(|entries|entries.iter().any(|entry|{
            entry["matcher"]=="Bash" && entry["hooks"].as_array().is_some_and(|hooks|hooks.iter().any(|h|h["type"]=="command"&&h["command"]=="rtk hook codex"))
        }))
    }else{false};
    Ok(match (document,agents,hook) {(true,true,true)=>Integration::Installed,(false,false,false)=>Integration::NotInstalled,_=>Integration::Incomplete})
}
async fn state(home:&FsPath)->Integration {
    let Ok(root)=codex_home(home) else{return Integration::CheckFailed;};
    detect(&root).await.unwrap_or(Integration::CheckFailed)
}
pub(super) async fn statuses(home:&FsPath)->Vec<RunnerStatus>{
    let state=state(home).await;
    vec![RunnerStatus{id:"codex",state}]
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {api:u32,action:Action}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all="snake_case")]
enum Action {Install,Remove}
// Hash only the documented runner files; never expose their contents or rewrite them.
async fn snapshot(root:&FsPath)->Result<Vec<(PathBuf,Option<Vec<u8>>)>,String>{
    let mut result=vec![];
    for name in ["AGENTS.md","RTK.md","hooks.json","hooks.json.bak","config.toml"] {
        let path=root.join(name);
        let hash=read(&path).await?.map(|s|Sha256::digest(s.as_bytes()).to_vec());
        result.push((path,hash));
    }
    Ok(result)
}
pub async fn change(State(app):State<App>,Path(runner):Path<String>,Json(r):Json<Request>)->Response{
    if let Some(r)=crate::web_identity::effect_denied(){return r;}
    if r.api!=deck2_shared::API{return problem(StatusCode::BAD_REQUEST,"api","Unsupported API");}
    if runner!="codex"{return problem(StatusCode::BAD_REQUEST,"rtk_runner","This runner is not supported by RTK settings");}
    if !app.persistence_available(){return problem(StatusCode::SERVICE_UNAVAILABLE,"storage","Tool settings are unavailable");}
    let _gate=match INSTALL.try_lock(){Ok(g)=>g,Err(_)=>return problem(StatusCode::CONFLICT,"tool_busy","Another tool change is running")};
    let result=async {
        let home=home()?;
        if !Tool::Rtk.executable(&home).is_file(){return Err("Install RTK before configuring a runner".into());}
        let root=codex_home(&home)?;let before=snapshot(&root).await?;
        let mut c=command(&home)?;
        if matches!(r.action,Action::Remove){c.arg("--uninstall");}
        run(c,Duration::from_secs(20)).await?;
        let observed=state(&home).await;
        let expected=if matches!(r.action,Action::Install){Integration::Installed}else{Integration::NotInstalled};
        if observed!=expected{return Err("RTK finished, but the requested integration state could not be verified. Refresh the status and check RTK before retrying.".into());}
        let after=snapshot(&root).await?;
        let changes=before.iter().zip(after.iter()).filter(|(a,b)|a.1!=b.1).map(|(a,b)|json!({"path":a.0,"change":if a.1.is_none(){"created"}else if b.1.is_none(){"removed"}else{"modified"}})).collect::<Vec<_>>();
        Ok::<_,String>((RunnerStatus{id:"codex",state:observed},changes))
    }.await;
    match result {
        Ok((runner,changes))=>Json(json!({"api":deck2_shared::API,"runner":runner,"changes":changes})).into_response(),
        Err(e)=>problem(StatusCode::CONFLICT,"rtk_runner_failed",e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Protects serialization with binary installation; refusal must precede effects.
    #[tokio::test]
    async fn external_tools_rtk_runner_serialization(){
        let d=tempfile::tempdir().unwrap();
        let store=crate::Store::open_memory(d.path().to_str().unwrap()).unwrap();
        let app=App::new(store,"127.0.0.1:1234".into(),"/missing".into(),None,"admin".into(),"recover".into());
        let _gate=INSTALL.lock().await;
        let response=change(State(app),Path("codex".into()),Json(Request{api:deck2_shared::API,action:Action::Install})).await;
        assert_eq!(response.status(),StatusCode::CONFLICT);
    }
    // Protects RTK ownership detection, including unrelated hooks and partial installs.
    // Oracle: all three upstream components are needed; unrelated files are inert.
    #[tokio::test]
    async fn external_tools_rtk_runner_detection(){
        let d=tempfile::tempdir().unwrap();let root=d.path();
        assert_eq!(detect(root).await.unwrap(),Integration::NotInstalled);
        std::fs::write(root.join("hooks.json"),r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo keep"}]}]}}"#).unwrap();
        std::fs::write(root.join("AGENTS.md"),"User instructions").unwrap();
        std::fs::write(root.join("RTK.md"),"User document").unwrap();
        assert_eq!(detect(root).await.unwrap(),Integration::NotInstalled);
        std::fs::write(root.join("RTK.md"),OWNED).unwrap();
        assert_eq!(detect(root).await.unwrap(),Integration::Incomplete);
        std::fs::write(root.join("AGENTS.md"),format!("User instructions\n@{}\n",root.join("RTK.md").display())).unwrap();
        std::fs::write(root.join("hooks.json"),r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"rtk hook codex"}]}]}}"#).unwrap();
        assert_eq!(detect(root).await.unwrap(),Integration::Installed);
        std::fs::write(root.join("hooks.json"),"malformed").unwrap();
        assert!(detect(root).await.is_err());
    }
}

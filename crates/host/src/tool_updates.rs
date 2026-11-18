//! Read-only official version channels; no inherited credentials or npm config.
use super::Tool;
use serde::Serialize;
use std::{future::Future, sync::OnceLock, time::{Duration, Instant}};
const TTL:Duration=Duration::from_secs(6*60*60);
const DEADLINE:Duration=Duration::from_secs(8);

fn parse(raw:&str)->Result<semver::Version,String>{
    semver::Version::parse(raw.strip_prefix('v').unwrap_or(raw)).map_err(|_|"Invalid tool version".into())
}
fn newer(installed:&str,latest:&str)->Result<bool,String>{
    Ok(parse(latest)?.cmp_precedence(&parse(installed)?).is_gt())
}
#[derive(Default)]
struct Cache(tokio::sync::Mutex<Option<(Instant,Result<String,String>)>>);
impl Cache {
    async fn get<F>(&self,now:Instant,force:bool,limit:Duration,channel:F)->Result<String,String>
    where F:Future<Output=Result<String,String>> {
        let mut slot=self.0.lock().await;
        if !force && let Some((at,value))=slot.as_ref() && now.saturating_duration_since(*at)<TTL {return value.clone();}
        let result=tokio::time::timeout(limit,channel).await
            .map_err(|_|"Update check exceeded its deadline".to_owned())
            .and_then(|r|r).and_then(|v|parse(&v).map(|v|v.to_string()));
        *slot=Some((now,result.clone()));result
    }
    async fn clear(&self){*self.0.lock().await=None;}
}
fn cache(tool:Tool)->&'static Cache {
    static CACHES:OnceLock<[Cache;3]>=OnceLock::new();
    &CACHES.get_or_init(Default::default)[match tool{Tool::CodebaseMemory=>0,Tool::Rtk=>1,Tool::Context7=>2}]
}
#[derive(Debug,Serialize,PartialEq)]
#[serde(tag="state",rename_all="snake_case")]
pub(super) enum Update {
    NotInstalled,
    UpToDate {latest:String},
    Available {latest:String},
    CheckFailed,
}
fn status(installed:&str,latest:Result<String,String>)->Update {
    match latest.and_then(|v|newer(installed,&v).map(|newer|(v,newer))) {
        Ok((latest,true))=>Update::Available{latest},
        Ok((latest,false))=>Update::UpToDate{latest},
        Err(_)=>Update::CheckFailed,
    }
}
pub(super) async fn check(tool:Tool,installed:Option<&str>,force:bool)->Update {
    let Some(installed)=installed else{return Update::NotInstalled;};
    status(installed,cache(tool).get(Instant::now(),force,DEADLINE,channel(tool)).await)
}
pub(super) async fn invalidate(tool:Tool){cache(tool).clear().await;}
async fn channel(tool:Tool)->Result<String,String>{
    if tool==Tool::Context7 {
        let scratch=tempfile::Builder::new().prefix("d2-update-").tempdir().map_err(|_|"Update scratch unavailable")?;
        // Clear env rather than pass NPM_TOKEN, NODE_OPTIONS, proxy credentials,
        // or custom registries to npm. cwd also avoids project .npmrc files.
        let mut command=tokio::process::Command::new("npm");
        let path=std::env::var_os("PATH").unwrap_or_default();
        command.env_clear().env("PATH",path).env("HOME",scratch.path())
            .env("NPM_CONFIG_USERCONFIG",scratch.path().join("user.npmrc")).env("NPM_CONFIG_GLOBALCONFIG",scratch.path().join("global.npmrc"))
            .current_dir(scratch.path())
            .args(["view","@upstash/context7-mcp","version","--json","--registry=https://registry.npmjs.org/","--fetch-retries=0","--fetch-timeout=6000"]);
        let bytes=super::run(command,Duration::from_secs(7)).await?;
        return serde_json::from_slice::<String>(&bytes).map_err(|_|"Invalid npm version response".into());
    }
    let repo=match tool {Tool::CodebaseMemory=>"DeusData/codebase-memory-mcp",Tool::Rtk=>"rtk-ai/rtk",Tool::Context7=>unreachable!()};
    // Fixed anonymous HTTPS destination, no redirects, proxies, or auth headers.
    let client=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(7)).user_agent("Deck-update-check")
        .build().map_err(|_|"Update client unavailable")?;
    let mut response=client.get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .send().await.and_then(reqwest::Response::error_for_status).map_err(|_|"Official release channel unavailable")?;
    let mut body=Vec::new();
    while let Some(chunk)=response.chunk().await.map_err(|_|"Invalid release response")? {
        if body.len()+chunk.len()>128*1024{return Err("Release response too large".into());}
        body.extend_from_slice(&chunk);
    }
    let value:serde_json::Value=serde_json::from_slice(&body).map_err(|_|"Invalid release response")?;
    if value["draft"]!=false || value["prerelease"]!=false{return Err("Stable release unavailable".into());}
    value["tag_name"].as_str().map(str::to_owned).ok_or("Release version unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    // Protects semantic ordering and refusal to guess from malformed versions.
    // Oracle: SemVer precedence, including prereleases and ignored build metadata.
    #[test]
    fn external_tools_update_versions() {
        for (old,new,want) in [("1.9.0","v1.10.0",true),("1.0.0-rc.2","1.0.0-rc.10",true),("1.0.0-rc.10","1.0.0",true),("1.0.0","1.0.0-beta",false),("1.0.0+one","1.0.0+two",false),("2.0.0","1.0.0",false)] {
            assert_eq!(newer(old,new).unwrap(),want);
        }
        for bad in ["", "latest", "1.2", "01.2.3", "1.2.3\nno", "1.2.3-01"] {
            assert!(newer(bad,"2.0.0").is_err());assert!(newer("1.0.0",bad).is_err());
        }
    }
    // Protects safe status projection; failures/malformed versions never enable Update.
    #[test]
    fn external_tools_update_statuses(){
        assert_eq!(status("1.0.0",Ok("1.2.0".into())),Update::Available{latest:"1.2.0".into()});
        assert_eq!(status("2.0.0",Ok("1.2.0".into())),Update::UpToDate{latest:"1.2.0".into()});
        assert_eq!(status("broken",Ok("1.2.0".into())),Update::CheckFailed);
        assert_eq!(status("1.0.0",Err("offline".into())),Update::CheckFailed);
    }
    // Protects production route wiring and npm credential isolation. Run a child
    // with a temporary HOME/PATH rather than mutate the parallel test environment.
    #[tokio::test]
    async fn external_tools_update_official_channel_and_route(){
        use std::{os::unix::fs::PermissionsExt,path::PathBuf};
        const CHILD:&str="DECK_UPDATE_FIXTURE";
        if std::env::var_os(CHILD).is_none(){
            let dir=tempfile::tempdir().unwrap();
            let bin=dir.path().join("bin");std::fs::create_dir(&bin).unwrap();
            let npm=bin.join("npm");
            std::fs::write(&npm,r#"#!/bin/sh
set -eu
[ -z "${NPM_TOKEN+x}" ] && [ -z "${NODE_OPTIONS+x}" ]
[ "$NPM_CONFIG_USERCONFIG" = "$HOME/user.npmrc" ] && [ "$NPM_CONFIG_GLOBALCONFIG" = "$HOME/global.npmrc" ]
[ "$HOME" = "$PWD" ]
[ "$1" = view ] && [ "$2" = @upstash/context7-mcp ] && [ "$3" = version ]
printf '"1.2.0"'
"#).unwrap();
            std::fs::set_permissions(&npm,std::fs::Permissions::from_mode(0o755)).unwrap();
            let out=std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact","external_tools::updates::tests::external_tools_update_official_channel_and_route","--nocapture","--test-threads=1"])
                .env(CHILD,dir.path()).env("HOME",dir.path()).env("NPM_TOKEN","fixture-secret-never-forward")
                .env("NODE_OPTIONS","fixture-never-forward").env("PATH",format!("{}:/usr/bin:/bin",bin.display()))
                .output().unwrap();
            assert!(out.status.success(),"{}{}",String::from_utf8_lossy(&out.stdout),String::from_utf8_lossy(&out.stderr));return;
        }
        assert_eq!(channel(Tool::Context7).await.unwrap(),"1.2.0");
        let dir=PathBuf::from(std::env::var_os(CHILD).unwrap());
        let exe=Tool::Context7.executable(&dir);std::fs::create_dir_all(exe.parent().unwrap()).unwrap();std::fs::write(&exe,"unused").unwrap();
        let package=dir.join(".local/lib/node_modules/@upstash/context7-mcp");std::fs::create_dir_all(&package).unwrap();std::fs::write(package.join("package.json"),r#"{"version":"2.0.0"}"#).unwrap();
        let app=crate::server::App::new(crate::Store::open_memory(dir.to_str().unwrap()).unwrap(),"127.0.0.1:1234".into(),"/missing".into(),None,"admin".into(),"recover".into());
        use tower::ServiceExt;
        let auth=crate::server::router(app.clone()).oneshot(axum::http::Request::builder()
            .method("POST").uri("/auth").header("host",&app.host).header("origin",format!("http://{}",app.host))
            .body(axum::body::Body::from(app.issue_launch())).unwrap()).await.unwrap();
        let cookie=auth.headers()["set-cookie"].to_str().unwrap().split(';').next().unwrap().to_owned();
        for latest in [Ok("1.2.0".into()),Err("offline".into())]{
            cache(Tool::Context7).get(Instant::now(),true,DEADLINE,async{latest}).await.ok();
            let r=crate::server::router(app.clone()).oneshot(axum::http::Request::builder()
                .method("POST").uri("/api/tools/context7").header("host",&app.host)
                .header("cookie",&cookie)
                .header("origin",format!("http://{}",app.host)).header("content-type","application/json")
                .body(axum::body::Body::from(serde_json::json!({"api":deck2_shared::API,"action":"update"}).to_string())).unwrap()).await.unwrap();
            assert_eq!(r.status(),axum::http::StatusCode::CONFLICT);
            let bytes=axum::body::to_bytes(r.into_body(),16384).await.unwrap();
            assert!(String::from_utf8_lossy(&bytes).contains("No newer version is confirmed"));
        }
    }
    // Protects cached successes/failures, expiry, explicit retry, bounded channels.
    // Fake channels never access the network. Oracle: six-hour freshness contract.
    #[tokio::test]
    async fn external_tools_update_cache_and_timeout() {
        let cache=Cache::default();let now=std::time::Instant::now();
        assert_eq!(cache.get(now,false,Duration::from_secs(1),async{Ok("1.2.0".into())}).await.unwrap(),"1.2.0");
        assert_eq!(cache.get(now+TTL-Duration::from_secs(1),false,Duration::from_secs(1),async{panic!("fresh cache invoked channel")}).await.unwrap(),"1.2.0");
        assert!(cache.get(now+TTL,false,Duration::from_secs(1),async{Err("offline".into())}).await.is_err());
        assert!(cache.get(now+TTL,false,Duration::from_secs(1),async{panic!("cached error invoked channel")}).await.is_err());
        assert_eq!(cache.get(now+TTL,true,Duration::from_secs(1),async{Ok("1.3.0".into())}).await.unwrap(),"1.3.0");
        assert!(cache.get(now+TTL,true,Duration::ZERO,std::future::pending()).await.is_err());
    }
}

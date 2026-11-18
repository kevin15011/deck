use super::*;
use std::process::Stdio;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};
async fn bounded(reader: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>> {
    let mut b = vec![];
    reader
        .take((limit + 1) as u64)
        .read_to_end(&mut b)
        .await
        .map_err(|_| "dictation-engine-failed")?;
    if b.len() > limit {
        return Err("dictation-engine-output-limit");
    }
    Ok(b)
}
#[allow(clippy::too_many_arguments)]
pub(super) async fn run(
    app: &App,
    path: &FsPath,
    args: &[String],
    cancel: &mut watch::Receiver<bool>,
    timeout: Duration,
    limit: usize,
    merge: bool,
    output: Option<PathBuf>,
) -> Result<String> {
    admitted(app)?;
    if *cancel.borrow() {
        return Err("dictation-cancelled");
    }
    if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) } != 0 {
        return Err("dictation-engine-unavailable");
    }
    let mut cmd = Command::new(path);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    unsafe {
        cmd.pre_exec(|| {
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            Ok(())
        });
    }
    let mut child = cmd.spawn().map_err(|_| "dictation-engine-unavailable")?;
    let pid = child.id().ok_or("dictation-engine-unavailable")?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let monitor = async {
        loop {
            tokio::time::sleep(Duration::from_millis(25)).await;
            if admitted(app).is_err() {
                return "daemon-stopping";
            }
            if output
                .as_ref()
                .and_then(|p| std::fs::symlink_metadata(p).ok())
                .is_some_and(|m| m.len() > OUTPUT_LIMIT)
            {
                return "dictation-engine-output-limit";
            }
        }
    };
    let execute = async {
        let (out, err, status) =
            tokio::try_join!(bounded(stdout, limit), bounded(stderr, limit), async {
                child.wait().await.map_err(|_| "dictation-engine-failed")
            })?;
        if !status.success() {
            return Err("dictation-engine-failed");
        }
        if out.len() + err.len() > limit {
            return Err("dictation-engine-output-limit");
        }
        let mut out = out;
        if merge {
            out.extend(err);
        }
        Ok(String::from_utf8_lossy(&out).into_owned())
    };
    let result = tokio::select! {
        r=tokio::time::timeout(timeout,execute)=>r.unwrap_or(Err("dictation-engine-timeout")),
        _=cancel.changed()=>Err("dictation-cancelled"),
        code=monitor=>Err(code)
    };
    // Release neither the caller's lease nor transient audio until every descendant settles.
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(test)]
    if let Some(service) = app.dictation.get() {
        let gate = service.cleanup_gate.lock().unwrap().take();
        if let Some((reached, resume)) = gate {
            reached.notify_one();
            resume.notified().await;
        }
    }
    loop {
        if child.wait().await.is_ok() && crate::native::reap_group(pid).await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    result
}
pub(super) async fn resolve(
    app: &App,
    cancel: &mut watch::Receiver<bool>,
    override_path: Option<&FsPath>,
    cache: &Mutex<Option<(PathBuf, Identity)>>,
) -> Result<Option<PathBuf>> {
    let candidates = if let Some(p) = override_path {
        vec![p.to_path_buf()]
    } else {
        std::env::var_os("PATH")
            .map(|p| {
                std::env::split_paths(&p)
                    .map(|p| p.join("whisper-cli"))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
            .into_iter()
            .chain([
                PathBuf::from("/opt/homebrew/bin/whisper-cli"),
                PathBuf::from("/usr/local/bin/whisper-cli"),
            ])
            .collect()
    };
    for candidate in candidates {
        let Ok(path) = std::fs::canonicalize(candidate) else {
            continue;
        };
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let Ok(cpath) = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()) else {
            continue;
        };
        if !meta.is_file() || unsafe { libc::access(cpath.as_ptr(), libc::X_OK) } != 0 {
            continue;
        }
        let identity = Identity::of(&meta);
        if cache.lock().unwrap().as_ref() == Some(&(path.clone(), identity.clone())) {
            return Ok(Some(path));
        }
        let help = run(
            app,
            &path,
            &["-h".into()],
            cancel,
            Duration::from_secs(5),
            65536,
            true,
            None,
        )
        .await;
        if *cancel.borrow() {
            return Err("dictation-cancelled");
        }
        admitted(app)?;
        if let Ok(help) = help {
            let words = help
                .split_whitespace()
                .map(|s| s.trim_end_matches(','))
                .collect::<Vec<_>>();
            if [
                "-m", "-f", "-l", "-t", "-nt", "-np", "-mc", "-sns", "-oj", "-of",
            ]
            .iter()
            .all(|f| words.contains(f))
            {
                if std::fs::metadata(&path).ok().map(|m| Identity::of(&m)) != Some(identity.clone())
                {
                    continue;
                }
                *cache.lock().unwrap() = Some((path.clone(), identity));
                return Ok(Some(path));
            }
        }
    }
    *cache.lock().unwrap() = None;
    Ok(None)
}

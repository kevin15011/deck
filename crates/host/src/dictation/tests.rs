use super::*;
fn wav(samples: usize) -> Vec<u8> {
    let mut b = vec![0; 44 + samples * 2];
    b[0..4].copy_from_slice(b"RIFF");
    b[4..8].copy_from_slice(&((36 + samples * 2) as u32).to_le_bytes());
    b[8..16].copy_from_slice(b"WAVEfmt ");
    b[16..20].copy_from_slice(&16u32.to_le_bytes());
    b[20..24].copy_from_slice(&[1, 0, 1, 0]);
    b[24..28].copy_from_slice(&16000u32.to_le_bytes());
    b[28..32].copy_from_slice(&32000u32.to_le_bytes());
    b[32..36].copy_from_slice(&[2, 0, 16, 0]);
    b[36..40].copy_from_slice(b"data");
    b[40..44].copy_from_slice(&((samples * 2) as u32).to_le_bytes());
    b
}
// Oracle: original WAV contract accepts only bounded mono PCM16 at 16kHz.
#[test]
fn wav_contract() {
    assert_eq!(parse_wav(&wav(4800)), Ok(300));
    assert_eq!(parse_wav(&wav(16000 * 300)), Ok(300000));
    assert!(parse_wav(&wav(4799)).is_err());
    assert!(parse_wav(&wav(16000 * 300 + 1)).is_err());
    let mut b = wav(4800);
    b[22] = 2;
    assert!(parse_wav(&b).is_err());
    let mut b = wav(4800);
    b.push(0);
    assert!(parse_wav(&b).is_err());
}
use axum::{
    body::{Body, to_bytes},
    http::{Request as HttpRequest, header},
};
use std::os::unix::fs::PermissionsExt;
use tower::ServiceExt;
async fn fixture() -> (tempfile::TempDir, App, Arc<Service>) {
    let temp = tempfile::tempdir().unwrap();
    let app = App::new(
        crate::Store::open_memory("/fixture").unwrap(),
        "127.0.0.1:1234".into(),
        "/missing".into(),
        None,
        "admin".into(),
        "recover".into(),
    );
    let artifact = Artifact {
        bytes: 5,
        sha: crate::tasks::digest(b"model"),
        url: "https://invalid.example/model".into(),
    };
    let mut service = Service::open(&temp.path().join("dictation"), artifact).unwrap();
    let engine = temp.path().join("whisper-cli");
    std::fs::write(
        &engine,
        r#"#!/usr/bin/python3
import sys,json,pathlib,os,time,subprocess
root=pathlib.Path(__file__).parent
if '-h' in sys.argv:
 print('-m -f -l -t -nt -np -mc -sns -oj -of',file=sys.stderr);sys.exit(0)
(root/'entered').write_text(str(os.getpid()))
(root/'invocation.json').write_text(json.dumps({'language':sys.argv[sys.argv.index('-l')+1], 'model':pathlib.Path(sys.argv[sys.argv.index('-m')+1]).read_bytes().decode(), 'audio':sys.argv[sys.argv.index('-f')+1]}))
if (root/'hold').exists():
 child=subprocess.Popen(['/bin/sleep','600']);(root/'descendant.tmp').write_text(str(child.pid));os.replace(root/'descendant.tmp',root/'descendant')
 while (root/'hold').exists():time.sleep(.01)
out=sys.argv[sys.argv.index('-of')+1]+'.json'
pathlib.Path(out).write_text(json.dumps({'transcription':[{'text':' local speech '}]}))
"#,
    )
    .unwrap();
    std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
    Arc::get_mut(&mut service).unwrap().engine_override = Some(engine);
    service.models.write(MODEL, b"model").unwrap();
    service.persist(true, "es").unwrap();
    service.read_settings().unwrap();
    app.dictation
        .set(service.clone())
        .unwrap_or_else(|_| panic!("fixture already initialized"));
    (temp, app, service)
}
async fn cookie(app: &App) -> String {
    let token = app.issue_launch();
    let r = crate::server::router(app.clone())
        .oneshot(
            HttpRequest::builder()
                .method("POST")
                .uri("/auth")
                .header("host", &app.host)
                .header("origin", format!("http://{}", app.host))
                .body(Body::from(token))
                .unwrap(),
        )
        .await
        .unwrap();
    r.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .into()
}
async fn call(
    app: &App,
    cookie: &str,
    method: &str,
    path: &str,
    kind: &str,
    b: Vec<u8>,
) -> (u16, Value) {
    let r = crate::server::router(app.clone())
        .oneshot(
            HttpRequest::builder()
                .method(method)
                .uri(path)
                .header("host", &app.host)
                .header("origin", format!("http://{}", app.host))
                .header("cookie", cookie)
                .header("content-type", kind)
                .body(Body::from(b))
                .unwrap(),
        )
        .await
        .unwrap();
    let code = r.status().as_u16();
    let bytes = to_bytes(r.into_body(), 2 * 1024 * 1024).await.unwrap();
    (code, serde_json::from_slice(&bytes).unwrap())
}
#[tokio::test]
async fn default_router_auth_settings_and_transcription() {
    let (_temp, app, s) = fixture().await;
    let c = cookie(&app).await;
    assert_eq!(
        call(&app, "", "GET", "/api/dictation", "", vec![]).await.0,
        403
    );
    let (status, summary) = call(&app, &c, "GET", "/api/dictation", "", vec![]).await;
    assert_eq!(status, 200);
    assert_eq!(summary["available"], true);
    let (status, result) = call(
        &app,
        &c,
        "POST",
        "/api/dictation/transcriptions",
        "audio/wav",
        wav(16000),
    )
    .await;
    assert_eq!(status, 200, "{result}");
    assert_eq!(result["text"], "local speech");
    assert_eq!(result["audioMs"], 1000);
    assert_eq!(std::fs::read_dir(s.tmp.path()).unwrap().count(), 0);
    assert_eq!(
        call(
            &app,
            &c,
            "PUT",
            "/api/dictation/settings",
            "application/json",
            br#"{"path":"/tmp/evil"}"#.to_vec()
        )
        .await
        .0,
        400
    );
    assert_eq!(
        call(
            &app,
            &c,
            "PUT",
            "/api/dictation/settings",
            "application/json",
            br#"{"selected":null,"language":"en"}"#.to_vec()
        )
        .await
        .0,
        200
    );
    assert!(!s.info.lock().unwrap().selected);
    assert_eq!(s.info.lock().unwrap().language, "en");
    assert_eq!(
        call(
            &app,
            &c,
            "POST",
            "/api/dictation/transcriptions",
            "audio/wav",
            wav(4800)
        )
        .await
        .1["code"],
        "dictation-model-not-installed"
    );
    assert_eq!(
        call(
            &app,
            &c,
            "PUT",
            "/api/dictation/settings",
            "application/json",
            br#"{"selected":"large-v3-turbo-q5_0"}"#.to_vec()
        )
        .await
        .0,
        200
    );
    std::fs::write(s.models.path().join(MODEL), b"other").unwrap();
    assert!(s.verify().await.is_err());
    assert_eq!(
        call(
            &app,
            &c,
            "POST",
            "/api/dictation/transcriptions",
            "audio/wav",
            vec![0; MAX_BYTES + 1]
        )
        .await
        .0,
        413
    );
    assert_eq!(
        call(
            &app,
            &c,
            "POST",
            "/api/dictation/transcriptions",
            "text/plain",
            wav(4800)
        )
        .await
        .0,
        415
    );
    app.shutdown_requested.store(true, Ordering::SeqCst);
    assert_eq!(
        call(
            &app,
            &c,
            "DELETE",
            &format!("/api/dictation/models/{ID}"),
            "",
            vec![]
        )
        .await
        .1["code"],
        "daemon-stopping"
    );
}
async fn exists(p: &FsPath) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !p.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|e| panic!("Fixture did not create {}: {e}", p.display()));
}
#[tokio::test]
async fn http_abort_owns_cleanup_and_cross_host_exclusion() {
    let (temp, app, s) = fixture().await;
    let c = cookie(&app).await;
    std::fs::write(temp.path().join("hold"), b"").unwrap();
    let a = app.clone();
    let task = tokio::spawn(async move {
        call(
            &a,
            &c,
            "POST",
            "/api/dictation/transcriptions",
            "audio/wav",
            wav(16000),
        )
        .await
    });
    exists(&temp.path().join("descendant")).await;
    // An unrelated host cannot reconcile transient audio or change the shared model.
    assert!(matches!(
        Service::open(&temp.path().join("dictation"), s.artifact.clone()),
        Err("dictation-busy")
    ));
    assert!(s.lease().is_err());
    let pid: libc::pid_t = std::fs::read_to_string(temp.path().join("descendant"))
        .unwrap()
        .parse()
        .unwrap();
    let reached = Arc::new(tokio::sync::Notify::new());
    let resume = Arc::new(tokio::sync::Notify::new());
    *s.cleanup_gate.lock().unwrap() = Some((reached.clone(), resume.clone()));
    task.abort();
    let _ = task.await;
    tokio::time::timeout(Duration::from_secs(5), reached.notified())
        .await
        .unwrap();
    assert!(
        s.lease().is_err(),
        "HTTP abort must retain model/process ownership during cleanup"
    );
    assert_eq!(
        std::fs::read_dir(s.tmp.path()).unwrap().count(),
        1,
        "Audio is retained until cleanup confirms settlement"
    );
    resume.notify_one();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(lease) = s.lease() {
                drop(lease);
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
    assert_eq!(std::fs::read_dir(s.tmp.path()).unwrap().count(), 0);
    assert!(Service::open(&temp.path().join("dictation"), s.artifact.clone()).is_ok());
}
#[tokio::test]
async fn model_download_integrity_atomicity_and_cancel() {
    use tokio::io::AsyncWriteExt;
    let (temp, app, _s) = fixture().await;
    // Isolate the external HTTP edge; production clients enforce HTTPS.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let root = temp.path().join("download");
    let s = Service::open(
        &root,
        Artifact {
            bytes: 5,
            sha: crate::tasks::digest(b"model"),
            url: format!("http://{address}"),
        },
    )
    .unwrap();
    let partial_ready = Arc::new(tokio::sync::Notify::new());
    let ready = partial_ready.clone();
    let server = tokio::spawn(async move {
        for body in [b"model", b"wrong"] {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            use tokio::io::AsyncReadExt;
            assert!(stream.read(&mut request).await.unwrap() > 0);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
            stream.write_all(body).await.unwrap();
        }
        let (mut stream, _) = listener.accept().await.unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nmo")
            .await
            .unwrap();
        ready.notify_one();
        std::future::pending::<()>().await;
    });
    let (_tx, mut cancel) = watch::channel(false);
    {
        let _l = s.lease().unwrap();
        s.acquire(&app, &mut cancel).await.unwrap();
    }
    assert!(s.verify().await.is_ok());
    {
        let _l = s.lease().unwrap();
        assert_eq!(
            s.acquire(&app, &mut cancel).await,
            Err("dictation-download-integrity")
        );
    }
    assert!(s.verify().await.is_ok());
    let (tx, mut cancel) = watch::channel(false);
    let copy = s.clone();
    let a = app.clone();
    let task = tokio::spawn(async move {
        let _l = copy.lease().unwrap();
        copy.acquire(&a, &mut cancel).await
    });
    tokio::time::timeout(Duration::from_secs(5), partial_ready.notified())
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while s.info.lock().unwrap().received != 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(std::fs::read_dir(s.models.path()).unwrap().count(), 2);
    tx.send(true).unwrap();
    assert_eq!(task.await.unwrap(), Err("dictation-cancelled"));
    assert_eq!(std::fs::read_dir(s.models.path()).unwrap().count(), 1);
    server.abort();
    let _ = server.await;
}
#[tokio::test]
async fn engine_output_and_timeout_are_bounded() {
    let (temp, app, _s) = fixture().await;
    let path = temp.path().join("noisy");
    std::fs::write(&path, "#!/bin/sh\nhead -c 100000 /dev/zero\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (_tx, mut cancel) = watch::channel(false);
    assert!(matches!(
        runtime::run(
            &app,
            &path,
            &[],
            &mut cancel,
            Duration::from_secs(2),
            100,
            false,
            None
        )
        .await,
        Err("dictation-engine-output-limit")
    ));
    std::fs::write(&path, "#!/bin/sh\nsleep 600\n").unwrap();
    assert!(matches!(
        runtime::run(
            &app,
            &path,
            &[],
            &mut cancel,
            Duration::from_millis(25),
            100,
            false,
            None
        )
        .await,
        Err("dictation-engine-timeout")
    ));
}
// Actual filesystem denial: cleanup must remain pending and retain the model lease.
#[tokio::test]
async fn failed_temp_removal_retains_ownership_until_confirmed() {
    let (_temp, _app, s) = fixture().await;
    let path = s.tmp.path().join("blocked");
    std::fs::create_dir(&path).unwrap();
    std::fs::write(path.join("audio.wav"), b"private audio fixture").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o0)).unwrap();
    let operation = async {
        let _lease = s.lease().unwrap();
        remove_owned(&path, true).await;
    };
    tokio::pin!(operation);
    // Biased polling reaches the real failed removal before yielding, without a timing race.
    tokio::select! {biased;_= &mut operation=>panic!("Unconfirmed cleanup released ownership"),_=tokio::task::yield_now()=>{}}
    assert!(s.lease().is_err());
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    operation.await;
    assert!(!path.exists());
    assert!(s.lease().is_ok());
}

// Oracle: readiness observes verified identities; explicit use still verifies bytes.
#[tokio::test]
async fn readiness_reuses_verified_model_without_blocking_on_hash_work() {
    let (_temp, app, s) = fixture().await;
    let (_tx, mut cancel) = watch::channel(false);
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["available"],
        true
    );
    let reached = Arc::new(tokio::sync::Notify::new());
    let resume = Arc::new(tokio::sync::Notify::new());
    *s.verification_gate.lock().unwrap() = Some((reached.clone(), resume.clone()));
    let repeated = {
        let summary = s.summary(&app, &mut cancel);
        tokio::pin!(summary);
        let repeated = tokio::select! {biased;_=reached.notified()=>true,r=&mut summary=>{assert_eq!(r.unwrap()["available"],true);false}};
        if repeated {
            resume.notify_one();
            let _ = summary.await;
        }
        repeated
    };
    assert!(
        !repeated,
        "Unchanged readiness entered expensive hashing and retained admission"
    );
    // Both public integrity decisions must hash even the cached identity.
    let c = cookie(&app).await;
    for (method, path, kind, body) in [
        (
            "PUT",
            "/api/dictation/settings",
            "application/json",
            br#"{"selected":"large-v3-turbo-q5_0"}"#.to_vec(),
        ),
        (
            "POST",
            "/api/dictation/transcriptions",
            "audio/wav",
            wav(16000),
        ),
    ] {
        *s.verification_gate.lock().unwrap() = Some((reached.clone(), resume.clone()));
        let verification = call(&app, &c, method, path, kind, body);
        tokio::pin!(verification);
        tokio::select! {biased;_=reached.notified()=>{},_=&mut verification=>panic!("Fresh verification was bypassed")};
        resume.notify_one();
        assert_eq!(verification.await.0, 200);
    }
    std::fs::write(s.models.path().join(MODEL), b"other").unwrap();
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["models"][0]["state"],
        "corrupt"
    );
    std::fs::remove_file(s.models.path().join(MODEL)).unwrap();
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["models"][0]["state"],
        "absent"
    );
    s.models.write(MODEL, b"model").unwrap();
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["available"],
        true
    );
}
#[tokio::test]
async fn readiness_reuses_engine_probe_and_invalidates_replacement_and_mode() {
    let (temp, app, s) = fixture().await;
    let (_tx, mut cancel) = watch::channel(false);
    let engine = temp.path().join("whisper-cli");
    let marker = temp.path().join("probed");
    let script = format!(
        "#!/bin/sh\n[ -e '{}' ] && exit 1\ntouch '{}'\necho '-m -f -l -t -nt -np -mc -sns -oj -of'\n",
        marker.display(),
        marker.display()
    );
    std::fs::write(&engine, &script).unwrap();
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["available"],
        true
    );
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["available"],
        true,
        "Unchanged executable must not repeat external probing"
    );
    std::fs::write(&engine, "#!/bin/sh\nexit 1\n").unwrap();
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["runtime"]["state"],
        "missing"
    );
    std::fs::remove_file(marker).unwrap();
    std::fs::write(&engine, &script).unwrap();
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["available"],
        true
    );
    std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["runtime"]["state"],
        "missing"
    );
    std::fs::remove_file(engine).unwrap();
    assert_eq!(
        s.summary(&app, &mut cancel).await.unwrap()["runtime"]["state"],
        "missing"
    );
}

// Exercise Hyper's actual socket cancellation and shutdown admission, not oneshot Drop.
#[tokio::test]
async fn real_http_disconnect_and_shutdown_settle_descendants_and_audio() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    for shutdown in [false, true] {
        let (temp, app, s) = fixture().await;
        let c = cookie(&app).await;
        // Qualification has its own bounded probe. Do not charge that separate
        // stage against the deadline for observing the cancellable transcription.
        let (_tx, mut cancel) = watch::channel(false);
        assert_eq!(
            s.summary(&app, &mut cancel).await.unwrap()["available"],
            true
        );
        std::fs::write(temp.path().join("hold"), b"").unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let router = crate::server::router(app.clone());
        let stop = Arc::new(tokio::sync::Notify::new());
        let stopped = stop.clone();
        let server = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async move { stopped.notified().await })
                .await
                .unwrap()
        });
        let mut socket = tokio::net::TcpStream::connect(addr).await.unwrap();
        let b = wav(16000);
        socket.write_all(format!("POST /api/dictation/transcriptions HTTP/1.1\r\nHost: {}\r\nOrigin: http://{}\r\nCookie: {}\r\nContent-Type: audio/wav\r\nContent-Length: {}\r\n\r\n",app.host,app.host,c,b.len()).as_bytes()).await.unwrap();
        socket.write_all(&b).await.unwrap();
        // HTTP admission, body collection and model verification precede the
        // engine's cancellation fixture. Synchronize with engine entry first;
        // the five-second descendant/cleanup assertions start after that point.
        let entry = temp.path().join("entered");
        let setup = tokio::time::timeout(Duration::from_secs(30), async {
            let mut response = [0; 4096];
            loop {
                if entry.exists() { return Ok(()); }
                tokio::select! {
                    read = socket.read(&mut response) => {
                        let n = read.map_err(|e| format!("Fixture HTTP read failed: {e}"))?;
                        let text = String::from_utf8_lossy(&response[..n]);
                        // Status and error code are synthetic; never print cookies.
                        let status = text.lines().next().unwrap_or("connection closed");
                        return Err(format!("Transcription ended before engine entry: {status}"));
                    }
                    _ = tokio::time::sleep(Duration::from_millis(10)) => {}
                }
            }
        }).await;
        if !matches!(setup, Ok(Ok(()))) {
            drop(socket);
            app.shutdown_requested.store(true, Ordering::SeqCst);
            let _ = tokio::time::timeout(Duration::from_secs(5), close(&app)).await;
            stop.notify_one();
            let _ = tokio::time::timeout(Duration::from_secs(5), server).await;
            panic!("HTTP/engine preparation failed before cancellation fixture: {setup:?}");
        }
        exists(&temp.path().join("descendant")).await;
        let pid: libc::pid_t = std::fs::read_to_string(temp.path().join("descendant"))
            .unwrap()
            .parse()
            .unwrap();
        if shutdown {
            app.shutdown_requested.store(true, Ordering::SeqCst);
            tokio::time::timeout(Duration::from_secs(5), close(&app))
                .await
                .unwrap();
        }
        drop(socket);
        let settled = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(l) = s.lease() {
                    drop(l);
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await;
        // Always settle the disposable fixture even when a transport regression is observed.
        if settled.is_err() {
            app.shutdown_requested.store(true, Ordering::SeqCst);
            close(&app).await;
        }
        stop.notify_one();
        server.await.unwrap();
        assert!(
            settled.is_ok(),
            "Socket disconnect must cancel owned transcription"
        );
        assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
        assert_eq!(std::fs::read_dir(s.tmp.path()).unwrap().count(), 0);
    }
}

// Protects no-copy Deck1 reuse, inherited settings, and independent temporary ownership.
// Oracle: DICTATION-COMPAT-01/02; fails if only Deck2's managed model is searched.
#[tokio::test]
async fn compatible_model_settings_and_owned_storage() {
    let (temp, app, fixture_service) = fixture().await;
    let source = temp.path().join("original");
    let original = Service::open(&source, fixture_service.artifact.clone()).unwrap();
    original.models.write(MODEL, b"model").unwrap();
    original.persist(true, "en").unwrap();
    original.tmp.write("clip-live", b"original audio").unwrap();
    original
        .models
        .write(".partial-live", b"original download")
        .unwrap();
    let _original_work = original.lease().unwrap();
    let owned = temp.path().join("compatible");
    let obsolete = Service::open(&owned, original.artifact.clone()).unwrap();
    obsolete.persist(false, "auto").unwrap();
    obsolete.models.write(MODEL, b"wrong").unwrap();
    let mut s = Service::open_compatible(&owned, original.artifact.clone(), Some(source)).unwrap();
    Arc::get_mut(&mut s).unwrap().engine_override = fixture_service.engine_override.clone();
    let (_tx, mut cancel) = watch::channel(false);
    let summary = s.summary(&app, &mut cancel).await.unwrap();
    assert_eq!(
        summary["available"], true,
        "Existing original model must be usable without a download"
    );
    assert_eq!(summary["language"], "en");
    let file = s.verify().await.unwrap();
    assert_eq!(
        file.metadata().unwrap().ino(),
        original
            .models
            .file(MODEL, false)
            .unwrap()
            .metadata()
            .unwrap()
            .ino()
    );
    assert_eq!(
        obsolete.models.bytes(MODEL, 100).unwrap(),
        b"wrong",
        "Obsolete Deck2 model stays untouched"
    );
    assert!(
        !owned.join("settings-compatible.json").exists(),
        "Reading must not write preferences"
    );
    assert_eq!(
        original.tmp.bytes("clip-live", 100).unwrap(),
        b"original audio"
    );
    assert_eq!(
        original.models.bytes(".partial-live", 100).unwrap(),
        b"original download"
    );
    // Native edge sees descriptor-backed source model and Deck2-owned audio/output.
    let _lease = s.lease().unwrap();
    assert_eq!(
        s.perform(&app, wav(16000), 1000, &mut cancel)
            .await
            .unwrap()["text"],
        "local speech"
    );
    drop(_lease);
    let invocation: Value =
        serde_json::from_slice(&std::fs::read(temp.path().join("invocation.json")).unwrap())
            .unwrap();
    assert_eq!(invocation["language"], "en");
    assert_eq!(invocation["model"], "model");
    assert!(!invocation["audio"].as_str().unwrap().contains("original"));
    assert_eq!(std::fs::read_dir(s.tmp.path()).unwrap().count(), 0);
    assert_eq!(
        original.tmp.bytes("clip-live", 100).unwrap(),
        b"original audio"
    );
    s.persist(false, "auto").unwrap();
    s.read_settings().unwrap();
    assert!(!s.info.lock().unwrap().selected);
    assert_eq!(s.info.lock().unwrap().language, "auto");
    assert_eq!(
        original.root.bytes("settings.json", 4096).unwrap(),
        br#"{"language":"en","selected":"large-v3-turbo-q5_0"}"#
    );
}

#[test]
fn compatible_root_resolution() {
    assert_eq!(
        original_root(Some("/custom".into()), Some("/home/test".into())),
        Some("/custom/deck/dictation".into())
    );
    assert_eq!(
        original_root(Some("relative".into()), Some("/home/test".into())),
        Some("/home/test/.local/state/deck/dictation".into())
    );
    assert_eq!(original_root(None, Some("relative".into())), None);
}
// Protects stale-source refusal, private-file checks, explicit-store isolation and preferences.
#[tokio::test]
async fn compatible_source_changes_and_explicit_preferences() {
    let (temp, app, fixture_service) = fixture().await;
    let source = temp.path().join("source");
    let original = Service::open(&source, fixture_service.artifact.clone()).unwrap();
    original.models.write(MODEL, b"model").unwrap();
    original.persist(true, "en").unwrap();
    let obsolete = Service::open(&temp.path().join("consumer"), original.artifact.clone()).unwrap();
    obsolete.models.write(MODEL, b"model").unwrap();
    obsolete.persist(false, "auto").unwrap();
    let mut s = Service::open_compatible(
        &temp.path().join("consumer"),
        original.artifact.clone(),
        Some(source.clone()),
    )
    .unwrap();
    Arc::get_mut(&mut s).unwrap().engine_override = fixture_service.engine_override.clone();
    // Use real authenticated routes with the compatible service, preserving default router wiring.
    let consumer = App::new(
        crate::Store::open_memory("/fixture").unwrap(),
        app.host.clone(),
        "/missing".into(),
        None,
        "admin".into(),
        "recover".into(),
    );
    consumer
        .dictation
        .set(s.clone())
        .unwrap_or_else(|_| panic!("initialized"));
    let c = cookie(&consumer).await;
    let (_tx, mut cancel) = watch::channel(false);
    assert_eq!(
        s.summary(&consumer, &mut cancel).await.unwrap()["available"],
        true
    );
    original.persist(true, "es").unwrap();
    assert_eq!(
        s.summary(&consumer, &mut cancel).await.unwrap()["language"],
        "es"
    );
    assert_eq!(
        call(
            &consumer,
            &c,
            "DELETE",
            &format!("/api/dictation/models/{ID}"),
            "",
            vec![]
        )
        .await
        .1["code"],
        "dictation-model-source-owned"
    );
    assert!(original.models.file(MODEL, false).is_ok());
    assert_eq!(
        call(
            &consumer,
            &c,
            "PUT",
            "/api/dictation/settings",
            "application/json",
            br#"{"selected":null,"language":"auto"}"#.to_vec()
        )
        .await
        .0,
        200
    );
    original.persist(true, "es").unwrap();
    assert_eq!(
        s.summary(&consumer, &mut cancel).await.unwrap()["selected"],
        Value::Null
    );
    assert_eq!(s.info.lock().unwrap().language, "auto");
    // Even on reopen explicit Deck2 preferences win over later original changes.
    drop(s);
    let reopened = Service::open_compatible(
        &temp.path().join("consumer"),
        original.artifact.clone(),
        Some(source.clone()),
    )
    .unwrap();
    assert!(!reopened.info.lock().unwrap().selected);
    assert_eq!(reopened.info.lock().unwrap().language, "auto");
    let isolated = Service::open(&temp.path().join("isolated"), original.artifact.clone()).unwrap();
    assert!(isolated.verify().await.is_err());
    assert!(!isolated.info.lock().unwrap().selected);
    std::fs::write(original.models.path().join(MODEL), b"wrong").unwrap();
    assert_eq!(
        reopened.summary(&app, &mut cancel).await.unwrap()["models"][0]["state"],
        "corrupt"
    );
    assert_eq!(
        call(
            &consumer,
            &c,
            "POST",
            &format!("/api/dictation/models/{ID}/download"),
            "",
            vec![]
        )
        .await
        .1["code"],
        "dictation-model-source-owned"
    );
    std::fs::remove_file(original.models.path().join(MODEL)).unwrap();
    assert_eq!(
        reopened.summary(&app, &mut cancel).await.unwrap()["models"][0]["state"],
        "absent"
    );
    original.models.write(MODEL, b"model").unwrap();
    assert!(reopened.verify().await.is_ok());
    std::fs::rename(&source, temp.path().join("moved-source")).unwrap();
    assert!(
        reopened.verify().await.is_err(),
        "An old source directory descriptor is not evidence of a current model"
    );
    std::os::unix::fs::symlink(temp.path().join("moved-source"), &source).unwrap();
    assert!(
        reopened.verify().await.is_err(),
        "Reject source symlink replacement"
    );
    std::fs::remove_file(&source).unwrap();
    std::fs::rename(temp.path().join("moved-source"), &source).unwrap();
    std::fs::set_permissions(
        original.models.path().join(MODEL),
        std::fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    assert!(
        reopened.verify().await.is_err(),
        "Reject unsafe source file"
    );
    std::fs::set_permissions(
        original.models.path().join(MODEL),
        std::fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    // Deck1 is authoritative even over a stale or broken private artifact.
    reopened
        .models
        .write(reopened.model_name(), b"wrong")
        .unwrap();
    assert!(reopened.verify().await.is_ok());
    assert!(reopened.external_model());
}

// Oracle: settled model ownership is reusable independently of a concurrent
// fork's temporary descriptor copy; active/uncertain ownership stays excluded.
#[tokio::test]
async fn settled_lease_releases_inherited_description() {
    let (_temp, _app, service) = fixture().await;
    let lease = service.lease().unwrap();
    let inherited = lease._file.0.try_clone().unwrap();
    assert!(service.lease().is_err());
    drop(lease);
    assert!(
        service.lease().is_ok(),
        "settled lease retained by inherited descriptor"
    );
    drop(inherited);
}

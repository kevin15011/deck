// Protects ordered image identity and explicit unsupported-mode rejection.
// Oracle: S8b acceptance: an image-bearing command must never become text-only.
use deck2::Store;
use deck2_shared::{API, ScopedSubmit};
#[test]
fn images_cannot_be_silently_dropped() {
    let mut s = Store::open_memory("/fixture").unwrap();
    let c:ScopedSubmit=serde_json::from_value(serde_json::json!({"api":API,"id":"image-command","session":s.session,"prompt":"look","attachments":["missing-image"],"mode":"read_only","fresh":true})).expect("image identity must be understood");
    assert!(s.admit(&c).unwrap_err().message.contains("image"));
    assert!(s.all().unwrap().is_empty());
}
use deck2::images::{MAX_IMAGE, validate};
use deck2_shared::{ImageAttachment, Mode, Phase};
fn png() -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(7, 9)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}
fn upload(s: &Store, session: &str, key: &str, bytes: &[u8]) -> ImageAttachment {
    s.upload_image(session, key, validate(bytes).unwrap(), bytes)
        .unwrap()
}
#[test]
fn trusted_contents_and_dimension_limits() {
    let bytes = png();
    let a = validate(&bytes).unwrap();
    assert_eq!((a.width, a.height, a.mime.as_str()), (7, 9, "image/png"));
    for bytes in [
        vec![],
        b"not an image".to_vec(),
        bytes[..25].to_vec(),
        vec![0; MAX_IMAGE + 1],
    ] {
        assert!(validate(&bytes).is_err());
    }
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(16385, 1)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    assert!(validate(bytes.get_ref()).is_err());
    for format in [image::ImageFormat::Jpeg, image::ImageFormat::WebP] {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(8, 8)
            .write_to(&mut bytes, format)
            .unwrap();
        assert!(validate(bytes.get_ref()).is_ok());
    }
}
#[test]
fn scoped_idempotency_pinning_queue_and_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    let mut s = Store::open(&path, "/fixture").unwrap();
    let session = s.session.clone();
    let bytes = png();
    let a = upload(&s, &session, "upload-one", &bytes);
    assert_eq!(upload(&s, &session, "upload-one", &bytes), a);
    let mut other = validate(&bytes).unwrap();
    other.digest = "0".repeat(64);
    assert!(
        s.upload_image(&session, "upload-one", other, &bytes)
            .is_err()
    );
    s.create_session(&deck2_shared::SessionCommand {
            project_id: None,
        members: None,
        approvals: None,
        api: API,
        id: "other-session".into(),
        title: "Other".into(),
    })
    .unwrap();
    assert!(s.image("other-session", &a.id).is_err());
    let mut c:ScopedSubmit=serde_json::from_value(serde_json::json!({"api":API,"id":"image-command","session":session,"prompt":"","attachments":[a.id],"mode":"read_only","queue":true,"fresh":true})).unwrap();
    let r = s.admit(&c).unwrap();
    assert_eq!(r.attachments, vec![a.clone()]);
    assert_eq!(s.admit(&c).unwrap(), r);
    assert!(s.remove_image(&session, &a.id).is_err());
    let b = upload(&s, &session, "upload-two", &bytes);
    c.attachments = vec![b.id.clone()];
    assert!(s.admit(&c).is_err());
    c.id = "other-command".into();
    c.mode = Mode::Team;
    assert!(s.admit(&c).is_err());
    drop(s);
    let mut s = Store::open(&path, "/fixture").unwrap();
    assert_eq!(s.get(&r.id).unwrap().unwrap().attachments, vec![a.clone()]);
    assert_eq!(s.image(&session, &a.id).unwrap().1, bytes);
    s.pause_queue(false).unwrap();
    assert_eq!(s.claim_next().unwrap().unwrap().phase, Phase::Accepted);
    assert!(s.claim_next().unwrap().is_none());
    let receipt = s.get(&r.id).unwrap().unwrap();
    let (dir, parts) = s.native_images(&receipt).unwrap();
    assert_eq!(parts[0]["type"], "localImage");
    assert_eq!(
        std::fs::read(parts[0]["path"].as_str().unwrap()).unwrap(),
        bytes
    );
    drop(dir);
    assert!(!std::path::Path::new(parts[0]["path"].as_str().unwrap()).exists());
    assert!(s.remove_image(&session, &b.id).is_ok());
}
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use deck2::server::{App, router};
use http_body_util::BodyExt;
use tower::ServiceExt;
async fn call(
    app: &App,
    method: &str,
    path: &str,
    bytes: Vec<u8>,
    cookie: Option<&str>,
    origin: &str,
) -> axum::response::Response {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("host", &app.host)
        .header("origin", origin);
    if path == "/api/commands" {
        req = req.header("content-type", "application/json");
    }
    if let Some(cookie) = cookie {
        req = req.header("cookie", cookie);
    }
    router(app.clone())
        .oneshot(req.body(Body::from(bytes)).unwrap())
        .await
        .unwrap()
}
#[tokio::test]
async fn authenticated_image_route_and_separate_body_limit() {
    let s = Store::open_memory("/fixture").unwrap();
    let session = s.session.clone();
    let app = App::new(
        s,
        "127.0.0.1:12345".into(),
        "/missing".into(),
        None,
        "admin".into(),
        "recovery".into(),
    );
    let origin = "http://127.0.0.1:12345";
    let response = call(
        &app,
        "POST",
        "/auth",
        app.issue_launch().into_bytes(),
        None,
        origin,
    )
    .await;
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let url = format!("/api/sessions/{session}/uploads/upload-http");
    assert_eq!(
        call(&app, "POST", &url, png(), None, origin).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &url,
            png(),
            Some(&cookie),
            "http://evil.example"
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    let response = call(&app, "POST", &url, png(), Some(&cookie), origin).await;
    assert_eq!(response.status(), StatusCode::OK);
    let a: ImageAttachment =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let url = format!("/api/sessions/{session}/images/{}", a.id);
    assert_eq!(
        call(&app, "GET", &url, vec![], None, origin).await.status(),
        StatusCode::FORBIDDEN
    );
    let r = call(&app, "GET", &url, vec![], Some(&cookie), origin).await;
    assert_eq!(r.headers()["content-type"], "image/png");
    assert_eq!(r.headers()["cache-control"], "no-store");
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/commands",
            vec![0; 110000],
            Some(&cookie),
            origin
        )
        .await
        .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let url = format!("/api/sessions/{session}/uploads/upload-big");
    assert_eq!(
        call(
            &app,
            "POST",
            &url,
            vec![0; MAX_IMAGE + 1],
            Some(&cookie),
            origin
        )
        .await
        .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        call(&app, "POST", &url, vec![0; 110000], Some(&cookie), origin)
            .await
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}
// Staging is bounded by rejection, never by evicting an admitted reference.
#[test]
fn staging_capacity_never_evicts_admitted_images() {
    let mut s = Store::open_memory("/fixture").unwrap();
    let session = s.session.clone();
    let bytes = png();
    let a = upload(&s, &session, "upload-pinned", &bytes);
    let c:ScopedSubmit=serde_json::from_value(serde_json::json!({"api":API,"id":"pinned-command","session":session,"prompt":"inspect","attachments":[a.id],"mode":"read_only","queue":true,"fresh":true})).unwrap();
    s.admit(&c).unwrap();
    let meta = validate(&bytes).unwrap();
    for i in 0..128 {
        let mut meta = meta.clone();
        meta.id = uuid::Uuid::new_v4().to_string();
        s.upload_image(&session, &format!("staging-{i:04}"), meta, &bytes)
            .unwrap();
    }
    assert!(
        s.upload_image(
            &session,
            "staging-overflow",
            validate(&bytes).unwrap(),
            &bytes
        )
        .is_err()
    );
    assert_eq!(s.image(&session, &a.id).unwrap().1, bytes);
    let mut c = c.clone();
    c.id = "duplicate-images".into();
    c.attachments = vec![a.id; 9];
    assert!(s.admit(&c).is_err());
}
// A removed pending upload cannot reappear after its body/decoder finishes.
#[test]
fn removal_wins_over_late_upload_and_pins_win_over_removal() {
    let mut s = Store::open_memory("/fixture").unwrap();
    let session = s.session.clone();
    let bytes = png();
    s.cancel_upload(&session, "late-upload").unwrap();
    assert!(
        s.upload_image(&session, "late-upload", validate(&bytes).unwrap(), &bytes)
            .is_err()
    );
    let a = upload(&s, &session, "kept-upload", &bytes);
    let c:ScopedSubmit=serde_json::from_value(serde_json::json!({"api":API,"id":"kept-command","session":session,"prompt":"look","attachments":[a.id],"queue":true,"fresh":true})).unwrap();
    s.admit(&c).unwrap();
    assert!(s.cancel_upload(&session, "kept-upload").is_err());
    assert_eq!(s.uploaded_image(&session, "kept-upload").unwrap(), a);
}

// Q01: the cancellation ledger never blocks a conversation, and a lost
// acknowledgment remains retryable however long the ledger grows.
#[test]
fn cancellation_ledger_has_no_capacity_limit() {
    let s = Store::open_memory("/fixture").unwrap();
    let session = s.session.clone();
    for i in 0..4097 {
        s.cancel_upload(&session, &format!("removed-{i}")).unwrap();
    }
    s.cancel_upload(&session, "new-removal")
        .expect("removals continue past any former ledger limit");
    s.cancel_upload(&session, "removed-0")
        .expect("durable cancellation must remain acknowledgeable");
}

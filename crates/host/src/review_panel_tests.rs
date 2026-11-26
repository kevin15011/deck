use super::*;
use http_body_util::BodyExt;
use tower::ServiceExt;

struct ReviewFixture {
    dir: tempfile::TempDir,
    app: App,
}

impl ReviewFixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let app = App::new(
            Store::open_memory(dir.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:1234".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let fixture = Self { dir, app };
        fixture.session("review-session");
        fixture
    }

    fn session(&self, id: &str) {
        self.app
            .store
            .lock()
            .unwrap()
            .create_session(
                &serde_json::from_value(json!({"api": API, "id": id, "title": "Review fixture"}))
                    .unwrap(),
            )
            .unwrap();
    }

    fn git(&self, args: &[&str]) -> String {
        git_at(self.dir.path(), args)
    }

    fn write(&self, path: &str, data: impl AsRef<[u8]>) {
        std::fs::write(self.dir.path().join(path), data).unwrap();
    }

    fn init(&self) {
        self.git(&["init", "-q", "-b", "main"]);
    }

    async fn response(&self, session: &str, query: &str, authenticated: bool) -> Response {
        let mut request = axum::http::Request::builder()
            .uri(format!("/api/sessions/{session}/review/{query}"))
            .header("host", &self.app.host);
        if authenticated {
            request = request.header(
                "cookie",
                format!("{}={}", self.app.cookie_name, self.app.cookie),
            );
        }
        router(self.app.clone())
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    async fn request(
        &self,
        session: &str,
        query: &str,
        authenticated: bool,
    ) -> (StatusCode, serde_json::Value) {
        let response = self.response(session, query, authenticated).await;
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    async fn get(&self, query: &str) -> serde_json::Value {
        let (status, body) = self.request("review-session", query, true).await;
        assert_eq!(status, StatusCode::OK, "{query}: {body}");
        body
    }

    async fn problem(&self, query: &str, status: StatusCode, code: &str) {
        let actual = self.request("review-session", query, true).await;
        assert_eq!(actual.0, status, "{query}: {}", actual.1);
        assert_eq!(actual.1["code"], code);
    }
}

fn git_at(dir: &std::path::Path, args: &[&str]) -> String {
    let result = std::process::Command::new("/usr/bin/git")
        .current_dir(dir)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args([
            "-c",
            "user.name=Review",
            "-c",
            "user.email=review@example.test",
        ])
        .args(args)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    String::from_utf8(result.stdout).unwrap().trim().to_string()
}

fn row<'a>(tree: &'a serde_json::Value, path: &str) -> &'a serde_json::Value {
    tree["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["path"] == path)
        .unwrap_or_else(|| panic!("missing {path}: {tree}"))
}

fn parameter<'a>(body: &'a serde_json::Value, key: &str) -> &'a str {
    body[key].as_str().unwrap()
}

#[tokio::test]
async fn review_routes_compare_final_worktree_and_version_selected_content() {
    let f = ReviewFixture::new();
    f.init();
    for (name, text) in [
        ("cancel", "same\n"),
        ("removed-index", "same\n"),
        ("edit", "old\n"),
        ("moved", "unique\n"),
        ("tracked-move", "different\n"),
        ("mode", "mode\n"),
    ] {
        f.write(name, text);
    }
    f.git(&["add", "."]);
    f.git(&["commit", "-qm", "base"]);
    let base = f.git(&["rev-parse", "HEAD"]);
    f.git(&["checkout", "-qb", "upstream"]);
    f.write("upstream-only", "upstream\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-qm", "upstream"]);
    f.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    f.git(&[
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
    ]);
    f.git(&["checkout", "-q", "main"]);
    f.write("local-only", "local\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-qm", "local"]);
    f.write("cancel", "away\n");
    f.git(&["add", "cancel"]);
    f.write("cancel", "same\n");
    f.git(&["rm", "--cached", "removed-index"]);
    f.git(&["mv", "tracked-move", "staged-destination"]);
    std::fs::rename(f.dir.path().join("moved"), f.dir.path().join("destination")).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(
        f.dir.path().join("mode"),
        std::fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    f.write("edit", "new\n");
    f.write(".empty", "");
    let index = std::fs::read(f.dir.path().join(".git/index")).unwrap();

    assert_eq!(
        f.request("review-session", "tree?view=changes", false)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let count = f.get("tree?view=changes&limit=0").await;
    assert_eq!(count["total"], 5, "{count}");
    assert_eq!(count["entries"], json!([]));
    let changes = f.get("tree?view=changes").await;
    assert_eq!(row(&changes, "destination")["oldPath"], "moved");
    assert_eq!(
        row(&changes, "staged-destination")["oldPath"],
        "tracked-move"
    );
    assert_eq!(row(&changes, ".empty")["detail"], "untracked");
    assert_eq!(row(&changes, "mode")["detail"], "mode");
    let diff = f.get("tree?view=diff").await;
    assert_eq!(diff["base"]["oid"], base);
    assert_eq!(diff["origin"]["source"], "symbolic");
    assert_eq!(diff["total"], 6, "{diff}");
    assert_eq!(row(&diff, "local-only")["status"], "A");
    let all = f.get("tree?view=all&q=REMOVED-INDEX").await;
    assert_eq!(all["matched"], 1);
    assert!(row(&all, "removed-index")["status"].is_null());

    let generation = parameter(&changes, "generation");
    let edit = parameter(row(&changes, "edit"), "id");
    let empty = parameter(row(&changes, ".empty"), "id");
    let file = format!("file?view=changes&generation={generation}&id={edit}");
    let first = f.get(&file).await;
    assert_eq!(first["before"]["text"], "old\n");
    assert_eq!(first["after"]["text"], "new\n");
    let known = format!("{file}&knownVersion={}", parameter(&first, "version"));
    assert_eq!(f.get(&known).await["kind"], "unchanged");
    f.write("edit", "two\n");
    let second = f.get(&known).await;
    assert_eq!(second["after"]["text"], "two\n");
    assert_ne!(second["version"], first["version"]);
    let stats = f
        .get(&format!(
            "stats?view=changes&generation={generation}&id={edit}&id={empty}"
        ))
        .await;
    assert_eq!(
        stats["items"][0]["stat"],
        json!({"kind":"lines","added":1,"deleted":1})
    );
    assert_eq!(
        stats["items"][1]["stat"],
        json!({"kind":"lines","added":0,"deleted":0})
    );
    let empty = f
        .get(&format!(
            "file?view=changes&generation={generation}&id={empty}"
        ))
        .await;
    assert_eq!(empty["before"]["kind"], "absent");
    assert_eq!(empty["after"]["text"], "");
    assert_eq!(
        std::fs::read(f.dir.path().join(".git/index")).unwrap(),
        index
    );
    f.session("other-session");
    assert_eq!(
        f.request("other-session", &file, true).await.1["code"],
        "review_stale"
    );
    f.write("edit", "old\n");
    f.problem(&file, StatusCode::CONFLICT, "review_stale").await;
}

#[tokio::test]
async fn review_all_pages_raw_paths_empty_directories_and_opaque_sides() {
    use std::os::unix::{ffi::OsStrExt, fs::symlink};
    let f = ReviewFixture::new();
    f.init();
    f.write("tracked", "before\n");
    f.write("gone", "gone\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-qm", "base"]);
    f.write("tracked", "after\n");
    std::fs::remove_file(f.dir.path().join("gone")).unwrap();
    std::fs::create_dir_all(f.dir.path().join("one/empty")).unwrap();
    std::fs::create_dir(f.dir.path().join("one/ignored-empty")).unwrap();
    f.write("one/.gitignore", "ignored-empty/\nhidden\n");
    f.write("one/hidden", "ignored\n");
    f.write(".git/info/exclude", "local-only\n");
    f.write("local-only", "ignored\n");
    f.write(".gitignore", "tracked\n");
    f.write("Z-large", vec![b'x'; 1024 * 1024 + 1]);
    f.write("binary", b"abc\0def");
    f.write("encoding", b"\xff");
    let external = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(external.path(), "outside worktree").unwrap();
    symlink(external.path(), f.dir.path().join("link")).unwrap();
    std::fs::write(
        f.dir
            .path()
            .join(std::ffi::OsStr::from_bytes(b"raw-\xff\n")),
        "raw\n",
    )
    .unwrap();
    let fifo = std::ffi::CString::new(f.dir.path().join("fifo").as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);

    let first = f.get("tree?view=all&limit=1").await;
    let generation = parameter(&first, "generation");
    let cursor = parameter(&first, "nextCursor");
    let second = f
        .get(&format!(
            "tree?view=all&limit=1&generation={generation}&cursor={cursor}"
        ))
        .await;
    assert_ne!(first["entries"][0]["id"], second["entries"][0]["id"]);
    f.problem(
        &format!("tree?view=all&generation={generation}&cursor={cursor}&q=one"),
        StatusCode::CONFLICT,
        "review_stale",
    )
    .await;
    f.problem(
        &format!("tree?view=all&generation={generation}&fresh=1"),
        StatusCode::BAD_REQUEST,
        "review_query",
    )
    .await;
    f.problem(
        "tree?view=all&limit=1001",
        StatusCode::BAD_REQUEST,
        "review_query",
    )
    .await;
    f.problem(
        "stats?view=all&generation=unknown",
        StatusCode::BAD_REQUEST,
        "review_query",
    )
    .await;
    f.problem(
        &format!("file?view=all&generation={generation}&id=unknown"),
        StatusCode::NOT_FOUND,
        "review_entry",
    )
    .await;
    assert_eq!(
        f.request("missing-session", "tree?view=all", true).await.1["code"],
        "session"
    );
    let filtered = f
        .get(&format!("tree?view=all&generation={generation}&q=z-LARGE"))
        .await;
    assert_eq!(filtered["matched"], 1);
    assert_eq!(filtered["total"], first["total"]);
    assert_eq!(filtered["entries"][0]["path"], "Z-large");

    let all = f
        .get(&format!("tree?view=all&generation={generation}"))
        .await;
    assert_eq!(row(&all, "one/empty")["kind"], "directory");
    assert_eq!(row(&all, "tracked")["status"], "M");
    assert!(all["entries"].as_array().unwrap().iter().all(|entry| {
        ![
            ".git",
            "gone",
            "local-only",
            "one/hidden",
            "one/ignored-empty",
        ]
        .contains(&entry["path"].as_str().unwrap())
    }));
    for (name, expected) in [
        ("binary", "binary"),
        ("encoding", "encoding"),
        ("Z-large", "tooLarge"),
        ("link", "symlink"),
        ("fifo", "special"),
        ("raw-\\xff\\u{a}", "text"),
    ] {
        let entry = row(&all, name);
        let file = f
            .get(&format!(
                "file?view=all&generation={generation}&id={}",
                parameter(entry, "id")
            ))
            .await;
        assert!(file["before"].is_null(), "{name}: {file}");
        assert_eq!(file["after"]["kind"], expected, "{name}: {file}");
        if name == "link" {
            assert!(file["after"]["text"].is_null());
        }
    }
    let replacement = tempfile::tempdir().unwrap();
    let displaced = replacement.path().join("displaced");
    std::fs::rename(f.dir.path(), &displaced).unwrap();
    std::fs::create_dir(f.dir.path()).unwrap();
    f.problem(
        &format!("tree?view=all&generation={generation}"),
        StatusCode::CONFLICT,
        "project",
    )
    .await;
}

#[tokio::test]
async fn review_handles_unborn_non_git_conflicts_and_origin_fallback() {
    let f = ReviewFixture::new();
    f.write(".gitignore", "hidden\n");
    f.write("hidden", "ignored");
    f.write(".dot", "dot");
    let all = f.get("tree?view=all").await;
    assert!(all["base"].is_null());
    assert_eq!(all["total"], 2);
    assert!(row(&all, ".dot")["status"].is_null());
    for view in ["changes", "diff"] {
        f.problem(
            &format!("tree?view={view}"),
            StatusCode::UNPROCESSABLE_ENTITY,
            "no_repository",
        )
        .await;
    }

    f.init();
    f.git(&["add", ".dot"]);
    let unborn = f.get("tree?view=changes&fresh=1").await;
    assert!(unborn["head"].is_null());
    assert_eq!(unborn["base"], json!({"kind":"empty","oid":null}));
    assert_eq!(row(&unborn, ".dot")["status"], "A");
    f.problem(
        "tree?view=diff",
        StatusCode::UNPROCESSABLE_ENTITY,
        "no_head",
    )
    .await;
    f.git(&["commit", "-qm", "base"]);
    f.problem(
        "tree?view=diff",
        StatusCode::UNPROCESSABLE_ENTITY,
        "no_origin_default",
    )
    .await;
    f.git(&["checkout", "-qb", "other"]);
    f.write(".dot", "theirs\n");
    f.git(&["commit", "-qam", "theirs"]);
    f.git(&["update-ref", "refs/remotes/origin/master", "HEAD"]);
    f.git(&[
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/absent",
    ]);
    f.git(&["checkout", "-q", "main"]);
    f.write(".dot", "ours\n");
    f.git(&["commit", "-qam", "ours"]);
    f.git(&["checkout", "--detach", "-q", "HEAD"]);
    let conflict = std::process::Command::new("/usr/bin/git")
        .current_dir(f.dir.path())
        .args([
            "-c",
            "user.name=x",
            "-c",
            "user.email=x@y",
            "merge",
            "other",
        ])
        .output()
        .unwrap();
    assert!(!conflict.status.success());
    let diff = f.get("tree?view=diff").await;
    assert_eq!(diff["origin"]["source"], "fallback");
    assert_eq!(diff["origin"]["ref"], "refs/remotes/origin/master");
    let entry = row(&diff, ".dot");
    assert_eq!(entry["status"], "U");
    assert_eq!(entry["detail"], "conflict");
    let generation = parameter(&diff, "generation");
    let id = parameter(entry, "id");
    let document = f
        .get(&format!("file?view=diff&generation={generation}&id={id}"))
        .await;
    assert_eq!(document["before"]["text"], "dot");
    assert!(
        document["after"]["text"]
            .as_str()
            .unwrap()
            .contains("<<<<<<<")
    );
    let stats = f
        .get(&format!("stats?view=diff&generation={generation}&id={id}"))
        .await;
    assert_eq!(
        stats["items"][0]["stat"],
        json!({"kind":"unavailable","reason":"conflict"})
    );
    f.git(&["merge", "--abort"]);
    f.problem(
        &format!("file?view=diff&generation={generation}&id={id}"),
        StatusCode::CONFLICT,
        "review_stale",
    )
    .await;
}

#[tokio::test]
async fn review_linked_worktree_and_shallow_incomplete_ancestry() {
    let linked = ReviewFixture::new();
    let common = tempfile::tempdir().unwrap();
    let upstream = common.path();
    git_at(upstream, &["init", "-q", "-b", "main"]);
    std::fs::write(upstream.join("file"), "base\n").unwrap();
    git_at(upstream, &["add", "."]);
    git_at(upstream, &["commit", "-qm", "base"]);
    git_at(
        upstream,
        &["update-ref", "refs/remotes/origin/main", "HEAD"],
    );
    git_at(
        upstream,
        &[
            "worktree",
            "add",
            "--detach",
            linked.dir.path().to_str().unwrap(),
            "HEAD",
        ],
    );
    linked.write("file", "linked\n");
    let tree = linked.get("tree?view=diff").await;
    let generation = parameter(&tree, "generation");
    let id = parameter(row(&tree, "file"), "id");
    let file = linked
        .get(&format!("file?view=diff&generation={generation}&id={id}"))
        .await;
    assert_eq!(file["before"]["text"], "base\n");
    assert_eq!(file["after"]["text"], "linked\n");

    git_at(upstream, &["checkout", "-qb", "diverged"]);
    std::fs::write(upstream.join("file"), "other\n").unwrap();
    git_at(upstream, &["commit", "-qam", "other"]);
    git_at(upstream, &["checkout", "-q", "main"]);
    std::fs::write(upstream.join("file"), "main\n").unwrap();
    git_at(upstream, &["commit", "-qam", "main"]);
    let shallow = ReviewFixture::new();
    let remote = format!("file://{}", upstream.display());
    shallow.git(&["clone", "--depth=1", "--no-single-branch", &remote, "."]);
    shallow.git(&["checkout", "--detach", "-q", "origin/diverged"]);
    shallow
        .problem(
            "tree?view=diff",
            StatusCode::UNPROCESSABLE_ENTITY,
            "no_merge_base",
        )
        .await;
    assert_eq!(shallow.get("tree?view=changes").await["total"], 0);
}

#[tokio::test]
async fn review_admission_is_independent_and_retryable() {
    let f = ReviewFixture::new();
    let git_slot = f.app.git_review.gate.clone().try_acquire_owned().unwrap();
    let latest = f.get("tree?view=all").await;
    let gate = f.app.review_panel.occupy();
    let busy = f
        .response("review-session", "tree?view=all&fresh=1", true)
        .await;
    assert_eq!(busy.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(busy.headers()["retry-after"], "1");
    let body = busy.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["code"],
        "review_busy"
    );
    assert_eq!(
        f.get("tree?view=all").await["generation"],
        latest["generation"]
    );
    drop(gate);
    assert_ne!(
        f.get("tree?view=all&fresh=1").await["generation"],
        latest["generation"]
    );
    drop(git_slot);
    for query in [
        "tree?view=all&q=%ff",
        "tree?view=all&q=%xy",
        "tree?view=all&view=diff",
    ] {
        f.problem(query, StatusCode::BAD_REQUEST, "review_query")
            .await;
    }
}

#[tokio::test]
async fn review_rejects_ambiguous_ancestry_and_stales_after_baseline_moves() {
    let f = ReviewFixture::new();
    f.init();
    f.write("entry", "base\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-qm", "base"]);
    let root = f.git(&["rev-parse", "HEAD"]);
    let tree = f.git(&["rev-parse", "HEAD^{tree}"]);
    let left = f.git(&["commit-tree", &tree, "-p", &root, "-m", "left"]);
    let right = f.git(&["commit-tree", &tree, "-p", &root, "-m", "right"]);
    let local = f.git(&[
        "commit-tree",
        &tree,
        "-p",
        &left,
        "-p",
        &right,
        "-m",
        "left merge",
    ]);
    let remote = f.git(&[
        "commit-tree",
        &tree,
        "-p",
        &right,
        "-p",
        &left,
        "-m",
        "right merge",
    ]);
    f.git(&["update-ref", "refs/heads/main", &local]);
    f.git(&["update-ref", "refs/remotes/origin/main", &remote]);
    f.problem(
        "tree?view=diff",
        StatusCode::UNPROCESSABLE_ENTITY,
        "ambiguous_merge_base",
    )
    .await;

    f.git(&["update-ref", "refs/remotes/origin/main", &root]);
    f.write("entry", "edit\n");
    let diff = f.get("tree?view=diff&fresh=1").await;
    let generation = parameter(&diff, "generation");
    let id = parameter(row(&diff, "entry"), "id");
    f.git(&["update-ref", "refs/remotes/origin/main", &local]);
    f.problem(
        &format!("file?view=diff&generation={generation}&id={id}"),
        StatusCode::CONFLICT,
        "review_stale",
    )
    .await;
}

#[tokio::test]
async fn review_reconciles_recreated_rename_sources_and_index_stat_flags() {
    let f = ReviewFixture::new();
    f.init();
    f.write("source", "unique\n");
    f.write("duplicate-one", "duplicate\n");
    f.write("duplicate-two", "duplicate\n");
    f.write("flagged", "old\n");
    f.git(&["add", "."]);
    f.git(&["commit", "-qm", "base"]);
    f.git(&["mv", "source", "destination"]);
    f.write("source", "unique\n");
    f.git(&["update-index", "--assume-unchanged", "flagged"]);
    f.write("flagged", "new\n");
    std::fs::remove_file(f.dir.path().join("duplicate-one")).unwrap();
    std::fs::remove_file(f.dir.path().join("duplicate-two")).unwrap();
    f.write("untracked-duplicate", "duplicate\n");
    let changes = f.get("tree?view=changes").await;
    assert_eq!(changes["total"], 5);
    assert_eq!(row(&changes, "destination")["status"], "A");
    assert_eq!(row(&changes, "flagged")["status"], "M");
    assert_eq!(row(&changes, "duplicate-one")["status"], "D");
    assert_eq!(row(&changes, "duplicate-two")["status"], "D");
    assert_eq!(row(&changes, "untracked-duplicate")["status"], "U");
}

#[tokio::test]
async fn review_gitlinks_stay_opaque_and_type_changes_use_typed_sides() {
    use std::os::unix::fs::symlink;
    let f = ReviewFixture::new();
    f.init();
    f.write("type-change", "original\n");
    f.git(&["add", "type-change"]);
    let nested = f.dir.path().join("module");
    std::fs::create_dir(&nested).unwrap();
    git_at(&nested, &["init", "-q", "-b", "main"]);
    std::fs::write(nested.join("nested-file"), "nested\n").unwrap();
    git_at(&nested, &["add", "."]);
    git_at(&nested, &["commit", "-qm", "nested"]);
    let first = git_at(&nested, &["rev-parse", "HEAD"]);
    f.git(&[
        "update-index",
        "--add",
        "--cacheinfo",
        &format!("160000,{first},module"),
    ]);
    f.git(&["commit", "-qm", "base"]);
    std::fs::remove_file(f.dir.path().join("type-change")).unwrap();
    symlink("module/nested-file", f.dir.path().join("type-change")).unwrap();

    let tree = f.get("tree?view=all").await;
    assert_eq!(row(&tree, "module")["kind"], "gitlink");
    assert_eq!(tree["total"], 2);
    let generation = parameter(&tree, "generation");
    let id = parameter(row(&tree, "module"), "id");
    assert_eq!(
        f.get(&format!("file?view=all&generation={generation}&id={id}"))
            .await["after"]["kind"],
        "gitlink"
    );

    let tree = f.get("tree?view=changes").await;
    let entry = row(&tree, "type-change");
    assert_eq!(entry["status"], "M");
    assert_eq!(entry["detail"], "type");
    let generation = parameter(&tree, "generation");
    let id = parameter(entry, "id");
    let doc = f
        .get(&format!(
            "file?view=changes&generation={generation}&id={id}"
        ))
        .await;
    assert_eq!(doc["before"]["text"], "original\n");
    assert_eq!(doc["after"]["kind"], "symlink");
}

#[tokio::test]
async fn review_large_catalog_keeps_header_exact_and_searches_beyond_first_page() {
    let f = ReviewFixture::new();
    f.init();
    let source = f.dir.path().join("src");
    std::fs::create_dir(&source).unwrap();
    for i in 0..10_000 {
        std::fs::write(source.join(format!("file-{i:04}.txt")), "initial text\n").unwrap();
    }
    f.git(&["add", "."]);
    f.git(&["commit", "-qm", "catalog"]);
    for i in 9_900..10_000 {
        std::fs::write(source.join(format!("file-{i:04}.txt")), "changed text\n").unwrap();
    }

    let started = std::time::Instant::now();
    let count = f.get("tree?view=changes&limit=0").await;
    let changes_elapsed = started.elapsed();
    assert_eq!(count["total"], 100);
    assert_eq!(count["entries"], json!([]));

    let started = std::time::Instant::now();
    let all = f.get("tree?view=all&limit=1").await;
    let all_elapsed = started.elapsed();
    assert_eq!(all["total"], 10_001);
    assert_eq!(all["entries"][0]["path"], "src");

    let started = std::time::Instant::now();
    let filtered = f
        .get(&format!(
            "tree?view=all&limit=1&q=FILE-9999&generation={}",
            parameter(&all, "generation")
        ))
        .await;
    let filtered_elapsed = started.elapsed();
    assert_eq!(filtered["matched"], 1);
    assert_eq!(row(&filtered, "src/file-9999.txt")["status"], "M");
    eprintln!(
        "Review 10000 paths and 100 edits: Changes header {changes_elapsed:?}, All {all_elapsed:?}, cached search {filtered_elapsed:?}"
    );
}

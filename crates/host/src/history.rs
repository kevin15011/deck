//! Read-only Deck1 compatibility. Never opens the original recovery, ledger or
//! execution paths. A snapshot pins private descriptors and complete JSONL lines.
#[path = "history_task_continuation.rs"]
mod task_continuation;
use crate::server::App;
#[path = "history_adoption.rs"]
mod adoption;
#[path = "history_tasks.rs"]
mod task_history;
#[path = "history_chat.rs"]
mod chat;
#[path = "history_guard.rs"]
mod guard;
#[path = "history_owner.rs"]
mod owner;
#[path = "history_recovery.rs"]
mod recovery;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    cell::RefCell,
    collections::{BTreeMap, VecDeque},
    ffi::CString,
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::{Component, Path as FsPath, PathBuf},
};
const MAX_LINE: usize = 2 * 1024 * 1024;
const MAX_EVENTS: usize = 1_000_000;
const MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;
fn error(s: &str) -> String {
    format!("Original history: {s}")
}
fn safe(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.contains("..")
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}
fn private(f: &File, directory: bool) -> Result<()> {
    let m = f.metadata().map_err(|_| error("cannot inspect source"))?;
    if m.uid() != unsafe { libc::geteuid() }
        || m.mode() & 0o077 != 0
        || if directory { !m.is_dir() } else { !m.is_file() }
    {
        return Err(error(
            "source ownership, permissions or file type is unsafe",
        ));
    }
    Ok(())
}
fn at(dir: &File, name: &str, directory: bool) -> Result<File> {
    if !safe(name) {
        return Err(error("invalid source identity"));
    }
    let name = CString::new(name).map_err(|_| error("invalid source identity"))?;
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY
                | libc::O_CLOEXEC
                | libc::O_NOFOLLOW
                | libc::O_NONBLOCK
                | if directory { libc::O_DIRECTORY } else { 0 },
        )
    };
    if fd < 0 {
        return Err(error("source unavailable or replaced"));
    }
    let f = unsafe { File::from_raw_fd(fd) };
    private(&f, directory)?;
    Ok(f)
}
fn root(path: &FsPath) -> Result<File> {
    if !path.is_absolute() {
        return Err(error("source root must be absolute"));
    }
    let mut dir = File::open("/").map_err(|_| error("source unavailable"))?;
    for part in path.components() {
        match part {
            Component::RootDir => {}
            Component::Normal(p) => {
                let name = CString::new(p.as_bytes()).map_err(|_| error("invalid source root"))?;
                let fd = unsafe {
                    libc::openat(
                        dir.as_raw_fd(),
                        name.as_ptr(),
                        libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_DIRECTORY,
                    )
                };
                if fd < 0 {
                    return Err(error("source root unavailable or linked"));
                }
                dir = unsafe { File::from_raw_fd(fd) };
            }
            _ => return Err(error("invalid source root")),
        }
    }
    private(&dir, true)?;
    Ok(dir)
}
fn names(dir: &File, max: usize) -> Result<Vec<String>> {
    // Linux descriptor namespace keeps directory replacement from redirecting reads.
    let mut names = Vec::new();
    for item in std::fs::read_dir(format!("/proc/self/fd/{}", dir.as_raw_fd()))
        .map_err(|_| error("cannot list source"))?
    {
        if names.len() >= max {
            return Err(error("source directory exceeds bounded scan"));
        }
        names.push(
            item.map_err(|_| error("cannot list source"))?
                .file_name()
                .into_string()
                .map_err(|_| error("invalid source name"))?,
        );
    }
    names.sort();
    Ok(names)
}
fn stamp(f: &File) -> Result<(u64, u64, u64, i64, i64, i64, i64)> {
    let m = f.metadata().map_err(|_| error("cannot inspect source"))?;
    Ok((
        m.dev(),
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec(),
    ))
}
fn bytes(f: &mut File, max: usize) -> Result<Vec<u8>> {
    private(f, false)?;
    let before = stamp(f)?;
    if before.2 > max as u64 {
        return Err(error("source record too large"));
    }
    f.seek(SeekFrom::Start(0))
        .map_err(|_| error("source read failed"))?;
    let mut b = Vec::new();
    f.take(max as u64 + 1)
        .read_to_end(&mut b)
        .map_err(|_| error("source read failed"))?;
    private(f, false)?;
    if b.len() > max || stamp(f)? != before {
        return Err(error("source changed during read; retry"));
    }
    Ok(b)
}
fn value(dir: &File, name: &str, max: usize) -> Result<Value> {
    serde_json::from_slice(&bytes(&mut at(dir, name, false)?, max)?)
        .map_err(|_| error("malformed source metadata"))
}
fn project_id(path: &str) -> String {
    format!("project-{}", &crate::tasks::digest(path.as_bytes())[..24])
}
fn available(path: &str) -> bool {
    std::fs::canonicalize(path).is_ok_and(|p| p == FsPath::new(path) && p.is_dir())
}
pub fn default_root() -> Option<PathBuf> {
    let xdg = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute());
    xdg.or_else(|| {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .map(|p| p.join(".local/state"))
    })
    .map(|p| p.join("deck"))
}
#[derive(Default)]
pub struct Reader {
    pub root: Option<PathBuf>,
    database: Option<adoption::Database>,
    #[cfg(test)]
    interrupt_adoption: bool,
    owner: Option<owner::Owner>,
    adoption_issue: Option<String>,
    snapshots: VecDeque<Snapshot>,
    summaries: RefCell<BTreeMap<String, (String, Value)>>,
}
struct Segment {
    file: File,
    length: u64,
}
struct Location {
    segment: usize,
    offset: u64,
    length: usize,
    digest: String,
}
struct Snapshot {
    id: String,
    session: String,
    dir: File,
    metadata: Value,
    summary: Value,
    segments: Vec<Segment>,
    records: Vec<Location>,
    attachments: BTreeMap<String, Value>,
    issue: Option<String>,
    visible_answers: BTreeMap<usize, Vec<String>>,
    chat: chat::Index,
    task_history: task_history::Index,
}
impl Snapshot {
    fn raw_line(&self, seq: usize) -> Result<Vec<u8>> {
        use std::os::unix::fs::FileExt;
        let location = self
            .records
            .get(
                seq.checked_sub(1)
                    .ok_or_else(|| error("invalid event reference"))?,
            )
            .ok_or_else(|| error("invalid event reference"))?;
        let f = &self.segments[location.segment].file;
        private(f, false)?;
        let mut b = vec![0; location.length];
        f.read_exact_at(&mut b, location.offset)
            .map_err(|_| error("source truncated"))?;
        if crate::tasks::digest(&b) != location.digest {
            return Err(error("source changed"));
        }
        Ok(b)
    }
    fn event(&self, seq: usize) -> Result<Value> {
        use std::os::unix::fs::FileExt;
        let location = self
            .records
            .get(
                seq.checked_sub(1)
                    .ok_or_else(|| error("invalid event reference"))?,
            )
            .ok_or_else(|| error("invalid event reference"))?;
        let f = &self.segments[location.segment].file;
        private(f, false)?;
        let mut b = vec![0; location.length];
        f.read_exact_at(&mut b, location.offset)
            .map_err(|_| error("source truncated; reopen history"))?;
        if crate::tasks::digest(&b) != location.digest {
            return Err(error("source record changed; reopen history"));
        }
        let mut e: Value =
            serde_json::from_slice(&b).map_err(|_| error("source record changed"))?;
        e.as_object_mut().unwrap().remove("raw");
        if let Some(allowed) = self.visible_answers.get(&seq)
            && let Some(answers) = e["data"]["answers"].as_object_mut()
        {
            answers.retain(|id, _| allowed.contains(id));
        }
        Ok(e)
    }
}
impl Reader {
    fn source(&self) -> Result<File> {
        root(
            self.root
                .as_deref()
                .ok_or_else(|| error("source not configured"))?,
        )
    }
    pub(crate) fn navigation_key(&self, project: &str, id: &str) -> Result<String> {
        let source = crate::tasks::digest(
            self.root
                .as_ref()
                .ok_or_else(|| error("source not configured"))?
                .as_os_str()
                .as_bytes(),
        );
        Ok(json!(["history", source, project, id]).to_string())
    }
    pub(crate) fn adopted_navigation_key(&self, session: &deck2_shared::Session) -> Option<String> {
        let original = session.original.as_ref()?;
        if self.database.as_ref().is_some_and(|db| {
            db.verify_snapshot(&session.id, &original.fingerprint).is_ok()
        }) && self
            .navigation_project(&session.id)
            .is_ok_and(|id| id == session.project.id)
        {
            return self.navigation_key(&session.project.id, &session.id).ok();
        }
        Some(json!(["adopted", original.fingerprint, session.project.id, session.id]).to_string())
    }
    pub(crate) fn navigation_project(&self, id: &str) -> Result<String> {
        if let Some(db) = &self.database {
            return db
                .conn
                .query_row(
                    "SELECT project FROM original_sessions WHERE id=?1 AND ready=1 AND removed=0",
                    [id],
                    |r| r.get(0),
                )
                .map_err(|_| error("unknown original session"));
        }
        let (_, meta) = self.metadata(id)?;
        Ok(project_id(
            meta["projectRoot"]
                .as_str()
                .ok_or_else(|| error("missing project"))?,
        ))
    }
    fn metadata(&self, id: &str) -> Result<(File, Value)> {
        let dir = at(&at(&self.source()?, "sessions", true)?, id, true)?;
        let meta = value(&dir, "session.json", MAX_LINE)?;
        if meta["v"] != 1
            || meta["sessionId"] != id
            || !meta["projectRoot"]
                .as_str()
                .is_some_and(|p| FsPath::new(p).is_absolute())
            || !meta["createdAt"].is_string()
            || !meta["members"].is_object()
        {
            return Err(error("invalid session metadata"));
        }
        if !meta["members"]
            .as_object()
            .unwrap()
            .values()
            .all(|a| a["runnerId"].is_string() && a["modelId"].is_string())
        {
            return Err(error("invalid original runner binding"));
        }
        if let Some(p) = meta["projectId"].as_str()
            && p != project_id(meta["projectRoot"].as_str().unwrap())
        {
            return Err(error("session project identity mismatch"));
        }
        Ok((dir, meta))
    }
    pub(crate) fn catalog(&self) -> Result<Value> {
        if let Some(db) = &self.database {
            return db.catalog();
        }
        let dir = self.source()?;
        let entries = names(&dir, 100_000)?;
        let mut projects = if entries.iter().any(|s| s == "projects.json") {
            let v = value(&dir, "projects.json", 16 * 1024 * 1024)?;
            if v.is_array() {
                v.as_array().unwrap().clone()
            } else if v["v"] == 1 {
                v["projects"]
                    .as_array()
                    .ok_or_else(|| error("invalid project catalog"))?
                    .clone()
            } else {
                return Err(error("invalid project catalog"));
            }
        } else {
            Vec::new()
        };
        if projects.len() > 1000 {
            return Err(error("project catalog exceeds bound"));
        }
        let mut known = BTreeMap::new();
        for p in &mut projects {
            let path = p["path"]
                .as_str()
                .ok_or_else(|| error("invalid project path"))?;
            if !FsPath::new(path).is_absolute()
                || p["projectId"] != project_id(path)
                || !p["name"].is_string()
                || p["hidden"].as_bool().is_none() && !p["hidden"].is_null()
            {
                return Err(error("invalid project identity"));
            }
            if known.insert(project_id(path), ()).is_some() {
                return Err(error("duplicate project identity"));
            }
            p["available"] = json!(available(path));
        }
        let mut issues = Vec::new();
        let mut metadata_bytes = 0;
        if entries.iter().any(|s| s == "sessions") {
            for id in names(&at(&dir, "sessions", true)?, 100_000)? {
                if !safe(&id) {
                    continue;
                }
                match self.metadata(&id) {
                    Ok((_, meta)) => {
                        metadata_bytes += meta.to_string().len();
                        if metadata_bytes > 64 * 1024 * 1024 {
                            return Err(error("session metadata exceeds bounded scan"));
                        }
                        let path = meta["projectRoot"].as_str().unwrap();
                        let pid = project_id(path);
                        if !known.contains_key(&pid) {
                            known.insert(pid.clone(), ());
                            projects.push(json!({"projectId":pid,"path":path,"name":FsPath::new(path).file_name().and_then(|s|s.to_str()).unwrap_or(path),"createdAt":meta["createdAt"],"available":available(path)}));
                        }
                    }
                    Err(e) => issues.push(json!({"sessionId":id,"message":e})),
                }
            }
        }
        Ok(
            json!({"source":crate::tasks::digest(self.root.as_ref().unwrap().as_os_str().as_bytes()),"projects":projects,"issues":issues}),
        )
    }
    fn capture(&self, id: &str) -> Result<Snapshot> {
        self.capture_inner(id, true)
    }
    fn capture_inner(&self, id: &str, conversation: bool) -> Result<Snapshot> {
        let (dir, meta) = self.metadata(id)?;
        let mut snapshot = Snapshot {
            id: uuid::Uuid::new_v4().to_string(),
            session: id.into(),
            dir,
            summary: json!({"sessionId":id,"title":meta["title"].as_str().map(str::to_string).unwrap_or_else(||format!("Session {}",meta["createdAt"].as_str().unwrap().chars().take(10).collect::<String>())),"members":meta["members"],"createdAt":meta["createdAt"],"projectId":project_id(meta["projectRoot"].as_str().unwrap()),"removed":false,"released":false}),
            metadata: meta,
            segments: Vec::new(),
            records: Vec::new(),
            attachments: BTreeMap::new(),
            issue: None,
            visible_answers: BTreeMap::new(),
            chat: chat::Index::default(),
            task_history: task_history::Index::default(),
        };
        let events = at(&snapshot.dir, "events", true)?;
        let files = names(&events, 4096)?
            .into_iter()
            .filter(|n| {
                n.len() == 12 && n.ends_with(".jsonl") && n[..6].bytes().all(|b| b.is_ascii_digit())
            })
            .collect::<Vec<_>>();
        if files.len() > 1024 {
            return Err(error("too many event segments"));
        }
        let mut total = 0;
        // Capture every descriptor/length before scanning; a rotation or append
        // after this point cannot extend this snapshot's complete-record boundary.
        for name in &files {
            let file = at(&events, name, false)?;
            let length = stamp(&file)?.2;
            total += length;
            if total > MAX_BYTES {
                return Err(error("history exceeds bounded snapshot size"));
            }
            if length == 0 && snapshot.segments.len() + 1 < files.len() {
                return Err(error("sealed event segment is empty"));
            }
            snapshot.segments.push(Segment { file, length });
        }
        let mut chat = chat::Index::default();
        let mut event_count = 0usize;
        let mut attachment_bytes = 0usize;
        let mut questions = BTreeMap::<String, Vec<String>>::new();
        for index in 0..snapshot.segments.len() {
            let segment = &snapshot.segments[index];
            private(&segment.file, false)?;
            let before = stamp(&segment.file)?;
            let mut reader = BufReader::new((&segment.file).take(segment.length));
            let mut offset = 0;
            let mut line = Vec::new();
            while offset < segment.length {
                line.clear();
                let count = reader
                    .by_ref()
                    .take(MAX_LINE as u64 + 1)
                    .read_until(b'\n', &mut line)
                    .map_err(|_| error("event read failed"))?;
                if count == 0 || line.len() > MAX_LINE {
                    return Err(error("event record exceeds bound"));
                }
                if line.last() != Some(&b'\n') {
                    if index + 1 != snapshot.segments.len() {
                        return Err(error("sealed event segment is incomplete"));
                    }
                    snapshot.issue = Some(
                        "The latest record is incomplete; showing complete saved records only."
                            .into(),
                    );
                    break;
                }
                let event: Value = serde_json::from_slice(&line)
                    .map_err(|_| error("malformed complete event record"))?;
                let seq = event_count + 1;
                if event["v"] != 1
                    || event["sessionId"] != id
                    || event["seq"].as_u64() != Some(seq as u64)
                    || !event["kind"].is_string()
                    || !event["ts"].is_string()
                    || !event["source"].is_object()
                    || !event["data"].is_object()
                {
                    return Err(error("event envelope or sequence is invalid"));
                }
                if seq > MAX_EVENTS {
                    return Err(error("too many events in snapshot"));
                }
                let d = &event["data"];
                if conversation && event["kind"] == "question.requested" {
                    let allowed = d["questions"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|q| q["secret"] != true)
                        .filter_map(|q| q["id"].as_str().map(str::to_string))
                        .collect();
                    questions.insert(d["questionId"].as_str().unwrap_or("").into(), allowed);
                }
                if conversation && event["kind"] == "question.resolved" {
                    snapshot.visible_answers.insert(
                        seq,
                        questions
                            .remove(d["questionId"].as_str().unwrap_or(""))
                            .unwrap_or_default(),
                    );
                }
                match event["kind"].as_str().unwrap() {
                    "session.renamed" if d["title"].is_string() => {
                        snapshot.summary["title"] = d["title"].clone()
                    }
                    "session.removed" => {
                        snapshot.summary["removed"] = json!(d["phase"] == "removed");
                        snapshot.summary["removing"] = json!(d["phase"] != "removed");
                        if d["phase"] == "removed" {
                            snapshot.summary["deletedAt"] = event["ts"].clone();
                        }
                    }
                    "session.released" => snapshot.summary["released"] = json!(true),
                    "session.reopened" => {
                        snapshot.summary["released"] = json!(d["prepared"] != true)
                    }
                    "session.assignment" => {
                        if let Some(member) = d["memberId"].as_str()
                            && d["assignment"]["runnerId"].is_string()
                            && d["assignment"]["modelId"].is_string()
                        {
                            snapshot.summary["members"][member] = d["assignment"].clone();
                        }
                    }
                    _ => {}
                }
                if conversation { snapshot.task_history.observe(&event)?; }
                if conversation && let Some(attachments) = d["attachments"].as_array() {
                    for a in attachments {
                        if let Some(aid) = a["attachmentId"].as_str()
                            && uuid::Uuid::parse_str(aid).is_ok()
                        {
                            if snapshot.attachments.len() >= 100_000 {
                                return Err(error("too many attachment references"));
                            }
                            attachment_bytes += a.to_string().len();
                            if attachment_bytes > 16 * 1024 * 1024 {
                                return Err(error("attachment references exceed bounded snapshot"));
                            }
                            snapshot.attachments.insert(aid.into(), a.clone());
                        }
                    }
                }
                snapshot.summary["updatedAt"] = event["ts"].clone();
                event_count += 1;
                if conversation {
                    snapshot.records.push(Location {
                        segment: index,
                        offset,
                        length: count,
                        digest: crate::tasks::digest(&line),
                    });
                    chat.apply(&event, &snapshot)?;
                }
                offset += count as u64;
            }
            private(&segment.file, false)?;
            let after = stamp(&segment.file)?;
            if after.2 < segment.length
                || (before != after
                    && (index + 1 != snapshot.segments.len() || before.2 == after.2))
            {
                return Err(error("source changed during capture; retry"));
            }
        }
        snapshot.summary["lastSeq"] = json!(event_count);
        snapshot.chat = chat;
        Ok(snapshot)
    }
    fn summary_stamp(&self, id: &str) -> Result<String> {
        let (dir, _) = self.metadata(id)?;
        let meta = at(&dir, "session.json", false)?;
        let events = at(&dir, "events", true)?;
        let mut stamps = vec![format!("{:?}:{:?}", stamp(&dir)?, stamp(&meta)?)];
        for name in names(&events, 4096)? {
            if name.len() == 12
                && name.ends_with(".jsonl")
                && name[..6].bytes().all(|b| b.is_ascii_digit())
            {
                stamps.push(format!(
                    "{}:{:?}",
                    name,
                    stamp(&at(&events, &name, false)?)?
                ));
            }
        }
        Ok(stamps.join("|"))
    }
    fn summary(&self, id: &str) -> Result<Value> {
        let before = self.summary_stamp(id)?;
        if let Some((stamp, summary)) = self.summaries.borrow().get(id)
            && *stamp == before
        {
            return Ok(summary.clone());
        }
        let s = self.capture_inner(id, false)?;
        let mut summary = s.summary;
        summary["issue"] = json!(s.issue);
        if self.summary_stamp(id)? == before {
            let mut cache = self.summaries.borrow_mut();
            if cache.len() >= 1024 {
                cache.clear();
            }
            cache.insert(id.into(), (before, summary.clone()));
        }
        Ok(summary)
    }
    fn sessions(&self, project: &str, q: &ListQuery) -> Result<Value> {
        if let Some(db) = &self.database {
            return db.sessions(project, q);
        }
        let catalog = self.catalog()?;
        if !catalog["projects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["projectId"] == project)
        {
            return Err(error("unknown project"));
        }
        let limit = q.limit.unwrap_or(30);
        if !(1..=100).contains(&limit) {
            return Err(error("invalid page limit"));
        }
        let mut all = Vec::new();
        let mut metadata_bytes = 0;
        for id in names(&at(&self.source()?, "sessions", true)?, 100_000)? {
            if !safe(&id) {
                continue;
            }
            if let Ok((_, meta)) = self.metadata(&id)
                && project_id(meta["projectRoot"].as_str().unwrap()) == project
            {
                metadata_bytes += meta.to_string().len();
                if metadata_bytes > 64 * 1024 * 1024 {
                    return Err(error("session metadata exceeds bounded scan"));
                }
                all.push(meta);
            }
        }
        all.sort_by(|a, b| {
            b["createdAt"]
                .as_str()
                .cmp(&a["createdAt"].as_str())
                .then_with(|| b["sessionId"].as_str().cmp(&a["sessionId"].as_str()))
        });
        let cursor = |m: &Value| {
            format!(
                "{}|{}",
                m["createdAt"].as_str().unwrap(),
                m["sessionId"].as_str().unwrap()
            )
        };
        let start = match &q.cursor {
            None => 0,
            Some(c) => {
                all.iter()
                    .position(|m| cursor(m) == *c)
                    .ok_or_else(|| error("session cursor no longer exists"))?
                    + 1
            }
        };
        let mut sessions = Vec::new();
        let mut index = start;
        while index < all.len() && sessions.len() < limit {
            let meta = &all[index];
            let id = meta["sessionId"].as_str().unwrap();
            index += 1;
            match self.summary(id) {
                Ok(summary)=>{if summary["removed"]==true{continue;}sessions.push(summary);},
                Err(e)=>sessions.push(json!({"sessionId":id,"title":meta["title"].as_str().unwrap_or(id),"members":meta["members"],"createdAt":meta["createdAt"],"issue":e}))
            }
        }
        Ok(
            json!({"sessions":sessions,"nextCursor":if index<all.len(){all.get(index-1).map(cursor)}else{None}}),
        )
    }

    fn page(&mut self, id: &str, q: &PageQuery) -> Result<Value> {
        if let Some(db) = &self.database {
            return db.page(id, q);
        }
        let limit = q.limit.unwrap_or(100);
        if !(1..=100).contains(&limit) {
            return Err(error("invalid page limit"));
        }
        if q.snapshot.is_none() {
            if q.after.is_some() || q.before.is_some() || q.tasks_after.is_some() {
                return Err(error("snapshot required for history cursor"));
            }
            let s = self.capture(id)?;
            if self.snapshots.len() >= 2 {
                self.snapshots.pop_front();
            }
            self.snapshots.push_back(s);
        }
        let s = match &q.snapshot {
            Some(token) => self
                .snapshots
                .iter_mut()
                .find(|s| s.id == *token && s.session == id),
            None => self.snapshots.back_mut(),
        }
        .ok_or_else(|| error("snapshot expired; reopen this history"))?;
        if q.before.is_some() && q.after.is_some() {
            return Err(error("choose one conversation cursor"));
        }
        let mut page = s.chat.page(s, q.task_id.as_deref(), q.attempt, q.before, q.after, limit)?;
        let (tasks,next) = if q.include_tasks {
            let (values,next) = task_history::page(s.task_history.values().cloned(),q.tasks_after.as_deref())?;
            let mut materialized=Vec::new();
            for task in values {for seq in s.task_history.refs(task["id"].as_str().unwrap()) {s.event(*seq)?;}materialized.push(task_history::materialize(task,|seq|s.event(seq))?);}
            let (tasks,byte_next)=task_history::page(materialized.into_iter(),None)?;
            (tasks,byte_next.or(next))
        } else {(Vec::new(),None)};
        page["agentTasks"] = json!(tasks); page["nextTask"] = json!(next);
        page["session"] = json!(id); page["taskId"] = json!(q.task_id); page["attempt"] = json!(q.attempt);
        Ok(page)
    }
    #[cfg(test)]
    fn raw_page(&mut self, id: &str, q: &PageQuery) -> Result<Value> {
        let limit = q.limit.unwrap_or(100);
        if !(1..=100).contains(&limit) {
            return Err(error("invalid page limit"));
        }
        if q.snapshot.is_none() {
            if q.after.unwrap_or(0) != 0 {
                return Err(error("snapshot required for history cursor"));
            }
            let s = self.capture(id)?;
            if self.snapshots.len() >= 2 {
                self.snapshots.pop_front();
            }
            self.snapshots.push_back(s);
        }
        let s = match &q.snapshot {
            Some(token) => self
                .snapshots
                .iter_mut()
                .find(|s| s.id == *token && s.session == id),
            None => self.snapshots.back_mut(),
        }
        .ok_or_else(|| error("snapshot expired; reopen this history"))?;
        let start = q.after.unwrap_or(0);
        if start > s.records.len() {
            return Err(error("history cursor exceeds boundary"));
        }
        let mut events = Vec::new();
        let mut size = 0;
        let mut next = start;
        for location in s.records.iter().skip(start).take(limit) {
            if size + location.length > MAX_LINE && !events.is_empty() {
                break;
            }
            let f = &mut s.segments[location.segment].file;
            f.seek(SeekFrom::Start(location.offset))
                .map_err(|_| error("source seek failed"))?;
            let mut b = vec![0; location.length];
            f.read_exact(&mut b)
                .map_err(|_| error("source truncated; reopen history"))?;
            if crate::tasks::digest(&b) != location.digest {
                return Err(error("source record changed; reopen history"));
            }
            let mut event: Value =
                serde_json::from_slice(&b).map_err(|_| error("source record changed"))?;
            // Preserve raw source on disk, but match original browser privacy:
            // no native raw payload or secret answers cross this transport.
            event.as_object_mut().unwrap().remove("raw");
            if let Some(allowed) = s.visible_answers.get(&(next + 1)) {
                let mut answers = event["data"]["answers"]
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                answers.retain(|id, _| allowed.contains(id));
                if event["data"].get("answers").is_some() {
                    event["data"]["answers"] = Value::Object(answers);
                }
            }
            events.push(event);
            size += location.length;
            next += 1;
        }
        Ok(
            json!({"metadata":s.metadata,"summary":s.summary,"snapshot":s.id,"boundary":s.records.len(),"events":events,"nextAfter":next,"hasMore":next<s.records.len(),"issue":s.issue}),
        )
    }
    fn image(&self, id: &str, image: &str, token: &str) -> Result<(String, Vec<u8>)> {
        let captured;
        let adopted = if let Some(db) = &self.database {
            db.verify_snapshot(id, token)?;
            if crate::tasks::digest(self.summary_stamp(id)?.as_bytes()) != token {
                return Err(error("original image source changed"));
            }
            captured = self.capture(id)?;
            Some(&captured)
        } else {
            None
        };
        if uuid::Uuid::parse_str(image).is_err() {
            return Err(error("invalid image identity"));
        }
        let s = adopted
            .or_else(|| {
                self.snapshots
                    .iter()
                    .find(|s| s.id == token && s.session == id)
            })
            .ok_or_else(|| error("snapshot expired; reopen history"))?;
        let expected = s
            .attachments
            .get(image)
            .ok_or_else(|| error("image is not referenced by this session"))?;
        let dir = at(&s.dir, "attachments", true)?;
        let stored = value(&dir, &format!("{image}.json"), 4096)?;
        if &stored["attachment"] != expected {
            return Err(error("attachment metadata changed"));
        }
        let b = bytes(
            &mut at(&dir, &format!("{image}.image"), false)?,
            crate::images::MAX_IMAGE,
        )?;
        let parsed = crate::images::validate(&b)?;
        if stored["digest"] != parsed.digest
            || expected["sizeBytes"] != parsed.size
            || expected["mimeType"] != parsed.mime
            || expected["width"] != parsed.width
            || expected["height"] != parsed.height
        {
            return Err(error("attachment integrity failed"));
        }
        Ok((parsed.mime, b))
    }
}
#[derive(Deserialize, Default)]
struct ListQuery {
    cursor: Option<String>,
    limit: Option<usize>,
}
#[derive(Deserialize, Default)]
struct PageQuery {
    snapshot: Option<String>,
    after: Option<usize>,
    before: Option<usize>,
    #[serde(rename = "taskId")]
    task_id: Option<String>,
    attempt: Option<u64>,
    #[serde(rename = "tasksAfter")]
    tasks_after: Option<String>,
    #[serde(default, rename = "includeTasks")]
    include_tasks: bool,
    limit: Option<usize>,
}
#[derive(Deserialize)]
struct ImageQuery {
    snapshot: String,
}
async fn blocking<T: Send + 'static>(
    app: App,
    op: impl FnOnce(&mut Reader) -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(move || {
        let mut reader = app
            .history
            .lock()
            .map_err(|_| error("reader unavailable"))?;
        op(&mut reader)
    })
    .await
    .map_err(|_| error("reader unavailable"))?
}
fn response<T: serde::Serialize>(r: Result<T>) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::CONFLICT, Json(json!({"message":e}))).into_response(),
    }
}
async fn projects(State(app): State<App>) -> Response {
    response(
        blocking(app, |r| {
            if r.root.is_none() {
                Ok(json!({"projects":[],"issues":[]}))
            } else {
                match r.catalog() {
                    Ok(mut v) => {
                        if let Some(issue) = &r.adoption_issue {
                            v["adoptionIssue"] = json!(issue);
                        }
                        Ok(v)
                    }
                    Err(e) => Ok(json!({"projects":[],"issues":[{"message":e}]})),
                }
            }
        })
        .await,
    )
}
async fn sessions(
    State(app): State<App>,
    Path(id): Path<String>,
    Query(q): Query<ListQuery>,
) -> Response {
    response(blocking(app, move |r| r.sessions(&id, &q)).await)
}
async fn page(
    State(app): State<App>,
    Path(id): Path<String>,
    Query(q): Query<PageQuery>,
) -> Response {
    response(blocking(app, move |r| r.page(&id, &q)).await)
}
async fn image(
    State(app): State<App>,
    Path((id, img)): Path<(String, String)>,
    Query(q): Query<ImageQuery>,
) -> Response {
    match blocking(app, move |r| r.image(&id, &img, &q.snapshot)).await {
        Ok((mime, b)) => ([(header::CONTENT_TYPE, mime)], b).into_response(),
        Err(e) => response::<Value>(Err(e)),
    }
}
async fn activate(State(app): State<App>, Path(id): Path<String>) -> Response {
    let result = tokio::task::spawn_blocking(crate::web_identity::inherit_blocking(move || {
        let binary = app.selected_binary()?;
        let reader = app
            .history
            .lock()
            .map_err(|_| error("history unavailable"))?;
        let mut store = app.store.lock().map_err(|_| error("store unavailable"))?;
        reader.activate(
            &id,
            &mut store,
            &binary,
            &app.native_role_root.lock().unwrap(),
        )
    }))
    .await
    .map_err(|_| error("continuation unavailable"))
    .and_then(|r| r);
    response(result)
}
pub fn routes() -> Router<App> {
    Router::new()
        .route("/api/history/projects", get(projects))
        .route("/api/history/sessions/{id}/activate", post(activate))
        .route("/api/history/projects/{id}/sessions", get(sessions))
        .route("/api/history/sessions/{id}", get(page))
        .route("/api/history/sessions/{id}/images/{image}", get(image))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};
    struct Fixture {
        tmp: tempfile::TempDir,
        reader: Reader,
    }
    fn write(path: &FsPath, b: impl AsRef<[u8]>) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        let mut p = path.parent();
        while let Some(dir) = p {
            if dir
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(".tmp"))
            {
                break;
            }
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).unwrap();
            p = dir.parent();
        }
    }
    fn event(seq: u64, kind: &str, data: Value) -> Value {
        json!({"v":1,"sessionId":"original","seq":seq,"ts":"2026-01-01T00:00:00Z","kind":kind,"source":{"taskId":"lead","memberId":"lead","runnerId":"unsupported","attempt":3},"data":data})
    }
    fn lines(events: &[Value]) -> String {
        events.iter().map(|e| format!("{e}\n")).collect()
    }
    impl Fixture {
        fn new() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o700)).unwrap();
            let base = tmp.path();
            let meta = json!({"v":1,"sessionId":"original","projectRoot":"/missing-original","title":"initial","createdAt":"2026-01-01T00:00:00Z","members":{"lead":{"runnerId":"unsupported","modelId":"old"}},"unknown":{"preserve":true}});
            write(
                &base.join("sessions/original/session.json"),
                meta.to_string(),
            );
            write(
                &base.join("sessions/original/events/000001.jsonl"),
                lines(&[
                    event(
                        1,
                        "session.created",
                        json!({"projectRoot":"/missing-original","members":meta["members"]}),
                    ),
                    event(2, "session.renamed", json!({"title":"renamed"})),
                ]),
            );
            Self {
                reader: Reader {
                    root: Some(base.into()),
                    ..Default::default()
                },
                tmp,
            }
        }
        fn path(&self, name: &str) -> PathBuf {
            self.tmp.path().join("sessions/original").join(name)
        }
        fn page(&mut self) -> Value {
            self.reader
                .raw_page("original", &PageQuery::default())
                .unwrap()
        }
    }
    // Protects a stable complete-record boundary across live append/rotation and
    // exact raw preservation. Oracle: EventLog.readAfter excludes unterminated data.
    #[test]
    fn snapshot_pages_pin_prefix_without_repair_or_replay() {
        let mut f = Fixture::new();
        let tail = lines(&[event(
            3,
            "future.unknown",
            json!({"nested":[1,{"opaque":true}]}),
        )]) + "{unfinished";
        write(&f.path("events/000002.jsonl"), &tail);
        let p = f.page();
        assert_eq!(p["boundary"], 3);
        assert_eq!(p["summary"]["title"], "renamed");
        assert_eq!(p["metadata"]["unknown"], json!({"preserve":true}));
        assert!(p["issue"].is_string());
        assert_eq!(
            fs::read_to_string(f.path("events/000002.jsonl")).unwrap(),
            tail
        );
        // Append past the captured length; previous record hashes remain usable.
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(f.path("events/000002.jsonl"))
            .unwrap();
        use std::io::Write;
        file.write_all(b"more-incomplete").unwrap();
        let q = PageQuery {
            snapshot: Some(p["snapshot"].as_str().unwrap().into()),
            after: Some(2),
            limit: Some(1),
            ..Default::default()
        };
        let next = f.reader.raw_page("original", &q).unwrap();
        assert_eq!(
            next["events"],
            json!([event(
                3,
                "future.unknown",
                json!({"nested":[1,{"opaque":true}]})
            )])
        );
        assert_eq!(next["boundary"], 3);
        assert_eq!(next["hasMore"], false);
        assert!(f.reader.raw_page("foreign", &q).is_err());
        assert!(
            f.reader
                .raw_page("../original", &PageQuery::default())
                .is_err()
        );
        // Same-sized content replacement must never masquerade as a snapshot page.
        let altered = lines(&[
            event(1, "session.created", json!({"changed":true})),
            event(2, "session.renamed", json!({"title":"renamed"})),
        ]);
        write(&f.path("events/000001.jsonl"), altered);
        assert!(
            f.reader
                .raw_page(
                    "original",
                    &PageQuery {
                        snapshot: q.snapshot,
                        after: Some(0),
                        limit: Some(1),
                        ..Default::default()
                    }
                )
                .is_err()
        );
    }
    // Protects the original browser privacy boundary while source bytes remain lossless.
    #[test]
    fn raw_payloads_and_secret_or_unmatched_answers_never_cross_browser_transport() {
        let mut f = Fixture::new();
        let mut secret = event(
            4,
            "question.resolved",
            json!({"questionId":"q","answers":{"public":["visible"],"secret":["credential"]}}),
        );
        secret["raw"] = json!({"payload":{"password":"credential"}});
        let tail = lines(&[
            event(
                3,
                "question.requested",
                json!({"questionId":"q","questions":[{"id":"public"},{"id":"secret","secret":true}]}),
            ),
            secret,
            event(
                5,
                "question.resolved",
                json!({"questionId":"missing","answers":{"unknown":["credential"]}}),
            ),
        ]);
        write(&f.path("events/000002.jsonl"), &tail);
        let p = f.page();
        assert_eq!(
            p["events"][3]["data"]["answers"],
            json!({"public":["visible"]})
        );
        assert!(p["events"][3]["raw"].is_null());
        assert_eq!(p["events"][4]["data"]["answers"], json!({}));
        assert_eq!(
            fs::read_to_string(f.path("events/000002.jsonl")).unwrap(),
            tail
        );
    }
    // Protects safe failure for damaged histories without original recovery writes.
    #[test]
    fn malformed_sequence_and_sealed_tail_are_reported_without_mutation() {
        for content in [
            "{}\n".to_string(),
            lines(&[event(4, "future.unknown", json!({}))]),
            "{unfinished".to_string(),
        ] {
            let f = Fixture::new();
            write(&f.path("events/000001.jsonl"), &content);
            write(&f.path("events/000002.jsonl"), "");
            assert!(f.reader.capture("original").is_err());
            assert_eq!(
                fs::read_to_string(f.path("events/000001.jsonl")).unwrap(),
                content
            );
        }
        let f = Fixture::new();
        write(&f.path("events/000002.jsonl"), "{}\n");
        assert!(f.reader.capture("original").is_err());
    }
    // Protects descriptor confinement and authenticated-owner file provenance.
    #[test]
    fn source_links_public_files_and_foreign_metadata_are_refused() {
        let f = Fixture::new();
        let meta = f.path("session.json");
        let original = fs::read(&meta).unwrap();
        fs::rename(&meta, f.path("saved.json")).unwrap();
        std::os::unix::fs::symlink(f.path("saved.json"), &meta).unwrap();
        assert!(f.reader.capture("original").is_err());
        fs::remove_file(&meta).unwrap();
        write(&meta, &original);
        fs::set_permissions(&meta, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(f.reader.capture("original").is_err());
        write(
            &meta,
            String::from_utf8(original)
                .unwrap()
                .replace("\"original\"", "\"foreign\""),
        );
        assert!(f.reader.capture("original").is_err());
        let linked = f.tmp.path().join("link");
        std::os::unix::fs::symlink(f.tmp.path(), &linked).unwrap();
        assert!(root(&linked).is_err());
    }
    // Protects session reference ownership and immutable attachment bytes. Oracle:
    // original AttachmentStore metadata/digest/dimension checks; no staging or GC.
    #[test]
    fn images_require_snapshot_reference_integrity_and_confined_descriptors() {
        let mut f = Fixture::new();
        let id = "12345678-1234-1234-1234-123456789abc";
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1, 1)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let data = png.into_inner();
        let a = json!({"attachmentId":id,"mimeType":"image/png","name":"original.png","sizeBytes":data.len(),"width":1,"height":1});
        write(&f.path("attachments").join(format!("{id}.image")), &data);
        let meta = json!({"attachment":a,"digest":crate::tasks::digest(&data),"createdAt":1});
        write(
            &f.path("attachments").join(format!("{id}.json")),
            meta.to_string(),
        );
        write(
            &f.path("events/000002.jsonl"),
            lines(&[event(
                3,
                "message.completed",
                json!({"role":"user","text":"look","attachments":[a]}),
            )]),
        );
        let p = f.page();
        let token = p["snapshot"].as_str().unwrap();
        assert_eq!(f.reader.image("original", id, token).unwrap().1, data);
        assert!(f.reader.image("foreign", id, token).is_err());
        assert!(
            f.reader
                .image("original", "aaaaaaaa-1234-1234-1234-123456789abc", token)
                .is_err()
        );
        // Renaming/replacing the session directory cannot redirect its pinned images.
        fs::rename(
            f.tmp.path().join("sessions/original"),
            f.tmp.path().join("sessions/moved"),
        )
        .unwrap();
        fs::create_dir(f.tmp.path().join("sessions/original")).unwrap();
        assert_eq!(f.reader.image("original", id, token).unwrap().1, data);
        let img = f
            .tmp
            .path()
            .join("sessions/moved/attachments")
            .join(format!("{id}.image"));
        fs::remove_file(&img).unwrap();
        std::os::unix::fs::symlink(f.tmp.path().join("sessions/moved/session.json"), &img).unwrap();
        assert!(f.reader.image("original", id, token).is_err());
    }
    // Protects original creation ordering/cursors, unavailable and hidden projects,
    // unknown metadata and capacity independence from new-session admission.
    #[test]
    fn catalog_and_session_pages_preserve_original_identity_and_order() {
        let f = Fixture::new();
        let p = project_id("/missing-original");
        write(&f.tmp.path().join("projects.json"),json!({"v":1,"projects":[{"projectId":p,"path":"/missing-original","name":"renamed project","createdAt":"2020-01-01Z","hidden":true,"future":7}],"registrations":{}}).to_string());
        let catalog = f.reader.catalog().unwrap();
        assert_eq!(catalog["projects"][0]["future"], 7);
        assert_eq!(catalog["projects"][0]["hidden"], true);
        assert_eq!(catalog["projects"][0]["available"], false);
        for i in 0..70 {
            let id = format!("older-{i:03}");
            write(&f.tmp.path().join("sessions").join(&id).join("session.json"),json!({"v":1,"sessionId":id,"projectRoot":"/missing-original","createdAt":"2020-01-01T00:00:00Z","title":id,"members":{}}).to_string());
            let events = f.tmp.path().join("sessions").join(id).join("events");
            fs::create_dir(&events).unwrap();
            fs::set_permissions(&events, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let mut ids = Vec::new();
        let mut q = ListQuery {
            limit: Some(30),
            ..Default::default()
        };
        loop {
            let page = f.reader.sessions(&p, &q).unwrap();
            ids.extend(
                page["sessions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| s["sessionId"].as_str().unwrap().to_string()),
            );
            q.cursor = page["nextCursor"].as_str().map(str::to_string);
            if q.cursor.is_none() {
                break;
            }
        }
        assert_eq!(ids.len(), 71);
        assert_eq!(ids[0], "original");
        assert_eq!(ids[1], "older-069");
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            71
        );
    }
    // Protects Deck1 newest conversation pages and stable first-event cursors.
    // Oracle: ChatHistory.apply/materialize/page; lifecycle density is irrelevant.
    #[test]
    fn conversation_pages_fold_deltas_and_scope_before_paging() {
        let mut f = Fixture::new();
        let mut rows = Vec::new();
        let mut seq = 3;
        for i in 0..130 {
            for _ in 0..8 {
                rows.push(event(seq, "task.state", json!({"state":"running"})));
                seq += 1;
            }
            let mut task = event(
                seq,
                "message.completed",
                json!({"text":format!("worker {i}")}),
            );
            task["source"] = json!({"taskId":"worker","memberId":"worker"});
            rows.push(task);
            seq += 1;
            let first = seq;
            for delta in ["hel", "lo"] {
                rows.push(event(seq, "message.delta", json!({"text":delta})));
                seq += 1;
            }
            rows.push(event(
                seq,
                "message.completed",
                json!({"text":format!("answer {i}"),"role":"assistant"}),
            ));
            seq += 1;
            assert_eq!(seq - first, 3);
        }
        rows.push(event(
            seq,
            "message.completed",
            json!({"role":"system","text":"hidden"}),
        ));
        seq += 1;
        rows.push(event(seq, "future.unknown", json!({"text":"opaque"})));
        write(&f.path("events/000002.jsonl"), lines(&rows));
        let p = f
            .reader
            .page(
                "original",
                &PageQuery {
                    limit: Some(40),
                    ..Default::default()
                },
            )
            .unwrap();
        let messages = p["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 40);
        assert_eq!(messages[0]["data"]["text"], "answer 90");
        assert_eq!(messages[39]["data"]["text"], "answer 129");
        assert_eq!(
            messages[0]["seq"].as_u64().unwrap(),
            messages[0]["historyId"].as_u64().unwrap() + 2
        );
        let token = p["snapshot"].as_str().unwrap().to_string();
        let older = f
            .reader
            .page(
                "original",
                &PageQuery {
                    snapshot: Some(token.clone()),
                    before: Some(p["before"].as_u64().unwrap() as usize),
                    limit: Some(40),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(older["messages"][39]["data"]["text"], "answer 89");
        let worker = f
            .reader
            .page(
                "original",
                &PageQuery {
                    snapshot: Some(token.clone()),
                    task_id: Some("worker".into()),
                    limit: Some(40),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(worker["messages"][39]["data"]["text"], "worker 129");
        let before = fs::read(f.path("events/000002.jsonl")).unwrap();
        // A later completion cannot move a pinned row or append into its snapshot.
        use std::io::Write;
        fs::OpenOptions::new()
            .append(true)
            .open(f.path("events/000002.jsonl"))
            .unwrap()
            .write_all(
                lines(&[event(seq + 1, "message.completed", json!({"text":"later"}))]).as_bytes(),
            )
            .unwrap();
        let same = f
            .reader
            .page(
                "original",
                &PageQuery {
                    snapshot: Some(token),
                    limit: Some(40),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(same["messages"], p["messages"]);
        assert!(
            fs::read(f.path("events/000002.jsonl"))
                .unwrap()
                .starts_with(&before)
        );
    }
    // Protects passive delegated history identity, results and attempt-scoped paging.
    // Oracle: recorded task lifecycle/assignment and the selected task/attempt only.
    #[test]
    fn original_agent_attempts_are_visible_and_scoped() {
        let mut f = Fixture::new();
        let mut rows = Vec::new();
        let mut push = |kind: &str, data: Value, _attempt: u64| {
            let mut e = event(3 + rows.len() as u64, kind, data);
            e["source"] = json!({"taskId":"worker","memberId":"quality"});
            rows.push(e);
        };
        push("task.created", json!({"taskId":"worker","memberId":"quality","runnerId":"codex","modelId":"recorded-model"}), 1);
        push("message.completed", json!({"role":"user","text":"first assignment"}), 1);
        push("message.delta", json!({"text":"first "}), 1);
        push("message.completed", json!({"role":"assistant","text":"first answer"}), 1);
        push("task.result", json!({"summary":"first result"}), 1);
        push("task.state", json!({"state":"completed"}), 1);
        push("task.continued", json!({"attempt":2}), 2);
        push("message.completed", json!({"role":"user","text":"second assignment"}), 2);
        push("message.completed", json!({"role":"assistant","text":"second answer"}), 2);
        push("task.result", json!({"summary":"second result"}), 2);
        push("task.state", json!({"state":"failed"}), 2);
        write(&f.path("events/000002.jsonl"), lines(&rows));
        let p = f.reader.page("original", &PageQuery {include_tasks:true,..Default::default()}).unwrap();
        let tasks = p["agentTasks"].as_array().expect("historical agents must reach normal session reads");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["member"], "quality");
        assert_eq!(tasks[0]["attempts"][0]["result"]["text"], "first result");
        assert_eq!(tasks[0]["attempts"][1]["state"], "failed");
        assert_eq!(tasks[0]["attempts"][1]["model"], "recorded-model");
        let expected = tasks.clone();
        let q = PageQuery {snapshot:Some(p["snapshot"].as_str().unwrap().into()),task_id:Some("worker".into()),attempt:Some(1),limit:Some(1),..Default::default()};
        let first = f.reader.page("original",&q).unwrap();
        assert_eq!(first["messages"][0]["data"]["text"],"first answer");
        let older = f.reader.page("original",&PageQuery {before:first["before"].as_u64().map(|n|n as usize),..q}).unwrap();
        assert_eq!(older["messages"][0]["data"]["text"],"first assignment");
        let database = f.tmp.path().join("adopt.db");
        f.reader.adopt(&database).unwrap();
        let adopted = f.reader.page("original",&PageQuery {include_tasks:true,..Default::default()}).unwrap();
        assert_eq!(adopted["agentTasks"],json!(expected));
        let first = f.reader.page("original",&PageQuery {task_id:Some("worker".into()),attempt:Some(1),..Default::default()}).unwrap();
        assert_eq!(first["messages"].as_array().unwrap().len(),2);
        assert_eq!(first["messages"][1]["data"]["text"],"first answer");
        // Simulate a database adopted before task presentation existed.
        f.reader.database.as_ref().unwrap().conn.execute("DELETE FROM original_task_versions",[]).unwrap();
        f.reader.database.as_ref().unwrap().conn.execute("DELETE FROM original_task_views",[]).unwrap();
        drop(f.reader);
        for _ in 0..200 {if !f.tmp.path().join("daemon/daemon.lock").exists(){break;}std::thread::sleep(std::time::Duration::from_millis(5));}
        let mut r = Reader {root:Some(f.tmp.path().into()),..Default::default()};
        r.adopt(&database).unwrap();
        assert_eq!(r.page("original",&PageQuery {include_tasks:true,..Default::default()}).unwrap()["agentTasks"],json!(expected));
    }

    // Protects original steering identity, request joins and fail-closed answers.
    #[test]
    fn conversation_steering_decisions_and_internal_requests_remain_inert() {
        let mut f = Fixture::new();
        let mut rows = vec![
            event(
                3,
                "prompt.queued",
                json!({"promptId":"p","text":"steered text"}),
            ),
            event(
                4,
                "prompt.steering",
                json!({"promptId":"p","taskId":"lead","runnerId":"codex"}),
            ),
            event(
                5,
                "prompt.steered",
                json!({"promptId":"p","state":"accepted","steeringSeq":4,"eligible":false,"stale":true}),
            ),
            event(
                6,
                "message.completed",
                json!({"role":"user","text":"steered text","promptId":"p","steering":true,"steeringSeq":4}),
            ),
            event(
                7,
                "question.requested",
                json!({"questionId":"q","questions":[{"id":"visible","prompt":"Question"},{"id":"secret","secret":true}]}),
            ),
            event(
                8,
                "question.resolved",
                json!({"questionId":"q","outcome":"answered","answers":{"visible":["yes"],"secret":["credential"]}}),
            ),
            event(
                9,
                "approval.requested",
                json!({"approvalId":"a","tool":"shell","internal":true}),
            ),
            event(
                10,
                "approval.resolved",
                json!({"approvalId":"a","auto":true,"by":"session-grant:g"}),
            ),
            event(
                11,
                "turn.completed",
                json!({"status":"failed","error":"failed safely"}),
            ),
        ];
        for e in &mut rows {
            e["source"].as_object_mut().unwrap().remove("runnerId");
        }
        write(&f.path("events/000002.jsonl"), lines(&rows));
        let p = f.reader.page("original", &PageQuery::default()).unwrap();
        let messages = p["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["historyId"], 4);
        assert_eq!(messages[0]["seq"], 6);
        assert_eq!(messages[0]["data"]["text"], "steered text");
        assert_eq!(messages[0]["data"]["decisionReply"]["stale"], true);
        assert_eq!(
            messages[1]["request"]["data"]["questions"][0]["prompt"],
            "Question"
        );
        assert_eq!(messages[1]["data"]["answers"], json!({"visible":["yes"]}));
        assert_eq!(messages[2]["kind"], "turn.completed");
        assert!(!p.to_string().contains("credential"));
        // Changed complete bytes used by materialization must be refused.
        write(
            &f.path("events/000002.jsonl"),
            lines(&rows).replace("steered text", "changed text"),
        );
        assert!(
            f.reader
                .page(
                    "original",
                    &PageQuery {
                        snapshot: Some(p["snapshot"].as_str().unwrap().into()),
                        ..Default::default()
                    }
                )
                .is_err()
        );
    }
    // Protects summary refresh on append/replacement; cached reads must not adopt state.
    #[test]
    fn summary_cache_observes_append_and_replacement() {
        let f = Fixture::new();
        assert_eq!(f.reader.summary("original").unwrap()["title"], "renamed");
        write(
            &f.path("events/000002.jsonl"),
            lines(&[event(3, "session.renamed", json!({"title":"new name"}))]),
        );
        assert_eq!(f.reader.summary("original").unwrap()["title"], "new name");
        write(
            &f.path("events/000002.jsonl"),
            lines(&[event(3, "session.removed", json!({"phase":"removed"}))]),
        );
        assert_eq!(f.reader.summary("original").unwrap()["removed"], true);
    }
}

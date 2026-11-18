//! Private adopted copies of Deck1 indexes. Their identities and exact receipts
//! remain authoritative. No source index is repaired, reset or opened writable.
use crate::web_identity::{atomic, open_at, root, value};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    os::{
        fd::AsRawFd,
        unix::fs::{DirBuilderExt, OpenOptionsExt},
    },
    path::{Path, PathBuf},
};
pub(crate) type Result<T> = std::result::Result<T, String>;
fn err(_: impl std::fmt::Display) -> String {
    "notification-storage-unavailable".into()
}
fn path(f: &File) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", f.as_raw_fd()))
}
fn json_file(dir: &File, name: &str, v: &Value) -> Result<()> {
    atomic(dir, name, &serde_json::to_vec(v).map_err(err)?).map_err(err)
}
fn source_path(dir: &File) -> Result<String> {
    fs::read_link(path(dir))
        .map_err(err)
        .map(|p| p.to_string_lossy().into_owned())
}
fn exists(dir: &File, name: &str) -> bool {
    fs::symlink_metadata(path(dir).join(name)).is_ok()
}
fn connect(dir: &File, name: &str, readonly: bool) -> Result<Connection> {
    let held = open_at(dir, name, false).map_err(err)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        if exists(dir, &format!("{name}{suffix}")) {
            open_at(dir, &format!("{name}{suffix}"), false).map_err(err)?;
        }
    }
    let c = Connection::open_with_flags(
        path(dir).join(name),
        if readonly {
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
        } else {
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
        },
    )
    .map_err(err)?;
    let now = open_at(dir, name, false).map_err(err)?;
    use std::os::unix::fs::MetadataExt;
    if held.metadata().map_err(err)?.ino() != now.metadata().map_err(err)?.ino() {
        return Err(err("changed"));
    }
    let integrity: String = c
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(err)?;
    if integrity != "ok" {
        return Err(err("integrity"));
    }
    Ok(c)
}
fn create_db(dir: &File, name: &str, sql: &str) -> Result<Connection> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path(dir).join(name))
        .map_err(err)?;
    let c = connect(dir, name, false)?;
    c.execute_batch(sql).map_err(err)?;
    Ok(c)
}
const REPLIES:&str="PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA user_version=2;
CREATE TABLE identity(id TEXT NOT NULL,since INTEGER NOT NULL);
CREATE TABLE sessions(sessionId TEXT PRIMARY KEY,seq INTEGER NOT NULL,floorSeq INTEGER NOT NULL,turn TEXT);
CREATE TABLE retired_sessions(sessionId TEXT PRIMARY KEY,seq INTEGER NOT NULL);
CREATE TABLE replies(id INTEGER PRIMARY KEY,replyId TEXT NOT NULL,sessionId TEXT NOT NULL,taskId TEXT NOT NULL,attempt INTEGER NOT NULL,messageSeq INTEGER NOT NULL,completedSeq INTEGER NOT NULL,ts INTEGER NOT NULL,summary TEXT NOT NULL,UNIQUE(sessionId,replyId));
CREATE INDEX replies_completion ON replies(sessionId,completedSeq); CREATE INDEX replies_time ON replies(sessionId,ts,id);
CREATE TABLE segment_parts(sessionId TEXT NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(sessionId,seq));
CREATE TABLE reply_messages(sessionId TEXT NOT NULL,seq INTEGER NOT NULL,reply INTEGER NOT NULL,PRIMARY KEY(sessionId,seq));
CREATE TABLE readers(deviceId TEXT PRIMARY KEY,floor INTEGER NOT NULL,since INTEGER NOT NULL,unread INTEGER NOT NULL DEFAULT 0);
CREATE TABLE pending(deviceId TEXT NOT NULL,reply INTEGER NOT NULL,sessionId TEXT NOT NULL,PRIMARY KEY(deviceId,reply));
CREATE INDEX pending_session ON pending(deviceId,sessionId,reply);
CREATE TRIGGER pending_add AFTER INSERT ON pending BEGIN UPDATE readers SET unread=unread+1 WHERE deviceId=NEW.deviceId; END;
CREATE TRIGGER pending_remove AFTER DELETE ON pending BEGIN UPDATE readers SET unread=unread-1 WHERE deviceId=OLD.deviceId; END;
CREATE TABLE displayed(deviceId TEXT NOT NULL,reply INTEGER NOT NULL,PRIMARY KEY(deviceId,reply));";
const OUTCOMES:&str="PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
CREATE TABLE index_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL);
CREATE TABLE outcomes(auth TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,seq INTEGER NOT NULL,outcome TEXT NOT NULL,at INTEGER NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(auth,id));
CREATE INDEX outcomes_expiry ON outcomes(expires);";
pub(crate) struct Storage {
    pub dir: File,
    pub push: Value,
    pub attention: Value,
    pub replies: Connection,
    pub outcomes: Connection,
}
impl Storage {
    pub fn open(source: &Path, destination: &Path, now: u64) -> Result<Self> {
        let source = root(source).map_err(err)?;
        let parent = root(destination.parent().ok_or_else(|| err("parent"))?).map_err(err)?;
        let name = destination
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| err("name"))?;
        if !exists(&parent, name) {
            let stage_name = format!(".{name}-{}", uuid::Uuid::new_v4());
            let stage = path(&parent).join(&stage_name);
            fs::DirBuilder::new()
                .mode(0o700)
                .create(&stage)
                .map_err(err)?;
            let result = (|| {
                let dest = root(&stage).map_err(err)?;
                let web = if exists(&source, "web") {
                    Some(open_at(&source, "web", true).map_err(err)?)
                } else {
                    None
                };
                if let Some(web) = &web {
                    for (meta, db) in [
                        ("push-attention.json", "push-attention.sqlite"),
                        ("lead-replies.json", "lead-replies.sqlite"),
                    ] {
                        if exists(web, meta) != exists(web, db) {
                            return Err(err("index missing"));
                        }
                        if exists(web, meta) {
                            let v = value(web, meta).map_err(err)?;
                            let c = connect(web, db, true)?;
                            let copied = create_db(&dest, db, "")?;
                            drop(copied);
                            c.backup(rusqlite::MAIN_DB, path(&dest).join(db), None)
                                .map_err(err)?;
                            json_file(&dest, meta, &v)?;
                        }
                    }
                    if exists(web, "push.json") {
                        json_file(&dest, "push.json", &value(web, "push.json").map_err(err)?)?;
                    }
                }
                if !exists(&dest, "push-attention.json") {
                    let c = create_db(&dest, "push-attention.sqlite", OUTCOMES)?;
                    let id = uuid::Uuid::new_v4().to_string();
                    c.execute("INSERT INTO index_identity VALUES (1,?1)", [&id])
                        .map_err(err)?;
                    json_file(
                        &dest,
                        "push-attention.json",
                        &json!({"v":2,"indexId":id,"devices":[]}),
                    )?;
                }
                if !exists(&dest, "lead-replies.json") {
                    let c = create_db(&dest, "lead-replies.sqlite", REPLIES)?;
                    let id = uuid::Uuid::new_v4().to_string();
                    c.execute("INSERT INTO identity VALUES (?1,?2)", params![id, now])
                        .map_err(err)?;
                    json_file(&dest, "lead-replies.json", &json!({"v":1,"id":id}))?;
                }
                if !exists(&dest, "push.json") {
                    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
                    use p256::elliptic_curve::sec1::ToEncodedPoint;
                    let key = p256::SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
                    json_file(
                        &dest,
                        "push.json",
                        &json!({"v":1,"keys":{"privateKey":B64.encode(key.to_bytes()),"publicKey":B64.encode(key.public_key().to_encoded_point(false).as_bytes())},"subscriptions":[]}),
                    )?;
                }
                json_file(
                    &dest,
                    "source.json",
                    &json!({"v":1,"path":source_path(&source)?}),
                )?;
                // Validate before publishing the complete adoption directory.
                Self::load(dest)?;
                fs::rename(&stage, path(&parent).join(name)).map_err(err)?;
                parent.sync_all().map_err(err)
            })();
            if result.is_err() {
                let _ = fs::remove_dir_all(&stage);
            }
            result?;
        }
        let dir = open_at(&parent, name, true).map_err(err)?;
        if value(&dir, "source.json").map_err(err)? != json!({"v":1,"path":source_path(&source)?}) {
            return Err(err("source changed"));
        }
        Self::load(dir)
    }
    fn load(dir: File) -> Result<Self> {
        let push = value(&dir, "push.json").map_err(err)?;
        crate::web_push::validate_store(&push)?;
        let attention = value(&dir, "push-attention.json").map_err(err)?;
        let meta = value(&dir, "lead-replies.json").map_err(err)?;
        let outcomes = connect(&dir, "push-attention.sqlite", false)?;
        let replies = connect(&dir, "lead-replies.sqlite", false)?;
        let id: String = outcomes
            .query_row("SELECT id FROM index_identity WHERE singleton=1", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let reply_id: String = replies
            .query_row("SELECT id FROM identity", [], |r| r.get(0))
            .map_err(err)?;
        let version: i64 = replies
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        if attention["v"] != 2
            || attention["indexId"] != id
            || meta["v"] != 1
            || meta["id"] != reply_id
            || uuid::Uuid::parse_str(&id).is_err()
            || uuid::Uuid::parse_str(&reply_id).is_err()
            || version != 2
            || !attention["devices"].as_array().is_some_and(|a| {
                a.len() <= 128
                    && a.iter().all(|d| {
                        d.as_array().is_some_and(|a| a.len() == 2)
                            && d[0].as_str().is_some_and(|s| {
                                serde_json::from_str::<Vec<String>>(s).is_ok_and(|v| v.len() == 2)
                            })
                            && d[1]["since"]
                                .as_u64()
                                .is_some_and(|n| n <= 9_007_199_254_740_991)
                            && d[1]["epoch"]
                                .as_str()
                                .is_some_and(|e| uuid::Uuid::parse_str(e).is_ok())
                            && d[1]["viewed"].as_array().is_some_and(|a| {
                                a.len() <= 64
                                    && a.iter().all(|v| {
                                        v.as_array().is_some_and(|v| v.len() == 2)
                                            && v[0].as_str().is_some_and(|s| s.len() <= 64)
                                            && v[1]
                                                .as_u64()
                                                .is_some_and(|n| n <= 9_007_199_254_740_991)
                                    })
                            })
                    })
            })
        {
            return Err(err("identity"));
        }
        // Validate required read contracts before any enrollment or external effect.
        replies.prepare("SELECT r.id,r.replyId,r.sessionId,r.taskId,r.attempt,r.messageSeq,r.completedSeq,r.ts,r.summary FROM replies r LEFT JOIN pending p ON p.reply=r.id LEFT JOIN readers d ON p.deviceId=d.deviceId LEFT JOIN displayed x ON x.reply=r.id LIMIT 0").map_err(err)?;
        replies.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS rust_cursor(singleton INTEGER PRIMARY KEY,seq INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rust_reply_scan(singleton INTEGER PRIMARY KEY,seq INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rust_parts(session TEXT,task TEXT,attempt TEXT,seq INTEGER,text TEXT,PRIMARY KEY(session,task,attempt));").map_err(err)?;
        Ok(Self {
            dir,
            push,
            attention,
            replies,
            outcomes,
        })
    }
    pub fn save_push(&self) -> Result<()> {
        json_file(&self.dir, "push.json", &self.push)
    }
    pub fn save_attention(&self) -> Result<()> {
        json_file(&self.dir, "push-attention.json", &self.attention)
    }
    pub fn enroll(&self, device: &str, now: u64) -> Result<()> {
        self.replies.execute("INSERT OR IGNORE INTO readers(deviceId,floor,since) SELECT ?1,COALESCE(MAX(id),0),?2 FROM replies",params![device,now]).map_err(err)?;
        Ok(())
    }
    pub fn epoch(&self, key: &str) -> Option<&str> {
        self.attention["devices"]
            .as_array()?
            .iter()
            .find(|d| d[0] == key)?[1]["epoch"]
            .as_str()
    }
    pub fn add_device(&mut self, key: &str, now: u64) -> Result<String> {
        if let Some(e) = self.epoch(key) {
            return Ok(e.into());
        }
        let epoch = uuid::Uuid::new_v4().to_string();
        self.attention["devices"]
            .as_array_mut()
            .ok_or_else(|| err("metadata"))?
            .push(json!([key,{"since":now,"epoch":epoch,"viewed":[]}]));
        self.save_attention()?;
        Ok(epoch)
    }
    pub fn eligible(&self, key: &str, a: &Value, now: u64) -> Result<bool> {
        let Some(d) = self.attention["devices"]
            .as_array()
            .and_then(|ds| ds.iter().find(|d| d[0] == key))
        else {
            return Ok(false);
        };
        if a["ts"].as_u64().unwrap_or(0) < d[1]["since"].as_u64().ok_or_else(|| err("floor"))?
            || now >= expires(a)
        {
            return Ok(false);
        }
        if a.get("replyId").is_none()
            && d[1]["viewed"].as_array().is_some_and(|v| {
                v.iter().any(|v| {
                    v[0] == a["sessionId"]
                        && v[1].as_u64().unwrap_or(0) >= a["seq"].as_u64().unwrap_or(1)
                })
            })
        {
            return Ok(false);
        }
        let auth = json!([key, d[1]["epoch"]]).to_string();
        let id = json!([a["sessionId"], a["key"]]).to_string();
        let revision: Option<u64> = self
            .outcomes
            .query_row(
                "SELECT revision FROM outcomes WHERE auth=?1 AND id=?2",
                params![auth, id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        Ok(revision.unwrap_or(0) < a["revision"].as_u64().ok_or_else(|| err("revision"))?)
    }
    pub fn outcome(&self, key: &str, a: &Value, outcome: &str, now: u64) -> Result<()> {
        let auth = json!([key, self.epoch(key).ok_or_else(|| err("epoch"))?]).to_string();
        let id = json!([a["sessionId"], a["key"]]).to_string();
        self.outcomes.execute("INSERT INTO outcomes VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(auth,id) DO UPDATE SET revision=excluded.revision,seq=excluded.seq,outcome=excluded.outcome,at=excluded.at,expires=excluded.expires WHERE excluded.revision>=outcomes.revision",params![auth,id,a["revision"].as_u64(),a["seq"].as_u64(),outcome,now,expires(a)]).map_err(err)?;
        Ok(())
    }
    pub fn displayed(&self, device: &str, session: &str, reply: &str) -> Result<bool> {
        self.replies.query_row("SELECT EXISTS(SELECT 1 FROM replies r JOIN readers d ON d.deviceId=?1 WHERE r.sessionId=?2 AND r.replyId=?3 AND (r.id<=d.floor OR r.ts<d.since OR EXISTS(SELECT 1 FROM displayed x WHERE x.deviceId=?1 AND x.reply=r.id)))",params![device,session,reply],|r|r.get(0)).map_err(err)
    }
    pub fn acknowledge(&self, device: &str, session: &str, reply: &str) -> Result<()> {
        if self.reply(session, reply)?.is_none() {
            return Err("reply-unknown".into());
        }
        self.replies
            .execute_batch("SAVEPOINT display_reply")
            .map_err(err)?;
        let result = (|| {
            self.replies.execute("INSERT OR IGNORE INTO displayed SELECT ?1,r.id FROM replies r JOIN readers d ON d.deviceId=?1 WHERE r.sessionId=?2 AND r.replyId=?3 AND r.id>d.floor AND r.ts>=d.since",params![device,session,reply]).map_err(err)?;
            self.replies.execute("DELETE FROM pending WHERE deviceId=?1 AND reply IN (SELECT id FROM replies WHERE sessionId=?2 AND replyId=?3)",params![device,session,reply]).map_err(err)?;
            Ok(())
        })();
        if result.is_ok() {
            self.replies
                .execute_batch("RELEASE display_reply")
                .map_err(err)?;
        } else {
            let _ = self
                .replies
                .execute_batch("ROLLBACK TO display_reply;RELEASE display_reply");
        }
        result
    }
    pub fn reply(&self, session: &str, id: &str) -> Result<Option<Value>> {
        self.replies.query_row("SELECT replyId,sessionId,taskId,attempt,messageSeq,completedSeq,ts,summary FROM replies WHERE sessionId=?1 AND replyId=?2 AND NOT EXISTS(SELECT 1 FROM retired_sessions WHERE sessionId=?1)",params![session,id],reply_row).optional().map_err(err)
    }
    pub fn list(&self, device: &str, session: Option<&str>, cursor: u64) -> Result<Value> {
        let total: u64 = self
            .replies
            .query_row(
                "SELECT COUNT(*) FROM pending WHERE deviceId=?1 AND (?2 IS NULL OR sessionId=?2)",
                params![device, session],
                |r| r.get(0),
            )
            .map_err(err)?;
        let mut q=self.replies.prepare("SELECT r.replyId,r.sessionId,r.taskId,r.attempt,r.messageSeq,r.completedSeq,r.ts,r.summary,r.id FROM pending p JOIN replies r ON p.reply=r.id WHERE p.deviceId=?1 AND (?2 IS NULL OR p.sessionId=?2) AND r.id>?3 ORDER BY r.id LIMIT 41").map_err(err)?;
        let mut rows = q.query(params![device, session, cursor]).map_err(err)?;
        let mut replies = vec![];
        let mut last = 0;
        let mut more = false;
        while let Some(r) = rows.next().map_err(err)? {
            if replies.len() == 40 {
                more = true;
                break;
            }
            last = r.get::<_, u64>(8).map_err(err)?;
            replies.push(reply_row(r).map_err(err)?);
        }
        Ok(
            json!({"ok":true,"replies":replies,"total":total,"nextCursor":if more{Some(last)}else{None}}),
        )
    }
}
fn reply_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(
        json!({"replyId":r.get::<_,String>(0)?,"sessionId":r.get::<_,String>(1)?,"taskId":r.get::<_,String>(2)?,"attempt":r.get::<_,u64>(3)?,"messageSeq":r.get::<_,u64>(4)?,"completedSeq":r.get::<_,u64>(5)?,"ts":r.get::<_,u64>(6)?,"summary":r.get::<_,String>(7)?}),
    )
}
pub(crate) fn expires(a: &Value) -> u64 {
    a["ts"]
        .as_u64()
        .unwrap_or(0)
        .saturating_add(if a["kind"] == "finished" || a["kind"] == "result" {
            30 * 60_000
        } else {
            24 * 60 * 60_000
        })
        .saturating_add(1)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn private_dir(p: &Path) {
        fs::create_dir_all(p).unwrap();
        fs::set_permissions(p, fs::Permissions::from_mode(0o700)).unwrap();
    }
    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let original = t.path().join("original");
        let state = t.path().join("state");
        private_dir(&original);
        private_dir(&state);
        (t, original, state)
    }
    fn item(key: &str, revision: u64, seq: u64) -> Value {
        json!({"sessionId":"s","kind":"finished","key":key,"replyId":key,"revision":revision,"seq":seq,"ts":100})
    }
    // Oracle: exact original JSON/SQLite identity, enrollment and per-item outcomes
    // survive adoption/restart; a different occurrence is never covered by a watermark.
    #[test]
    fn original_indexes_and_exact_outcomes_survive_adoption_and_restart() {
        let (t, original, state) = fixture();
        let seed = t.path().join("seed");
        private_dir(&seed);
        let mut old = Storage::open(&seed, &original.join("web"), 10).unwrap();
        let key = json!(["browser", "https://deck.example"]).to_string();
        let epoch = old.add_device(&key, 10).unwrap();
        old.outcome(&key, &item("reply-2-1", 1, 2), "sent", 110)
            .unwrap();
        old.enroll("browser", 10).unwrap();
        old.replies.execute("INSERT INTO replies VALUES (1,'reply-2-1','s','lead',1,1,2,100,'Lead reply available.')",[]).unwrap();
        old.replies
            .execute("INSERT INTO pending VALUES ('browser',1,'s')", [])
            .unwrap();
        old.replies
            .execute("INSERT INTO reply_messages VALUES ('s',1,1)", [])
            .unwrap();
        old.acknowledge("browser", "s", "reply-2-1").unwrap();
        let oldkeys = old.push["keys"].clone();
        drop(old);
        let files = [
            "push.json",
            "push-attention.json",
            "push-attention.sqlite",
            "lead-replies.json",
            "lead-replies.sqlite",
        ];
        let before = files.map(|n| fs::read(original.join("web").join(n)).unwrap());
        let adopted = Storage::open(&original, &state.join("notifications"), 120).unwrap();
        assert_eq!(adopted.push["keys"], oldkeys);
        assert_eq!(adopted.epoch(&key), Some(epoch.as_str()));
        assert!(
            !adopted
                .eligible(&key, &item("reply-2-1", 1, 2), 120)
                .unwrap()
        );
        assert!(
            adopted
                .eligible(&key, &item("reply-4-3", 1, 4), 120)
                .unwrap()
        );
        assert!(
            adopted
                .eligible(&key, &item("reply-2-1", 2, 2), 120)
                .unwrap()
        );
        assert!(adopted.displayed("browser", "s", "reply-2-1").unwrap());
        assert_eq!(adopted.list("browser", None, 0).unwrap()["total"], 0);
        drop(adopted);
        let again = Storage::open(&original, &state.join("notifications"), 1000).unwrap();
        assert_eq!(again.epoch(&key), Some(epoch.as_str()));
        for (i, n) in files.iter().enumerate() {
            assert_eq!(fs::read(original.join("web").join(n)).unwrap(), before[i]);
        }
    }
    // Oracle: absent/mismatched/corrupt existing indexes are unavailable, never an
    // empty successful inbox or a newly enrolled historical replay source.
    #[test]
    fn missing_corrupt_or_mismatched_index_never_becomes_successful_empty_state() {
        for fault in ["missing", "corrupt", "identity"] {
            let (t, original, state) = fixture();
            let seed = t.path().join("seed");
            private_dir(&seed);
            drop(Storage::open(&seed, &original.join("web"), 10).unwrap());
            let p = original.join("web/lead-replies.sqlite");
            match fault {
                "missing" => fs::remove_file(&p).unwrap(),
                "corrupt" => fs::write(&p, b"broken index").unwrap(),
                _ => {
                    let c = Connection::open(&p).unwrap();
                    c.execute("UPDATE identity SET id='foreign'", []).unwrap();
                }
            }
            assert!(
                Storage::open(&original, &state.join("notifications"), 20).is_err(),
                "{fault}"
            );
            assert!(!state.join("notifications").exists());
        }
    }
    #[test]
    fn source_binding_and_private_file_boundary_are_required() {
        let (t, original, state) = fixture();
        drop(Storage::open(&original, &state.join("notifications"), 10).unwrap());
        let other = t.path().join("other");
        private_dir(&other);
        assert!(Storage::open(&other, &state.join("notifications"), 20).is_err());
        let json = state.join("notifications/push.json");
        fs::set_permissions(&json, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(Storage::open(&original, &state.join("notifications"), 20).is_err());
    }
    #[test]
    fn enrollment_floor_exact_display_and_retirement_do_not_confuse_unseen_replies() {
        let (_t, original, state) = fixture();
        let s = Storage::open(&original, &state.join("notifications"), 10).unwrap();
        s.enroll("browser", 10).unwrap();
        for id in 1..=82 {
            s.replies.execute("INSERT INTO replies VALUES (?1,?2,'s','lead',1,?1,?1,100,'Lead reply available.')",params![id,format!("reply-{id}-{id}")]).unwrap();
            s.replies
                .execute("INSERT INTO pending VALUES ('browser',?1,'s')", [id])
                .unwrap();
        }
        s.acknowledge("browser", "s", "reply-82-82").unwrap();
        assert!(!s.displayed("browser", "s", "reply-1-1").unwrap());
        let page = s.list("browser", Some("s"), 0).unwrap();
        assert_eq!(page["total"], 81);
        assert_eq!(page["replies"].as_array().unwrap().len(), 40);
        assert_eq!(page["nextCursor"], 40);
        s.enroll("new-browser", 200).unwrap();
        assert_eq!(s.list("new-browser", None, 0).unwrap()["total"], 0);
        s.replies
            .execute("INSERT INTO retired_sessions VALUES ('s',90)", [])
            .unwrap();
        assert!(s.reply("s", "reply-1-1").unwrap().is_none());
        assert!(s.acknowledge("browser", "s", "reply-1-1").is_err());
    }
}

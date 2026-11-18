use super::*;
use rusqlite::{Connection, OptionalExtension, params};
fn sql(e: rusqlite::Error) -> String {
    error(&format!("SQLite adoption failed: {e}"))
}
fn decode(s: String) -> Result<Value> {
    serde_json::from_str(&s).map_err(|_| error("corrupt adopted projection"))
}
pub(super) struct Database {
    pub(super) conn: Connection,
}
impl Database {
    fn open(path: &FsPath, source: &str) -> Result<Self> {
        use std::os::unix::fs::OpenOptionsExt;
        if !path.exists() {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(path)
                .map_err(|_| error("cannot create adoption database"))?;
        }
        let meta = std::fs::symlink_metadata(path)
            .map_err(|_| error("cannot inspect adoption database"))?;
        if !meta.is_file() || meta.mode() & 0o077 != 0 || meta.uid() != unsafe { libc::geteuid() } {
            return Err(error("unsafe adoption database"));
        }
        let conn = Connection::open(path).map_err(sql)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS adoption_meta(key TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS original_sessions(id TEXT PRIMARY KEY,project TEXT NOT NULL,created TEXT NOT NULL,fingerprint TEXT NOT NULL,metadata TEXT NOT NULL,summary TEXT NOT NULL,removed INTEGER NOT NULL,ready INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS original_task_views(session TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(session,id));
   CREATE TABLE IF NOT EXISTS original_task_versions(session TEXT PRIMARY KEY,version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS original_recovery(session TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS original_sessions_page ON original_sessions(project,ready,removed,created DESC,id DESC);
   CREATE TABLE IF NOT EXISTS original_events(session TEXT NOT NULL,seq INTEGER NOT NULL,task TEXT,attempt INTEGER,kind TEXT NOT NULL,raw BLOB NOT NULL,PRIMARY KEY(session,seq));
   CREATE INDEX IF NOT EXISTS original_event_task ON original_events(session,task,attempt,seq);
   CREATE TABLE IF NOT EXISTS original_messages(session TEXT NOT NULL,id INTEGER NOT NULL,task TEXT NOT NULL,lead INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(session,id));
   CREATE INDEX IF NOT EXISTS original_lead_page ON original_messages(session,lead,id);
   CREATE INDEX IF NOT EXISTS original_task_page ON original_messages(session,task,id);").map_err(sql)?;
        let old: Option<String> = conn
            .query_row(
                "SELECT body FROM adoption_meta WHERE key='source'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        if old.as_deref().is_some_and(|s| s != source) {
            return Err(error("adoption database belongs to another original store"));
        }
        conn.execute(
            "INSERT OR IGNORE INTO adoption_meta VALUES ('source',?1)",
            [source],
        )
        .map_err(sql)?;
        Ok(Self { conn })
    }
    fn recovery(&self, id: &str) -> Result<Value> {
        decode(self.conn.query_row("SELECT body FROM original_recovery WHERE session=?1",[id],|r|r.get(0)).map_err(sql)?)
    }
    fn save_recovery(&self, id: &str, projection: &Value) -> Result<()> {
        self.conn.execute("INSERT INTO original_recovery VALUES (?1,?2) ON CONFLICT(session) DO UPDATE SET body=excluded.body",params![id,projection.to_string()]).map_err(sql)?;
        Ok(())
    }
    pub(super) fn catalog(&self) -> Result<Value> {
        let body: String = self
            .conn
            .query_row(
                "SELECT body FROM adoption_meta WHERE key='catalog'",
                [],
                |r| r.get(0),
            )
            .map_err(sql)?;
        let mut value = decode(body)?;
        value["adopted"] = json!(true);
        Ok(value)
    }
    pub(super) fn verify_snapshot(&self, id: &str, token: &str) -> Result<()> {
        let fingerprint: String = self
            .conn
            .query_row(
                "SELECT fingerprint FROM original_sessions WHERE id=?1 AND ready=1",
                [id],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if fingerprint != token {
            return Err(error("adopted history cursor changed"));
        }
        Ok(())
    }
    pub(super) fn sessions(&self, project: &str, q: &ListQuery) -> Result<Value> {
        let limit = q.limit.unwrap_or(30);
        if !(1..=100).contains(&limit) {
            return Err(error("invalid page limit"));
        }
        let (created, id) = match &q.cursor {
            Some(c) => {
                let (a, b) = c
                    .split_once('|')
                    .ok_or_else(|| error("invalid session cursor"))?;
                (a, b)
            }
            None => ("\u{10ffff}", "\u{10ffff}"),
        };
        let mut stmt=self.conn.prepare("SELECT summary FROM original_sessions WHERE project=?1 AND ready=1 AND removed=0 AND (created,id)<(?2,?3) ORDER BY created DESC,id DESC LIMIT ?4").map_err(sql)?;
        let mut rows = stmt
            .query(params![project, created, id, (limit + 1) as i64])
            .map_err(sql)?;
        let mut sessions = Vec::new();
        while let Some(row) = rows.next().map_err(sql)? {
            sessions.push(decode(row.get(0).map_err(sql)?)?);
        }
        let more = sessions.len() > limit;
        sessions.truncate(limit);
        let next = sessions.last().filter(|_| more).map(|s| {
            format!(
                "{}|{}",
                s["createdAt"].as_str().unwrap_or(""),
                s["sessionId"].as_str().unwrap_or("")
            )
        });
        Ok(json!({"sessions":sessions,"nextCursor":next}))
    }
    fn task_page(&self, id: &str, q: &PageQuery) -> Result<(Vec<Value>,Option<String>)> {
        let mut stmt = self.conn.prepare("SELECT body FROM original_task_views WHERE session=?1 AND id>?2 ORDER BY id LIMIT 21").map_err(sql)?;
        let values = stmt.query_map(params![id,q.tasks_after.as_deref().unwrap_or("")],|r|r.get::<_,String>(0)).map_err(sql)?.map(|s|decode(s.map_err(sql)?)).collect::<Result<Vec<_>>>()?;
        let materialized=values.into_iter().map(|task|task_history::materialize(task,|seq| {
            let raw:Vec<u8>=self.conn.query_row("SELECT raw FROM original_events WHERE session=?1 AND seq=?2",params![id,seq as i64],|r|r.get(0)).map_err(sql)?;
            serde_json::from_slice(&raw).map_err(|_|error("recorded result unavailable"))
        })).collect::<Result<Vec<_>>>()?;
        task_history::page(materialized.into_iter(),None)
    }
    // Rebuildable passive projection, including databases adopted by older binaries.
    // No executable store or original file is written.
    fn ensure_task_views(&self, id: &str) -> Result<()> {
        let version:Option<i64> = self.conn.query_row("SELECT version FROM original_task_versions WHERE session=?1",[id],|r|r.get(0)).optional().map_err(sql)?;
        if version == Some(1) {return Ok(());}
        let mut index = task_history::Index::default();
        let mut stmt = self.conn.prepare("SELECT raw FROM original_events WHERE session=?1 ORDER BY seq").map_err(sql)?;
        let mut rows = stmt.query([id]).map_err(sql)?;
        while let Some(row) = rows.next().map_err(sql)? {let raw:Vec<u8>=row.get(0).map_err(sql)?;index.observe(&serde_json::from_slice(&raw).map_err(|_|error("invalid adopted event"))?)?;}
        drop(rows);drop(stmt);
        let tx = self.conn.unchecked_transaction().map_err(sql)?;
        tx.execute("DELETE FROM original_task_views WHERE session=?1",[id]).map_err(sql)?;
        for task in index.values() {tx.execute("INSERT INTO original_task_views VALUES (?1,?2,?3)",params![id,task["id"].as_str(),task.to_string()]).map_err(sql)?;}
        let mut stmt = tx.prepare("SELECT id,task,body FROM original_messages WHERE session=?1").map_err(sql)?;
        let mut rows = stmt.query([id]).map_err(sql)?;
        while let Some(row) = rows.next().map_err(sql)? {
            let seq:i64=row.get(0).map_err(sql)?;let task:String=row.get(1).map_err(sql)?;let mut body=decode(row.get(2).map_err(sql)?)?;
            body["historyAttempt"]=json!(body["source"]["attempt"].as_u64().or_else(||index.attempt(&task,seq as usize)));
            tx.execute("UPDATE original_messages SET body=?3 WHERE session=?1 AND id=?2",params![id,seq,body.to_string()]).map_err(sql)?;
        }
        drop(rows);drop(stmt);
        tx.execute("INSERT OR REPLACE INTO original_task_versions VALUES (?1,1)",[id]).map_err(sql)?;
        tx.commit().map_err(sql)?; Ok(())
    }
    pub(super) fn page(&self, id: &str, q: &PageQuery) -> Result<Value> {
        let limit = q.limit.unwrap_or(100);
        if !(1..=100).contains(&limit) || q.before.is_some() && q.after.is_some() {
            return Err(error("invalid conversation page"));
        }
        let (token,meta,summary):(String,String,String)=self.conn.query_row("SELECT fingerprint,metadata,summary FROM original_sessions WHERE id=?1 AND ready=1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(sql)?;
        if let Some(t) = &q.snapshot {
            if t != &token {
                return Err(error("adopted history cursor changed"));
            }
        } else if q.before.is_some() || q.after.is_some() || q.tasks_after.is_some() {
            return Err(error("snapshot required for cursor"));
        }
        let filter = format!("{}{}",if q.task_id.is_some() {"task=?2"} else {"lead=1"},if q.attempt.is_some() {" AND coalesce(json_extract(body,'$.historyAttempt'),0)=?5"}else{" AND ?5 IS NULL"});
        let ascending = q.after.is_some();
        let op = if ascending { ">" } else { "<" };
        let order = if ascending { "ASC" } else { "DESC" };
        let query = format!(
            "SELECT id,body FROM original_messages WHERE session=?1 AND {filter} AND id{op}?3 ORDER BY id {order} LIMIT ?4"
        );
        let mut stmt = self.conn.prepare(&query).map_err(sql)?;
        let mut rows = stmt
            .query(params![
                id,
                q.task_id.as_deref().unwrap_or(""),
                q.after.or(q.before).unwrap_or(i64::MAX as usize) as i64,
                limit as i64, q.attempt
            ])
            .map_err(sql)?;
        let mut messages = Vec::new();
        let mut size = 0;
        while let Some(row) = rows.next().map_err(sql)? {
            let body: String = row.get(1).map_err(sql)?;
            if size + body.len() > MAX_LINE {
                if messages.is_empty() {
                    return Err(error("conversation message exceeds page bound"));
                }
                break;
            }
            size += body.len();
            messages.push(decode(body)?);
        }
        if !ascending {
            messages.reverse();
        }
        let exists = |op: &str, seq: i64| -> Result<bool> {
            self.conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM original_messages WHERE session=?1 AND {filter} AND id{op}?3)"),params![id,q.task_id.as_deref().unwrap_or(""),seq,rusqlite::types::Null,q.attempt],|r|r.get(0)).map_err(sql)
        };
        let before = messages.first().and_then(|m| m["historyId"].as_i64());
        let after = messages.last().and_then(|m| m["historyId"].as_i64());
        let before = match before {
            Some(n) if exists("<", n)? => Some(n),
            _ => None,
        };
        let after = match after {
            Some(n) if exists(">", n)? => Some(n),
            _ => None,
        };
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT task FROM original_messages WHERE session=?1 ORDER BY task")
            .map_err(sql)?;
        let tasks = stmt
            .query_map([id], |r| r.get::<_, String>(0))
            .map_err(sql)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql)?;
        let boundary: i64 = self
            .conn
            .query_row(
                "SELECT coalesce(max(seq),0) FROM original_events WHERE session=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(sql)?;
        let (agent_tasks,next_task)=if q.include_tasks {self.task_page(id,q)?} else {(Vec::new(),None)};
        Ok(
            json!({"metadata":decode(meta)?,"summary":decode(summary)?,"snapshot":token,"boundary":boundary,"messages":messages,"before":before,"after":after,"tasks":tasks,"agentTasks":agent_tasks,"nextTask":next_task,"session":id,"taskId":q.task_id,"attempt":q.attempt,"issue":null,"adopted":true,"recovery":self.recovery(id)?}),
        )
    }
}
impl Reader {
    pub(crate) fn notification_boundary(&self,session:&str)->Result<u64>{
        match &self.database {Some(db)=>db.conn.query_row("SELECT COALESCE(MAX(seq),0) FROM original_events WHERE session=?1",[session],|r|r.get(0)).map_err(sql),None=>Ok(0)}
    }
    pub(crate) fn notification_session_exists(&self,session:&str)->Result<bool>{
        match &self.database {Some(db)=>db.conn.query_row("SELECT EXISTS(SELECT 1 FROM original_sessions WHERE id=?1 AND removed=0 AND ready=1)",[session],|r|r.get(0)).map_err(sql),None=>Ok(false)}
    }
    pub(crate) fn web_writable(&self) -> Result<()> {
        self.owner.as_ref().ok_or_else(|| error("original ownership unavailable"))?.valid()
    }
    pub fn adoption_issue(&mut self, issue: String) {
        self.adoption_issue = Some(issue);
    }
    /// Called once from startup, on a blocking thread, only for an existing source.
    /// No original recovery writer is ever opened. Incomplete sources remain readable.
    pub fn adopt(&mut self, path: &FsPath) -> Result<()> {
        if self.owner.is_some() {
            return Ok(());
        }
        let root = self
            .root
            .as_deref()
            .ok_or_else(|| error("source not configured"))?;
        let owner = owner::Owner::acquire(root)?;
        let source = crate::tasks::digest(root.as_os_str().as_bytes());
        let mut db = Database::open(path, &source)?;
        let catalog = self.catalog()?;
        let original_catalog = if names(&self.source()?, 100_000)?
            .iter()
            .any(|n| n == "projects.json")
        {
            Some(bytes(
                &mut at(&self.source()?, "projects.json", false)?,
                16 * 1024 * 1024,
            )?)
        } else {
            None
        };
        if !catalog["issues"].as_array().is_none_or(|v| v.is_empty()) {
            return Err(error(
                "malformed original session metadata; adoption withheld",
            ));
        }
        let dir = self.source()?;
        let ids = if names(&dir, 100_000)?.iter().any(|n| n == "sessions") {
            names(&at(&dir, "sessions", true)?, 100_000)?
        } else {
            Vec::new()
        };
        let mut previous = db
            .conn
            .prepare("SELECT id FROM original_sessions")
            .map_err(sql)?;
        for row in previous
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(sql)?
        {
            if !ids.contains(&row.map_err(sql)?) {
                return Err(error("adopted original session disappeared"));
            }
        }
        drop(previous);
        let mut manifest = Vec::new();
        for id in &ids {
            let before = self.summary_stamp(id)?;
            manifest.push((id.clone(), before.clone()));
            owner.valid()?;
            let fingerprint = crate::tasks::digest(before.as_bytes());
            let existing: Option<(String, i64)> = db
                .conn
                .query_row(
                    "SELECT fingerprint,ready FROM original_sessions WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(sql)?;
            if let Some((old, ready)) = existing {
                if old != fingerprint {
                    if ready == 1 {
                        return Err(error(
                            "original source changed since adoption; preserve both stores",
                        ));
                    }
                    let tx = db.conn.transaction().map_err(sql)?;
                    for table in ["original_events", "original_messages", "original_task_views", "original_task_versions"] {
                        tx.execute(&format!("DELETE FROM {table} WHERE session=?1"), [id])
                            .map_err(sql)?;
                    }
                    tx.execute("DELETE FROM original_sessions WHERE id=?1", [id])
                        .map_err(sql)?;
                    tx.commit().map_err(sql)?;
                } else if ready == 1 {
                    let saved: Option<String> = db.conn.query_row("SELECT body FROM original_recovery WHERE session=?1",[id],|r|r.get(0)).optional().map_err(sql)?;
                    let saved = saved.map(decode).transpose()?;
                    if let Some(projection) = &saved {recovery::revalidate(&self.metadata(id)?.0,projection)?;}
                    let mut recovery = recovery::Recovery::default();
                    let mut stmt=db.conn.prepare("SELECT raw FROM original_events WHERE session=?1 ORDER BY seq").map_err(sql)?;
                    let mut rows=stmt.query([id]).map_err(sql)?;
                    while let Some(row)=rows.next().map_err(sql)? {
                        let raw:Vec<u8>=row.get(0).map_err(sql)?;
                        recovery.observe(&serde_json::from_slice(&raw).map_err(|_|error("invalid adopted event"))?)?;
                    }
                    let projection=recovery.finish(&self.metadata(id)?.0)?;
                    owner.valid()?;
                    if let Some(saved) = saved {
                        recovery::validate_saved(&saved,&projection)?;
                    } else {
                        db.save_recovery(id,&projection)?;
                    }
                    db.ensure_task_views(id)?;
                    continue;
                }
            }
            let s = self.capture(id)?;
            if s.issue.is_some() {
                return Err(error(
                    "incomplete original event tail; adoption withheld without repair",
                ));
            }
            owner::settled(&s.dir)?;
            let mut recovery = recovery::Recovery::default();
            for seq in 1..=s.records.len() {
                recovery.observe(&serde_json::from_slice(&s.raw_line(seq)?).map_err(|_|error("invalid task event"))?)?;
            }
            let projection = recovery.finish(&s.dir)?;
            // Staging commits are bounded. ready=0 excludes partial records from every
            // query; restart resumes exact identical rows, never inserts execution work.
            db.conn
                .execute(
                    "INSERT OR IGNORE INTO original_sessions VALUES (?1,?2,?3,?4,?5,?6,?7,0)",
                    params![
                        id,
                        s.summary["projectId"].as_str(),
                        s.metadata["createdAt"].as_str(),
                        fingerprint,
                        s.metadata.to_string(),
                        s.summary.to_string(),
                        s.summary["removed"] == true
                    ],
                )
                .map_err(sql)?;
            let mut done: usize = db
                .conn
                .query_row(
                    "SELECT coalesce(max(seq),0) FROM original_events WHERE session=?1",
                    [id],
                    |r| r.get::<_, i64>(0),
                )
                .map_err(sql)? as usize;
            while done < s.records.len() {
                owner.valid()?;
                let tx = db.conn.transaction().map_err(sql)?;
                let mut count = 0;
                while done < s.records.len() && count < 4 * 1024 * 1024 {
                    let raw = s.raw_line(done + 1)?;
                    let event: Value =
                        serde_json::from_slice(&raw).map_err(|_| error("malformed event"))?;
                    count += raw.len();
                    done += 1;
                    tx.execute(
                        "INSERT INTO original_events VALUES (?1,?2,?3,?4,?5,?6)",
                        params![
                            id,
                            done as i64,
                            event["source"]["taskId"].as_str(),
                            event["source"]["attempt"]
                                .as_i64()
                                .or(event["data"]["attempt"].as_i64()),
                            event["kind"].as_str(),
                            raw
                        ],
                    )
                    .map_err(sql)?;
                }
                tx.commit().map_err(sql)?;
                #[cfg(test)]
                if self.interrupt_adoption {
                    return Err(error("injected interruption after durable batch"));
                }
            }
            db.conn
                .execute("DELETE FROM original_messages WHERE session=?1", [id])
                .map_err(sql)?;
            let mut tx = Some(db.conn.unchecked_transaction().map_err(sql)?);
            let mut message_bytes = 0;
            s.chat.visit(&s, |seq, task, lead, body| {
                let body = body.to_string();
                message_bytes += body.len();
                tx.as_ref()
                    .unwrap()
                    .execute(
                        "INSERT INTO original_messages VALUES (?1,?2,?3,?4,?5)",
                        params![id, seq as i64, task, lead, body],
                    )
                    .map_err(sql)?;
                if message_bytes >= 4 * 1024 * 1024 {
                    owner.valid()?;
                    tx.take().unwrap().commit().map_err(sql)?;
                    tx = Some(db.conn.unchecked_transaction().map_err(sql)?);
                    message_bytes = 0;
                }
                Ok(())
            })?;
            let tx = tx.take().unwrap();
            owner.valid()?;
            if self.summary_stamp(id)? != before {
                return Err(error("original source changed during adoption"));
            }
            tx.execute("INSERT INTO original_recovery VALUES (?1,?2) ON CONFLICT(session) DO UPDATE SET body=excluded.body", params![id,projection.to_string()]).map_err(sql)?;
            tx.execute("UPDATE original_sessions SET ready=1 WHERE id=?1", [id])
                .map_err(sql)?;
            tx.commit().map_err(sql)?;
            db.ensure_task_views(id)?;
        }
        // Catalog publication fences added/removed/replaced sources as well as events.
        for (id, stamp) in &manifest {
            if self.summary_stamp(id)? != *stamp {
                return Err(error("original source changed during adoption"));
            }
        }
        let current = if names(&dir, 100_000)?.iter().any(|n| n == "sessions") {
            names(&at(&dir, "sessions", true)?, 100_000)?
        } else {
            Vec::new()
        };
        if current != ids || self.catalog()? != catalog {
            return Err(error("original catalog changed during adoption"));
        }
        owner.valid()?;
        db.conn.execute("INSERT INTO adoption_meta VALUES ('catalog',?1) ON CONFLICT(key) DO UPDATE SET body=excluded.body",[catalog.to_string()]).map_err(sql)?;
        if let Some(raw) = original_catalog {
            db.conn.execute("INSERT INTO adoption_meta VALUES ('original_catalog',?1) ON CONFLICT(key) DO UPDATE SET body=excluded.body",[raw]).map_err(sql)?;
        }
        self.database = Some(db);
        self.owner = Some(owner);
        Ok(())
    }
    pub(crate) fn track_process(&self, pid: u32) -> Result<()> {
        if let Some(owner) = &self.owner {
            owner.track(pid)?;
        }
        Ok(())
    }
}
impl Database {
    fn context(
        &self,
        id: &str,
        project: &str,
    ) -> Result<(deck2_shared::Session, deck2_shared::OriginalContext)> {
        let (meta,summary,fp):(String,String,String)=self.conn.query_row("SELECT metadata,summary,fingerprint FROM original_sessions WHERE id=?1 AND ready=1 AND removed=0",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(sql)?;
        let meta = decode(meta)?;
        let summary = decode(summary)?;
        if meta["projectRoot"] != project
            || summary["released"] == true
            || summary["removing"] == true
        {
            return Err(error("session is released or belongs to another project"));
        }
        let mut task = String::new();
        let mut attempt = 1;
        let mut thread = String::new();
        let mut state = String::new();
        let mut runner = String::new();
        let mut model = String::new();
        let mut approvals = meta["approvals"].as_str().unwrap_or("relay").to_string();
        let mut generation = 1;
        let mut revision = 1;
        let mut stmt = self
            .conn
            .prepare("SELECT raw FROM original_events WHERE session=?1 ORDER BY seq")
            .map_err(sql)?;
        let mut rows = stmt.query([id]).map_err(sql)?;
        while let Some(row) = rows.next().map_err(sql)? {
            let raw: Vec<u8> = row.get(0).map_err(sql)?;
            let e: Value =
                serde_json::from_slice(&raw).map_err(|_| error("corrupt original event"))?;
            let d = &e["data"];
            let kind = e["kind"].as_str().unwrap_or("");
            if kind == "session.created"
                && let Some(a) = d["approvals"].as_str()
            {
                approvals = a.into();
            }
            if kind == "session.approvals" {
                approvals = d["mode"].as_str().unwrap_or("relay").into();
            }
            if kind == "session.assignment" {
                generation = d["generation"].as_u64().unwrap_or(generation);
                revision = d["revision"].as_u64().unwrap_or(revision);
            }
            if kind == "task.created"
                && d["memberId"].as_str().or(e["source"]["memberId"].as_str()) == Some("lead")
            {
                task = d["taskId"].as_str().unwrap_or("").into();
                runner = d["runnerId"]
                    .as_str()
                    .or(e["source"]["runnerId"].as_str())
                    .unwrap_or("")
                    .into();
                model = d["modelId"].as_str().unwrap_or("").into();
                attempt = 1;
                thread = d["nativeSessionId"].as_str().unwrap_or("").into();
                state = d["state"].as_str().unwrap_or("created").into();
            }
            let event_task = d["taskId"].as_str().or(e["source"]["taskId"].as_str());
            if !task.is_empty() && event_task == Some(task.as_str()) {
                if kind == "task.continued" {
                    attempt = d["attempt"].as_u64().unwrap_or(attempt + 1);
                    state = "created".into();
                    thread = d["nativeSessionId"].as_str().unwrap_or("").into();
                }
                if kind == "task.state" {
                    state = d["state"].as_str().unwrap_or("").into();
                    if let Some(n) = d["nativeSessionId"]
                        .as_str()
                        .or(e["source"]["nativeSessionId"].as_str())
                    {
                        thread = n.into();
                    }
                }
            }
        }
        let recovery = self.recovery(id)?;
        if recovery["guarded"] == true {
            return Err(error("original session is stopped, ended, released or removed"));
        }
        let recovered = &recovery["tasks"][&task];
        if recovered["attempt"] == attempt && recovered["state"] == "interrupted" {
            state = "interrupted".into();
        }
        let members: std::collections::BTreeMap<String, deck2_shared::MemberAssignment> =
            serde_json::from_value(summary["members"].clone())
                .map_err(|_| error("unsupported original assignment"))?;
        if runner != "codex"
            || !matches!(
                state.as_str(),
                "completed" | "cancelled" | "failed" | "interrupted"
            )
            || task.is_empty()
            || uuid::Uuid::parse_str(&thread).is_err()
            || members
                .get("lead")
                .is_none_or(|a| a.runner_id != runner || a.model_id != model)
        {
            return Err(error(
                "original native context is unsupported, unverified or unsettled",
            ));
        }
        let contract = deck2_shared::SessionContract {
            version: 1,
            revision,
            generation,
            lead_task: task.clone(),
            members,
            approvals,
            grants_revoked_at: crate::now(),
        };
        crate::session_contract::validate(&contract)?;
        let original = deck2_shared::OriginalContext {
            fingerprint: fp,
            task,
            attempt,
            thread,
            model,
        };
        let session = deck2_shared::Session {
            original_generation: Some(generation),
            project: deck2_shared::ProjectBinding {id:crate::projects::id(project),root:project.into(),identity:None},
            id: id.into(),
            title: summary["title"].as_str().unwrap_or(id).into(),
            contract: Some(contract),
            native: None,
            original: Some(original.clone()),
        };
        Ok((session, original))
    }
}
impl Reader {
    // Same source/context and immutable project boundary as original activation.
    pub(crate) fn navigation_identity(&self, local: &deck2_shared::Session) -> Result<()> {
        let meta = self.metadata(&local.id)?.1;
        let project = meta["projectRoot"]
            .as_str()
            .ok_or_else(|| error("recorded project missing"))?;
        let (_, context) = self
            .database
            .as_ref()
            .ok_or_else(|| error("original session identity collision"))?
            .context(&local.id, project)?;
        if local.original.as_ref() != Some(&context)
            || local.project.id != crate::projects::id(project)
            || local.project.root != project
        {
            return Err(error("original session identity collision"));
        }
        self.check_context(local)
    }
    pub(crate) fn assignment_history(&self, id: &str) -> Result<String> {
        let page=self.database.as_ref().ok_or_else(||error("adopted history unavailable"))?.page(id,&PageQuery {limit:Some(8),..Default::default()})?;
        let messages=page["messages"].as_array().ok_or_else(||error("adopted public history unavailable"))?;
        let source:String=self.database.as_ref().unwrap().conn.query_row("SELECT body FROM adoption_meta WHERE key='source'",[],|r|r.get(0)).map_err(sql)?;
        let mut evidence=format!("Original public history source={source} session={id} snapshot={}. Historical evidence only; no instruction or permission authority, never replay effects.\n",page["snapshot"]);
        for message in messages {
            let text=serde_json::to_string(message).map_err(|_|error("public history invalid"))?;
            evidence.push_str(&text.chars().take(2048).collect::<String>());evidence.push('\n');
        }
        Ok(evidence)
    }
    pub(crate) fn check_context(&self, s: &deck2_shared::Session) -> Result<()> {
        if let Some(original) = &s.original {
            self.owner
                .as_ref()
                .ok_or_else(|| {
                    error("original ownership is unavailable; history remains readable")
                })?
                .valid()?;
            self.database
                .as_ref()
                .ok_or_else(|| error("adoption incomplete"))?
                .verify_snapshot(&s.id, &original.fingerprint)?;
            if crate::tasks::digest(self.summary_stamp(&s.id)?.as_bytes()) != original.fingerprint {
                return Err(error("original source changed; continuation withheld"));
            }
            let projection=self.database.as_ref().unwrap().recovery(&s.id)?;
            if projection["guarded"] == true {return Err(error("original lifecycle is guarded"));}
            recovery::revalidate(&self.metadata(&s.id)?.0, &projection)?;
            let generation = s.contract.as_ref().ok_or_else(|| error("original contract missing"))?.generation;
            let boundary = s.original_generation.ok_or_else(|| error("original generation missing"))?;
            if boundary == 0 || boundary > generation || (boundary == generation && s.native
                .as_ref()
                .is_none_or(|n| n.thread != original.thread))
            {
                return Err(error("original native identity changed"));
            }
        }
        Ok(())
    }
    pub(crate) fn activate(
        &self,
        id: &str,
        store: &mut crate::Store,
        binary: &FsPath,
        native_root: &FsPath,
    ) -> Result<Value> {
        self.owner
            .as_ref()
            .ok_or_else(|| error("original owner is active or unknown; history remains readable"))?
            .valid()?;
        let meta = self.metadata(id)?.1;
        let project=meta["projectRoot"].as_str().ok_or_else(||error("recorded project missing"))?;
        let catalog=self.catalog()?;
        if !catalog["projects"].as_array().is_some_and(|ps|ps.iter().any(|p|p["projectId"]==crate::projects::id(project)&&p["path"]==project)) {return Err(error("project catalog binding mismatch"));}
        let (mut s, context) = self
            .database
            .as_ref()
            .ok_or_else(|| error("adoption incomplete"))?
            .context(id, project)?;
        // Validate availability before native identity/configuration preparation.
        let binding = if let Ok(p)=store.project_by_id(&crate::projects::id(project)) {crate::projects::validate(&p)?;p} else {
            // Registration follows all source/native validation below.
            deck2_shared::ProjectBinding {id:crate::projects::id(project),root:project.into(),identity:None}
        };
        if binding.identity.is_none() {crate::projects::available(project)?;}
        if let Ok(old) = store.session_by_id(id) {
            if old.original.as_ref() != Some(&context) || old.project.id != binding.id || old.project.root != binding.root {
                return Err(error("original session identity collision"));
            }
            self.check_context(&old)?;
            return Ok(json!({"session":old}));
        }
        verify_rollout(native_root, &context.thread, project)?;
        s.project=store.register_project(project)?;
        let configuration=store.configuration_for(project)?;
        let selected=configuration.runner.as_ref().map(|r|FsPath::new(&r.path)).unwrap_or(binary);
        let provenance = crate::native::provenance(selected, &deck2_shared::Mode::SessionV1)?;
        s.native = Some(deck2_shared::NativeContext {
            runner: Some(deck2_shared::NativeRunner::Codex),
            thread: context.thread.clone(),
            mode: deck2_shared::Mode::SessionV1,
            provenance: Some(provenance),
        });
        self.check_context(&s)?;
        crate::web_identity::admit()?;
        s.project=store.register_project(project)?;
        store.save_session(&s)?;
        Ok(json!({"session":s}))
    }
}
/// Verify the native rollout's own session identity and project before binding.
/// The normal resume handshake independently checks returned thread/model/policy.
fn verify_rollout(native_root: &FsPath, thread: &str, project: &str) -> Result<()> {
    if !native_root.is_absolute() || uuid::Uuid::parse_str(thread).is_err() {
        return Err(error("native storage identity is unverified"));
    }
    let mut dirs = vec![(native_root.join("sessions"), 0)];
    let mut seen = 0;
    while let Some((dir, depth)) = dirs.pop() {
        let meta =
            std::fs::symlink_metadata(&dir).map_err(|_| error("native history unavailable"))?;
        if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } {
            return Err(error("unsafe native history"));
        }
        for item in std::fs::read_dir(&dir).map_err(|_| error("native history unavailable"))? {
            seen += 1;
            if seen > 100_000 {
                return Err(error("native history discovery exceeds bound"));
            }
            let item = item.map_err(|_| error("native history unavailable"))?;
            let typ = item
                .file_type()
                .map_err(|_| error("native history unavailable"))?;
            if typ.is_dir() && depth < 3 {
                dirs.push((item.path(), depth + 1));
            } else if typ.is_file()
                && item
                    .file_name()
                    .to_string_lossy()
                    .ends_with(&format!("{thread}.jsonl"))
            {
                use std::os::unix::fs::OpenOptionsExt;
                let f = std::fs::OpenOptions::new()
                    .read(true)
                    .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
                    .open(item.path())
                    .map_err(|_| error("native history unavailable"))?;
                let meta = f
                    .metadata()
                    .map_err(|_| error("native history unavailable"))?;
                if !meta.is_file() || meta.uid() != unsafe { libc::geteuid() } {
                    return Err(error("unsafe native history"));
                }
                let mut line = Vec::new();
                BufReader::new(f)
                    .take(MAX_LINE as u64 + 1)
                    .read_until(b'\n', &mut line)
                    .map_err(|_| error("native history unreadable"))?;
                if line.len() > MAX_LINE {
                    return Err(error("native metadata exceeds bound"));
                }
                let v: Value =
                    serde_json::from_slice(&line).map_err(|_| error("native metadata invalid"))?;
                if v["type"] == "session_meta"
                    && v["payload"]["id"] == thread
                    && v["payload"]["cwd"] == project
                {
                    return Ok(());
                }
                return Err(error("native rollout identity/project mismatch"));
            }
        }
    }
    Err(error(
        "native context not found; original history is retained",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_adoption_is_transactional_and_idempotent() {
        let f = tests_fixture();
        let mut r = Reader {
            root: Some(f.path().into()),
            ..Default::default()
        };
        r.adopt(&f.path().join("adopt.db")).unwrap();
    }

    fn write(p: &FsPath, b: impl AsRef<[u8]>) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(p, b).unwrap();
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    fn event(seq: u64, kind: &str, data: Value) -> Value {
        json!({"v":1,"sessionId":"original","seq":seq,"ts":format!("2026-01-{:02}T00:00:00Z",seq%28+1),"kind":kind,"source":{"taskId":"lead","memberId":"lead","attempt":7},"data":data,"future":true})
    }
    fn events(f: &tempfile::TempDir, rows: &[Value]) -> Vec<u8> {
        let raw = rows
            .iter()
            .map(|e| format!("{e}\n"))
            .collect::<String>()
            .into_bytes();
        write(
            &f.path().join("sessions/original/events/000001.jsonl"),
            &raw,
        );
        raw
    }
    fn release(r: Reader, f: &tempfile::TempDir) {
        drop(r);
        for _ in 0..200 {
            if !f.path().join("daemon/daemon.lock").exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        panic!("reservation not released");
    }
    // Protects raw/unknown/identity retention, newest folded SQL pages, recovery,
    // original deletion timestamps and absence of any executable imported queue.
    #[test]
    fn interrupted_adoption_retries_without_replay_or_duplicate_rows() {
        let f = tests_fixture();
        let mut rows = vec![
            event(1, "future.unknown", json!({"opaque":{"preserve":[1,2]}})),
            event(
                2,
                "approval.resolved",
                json!({"decision":"allow","by":"old-grant"}),
            ),
            event(
                3,
                "prompt.queued",
                json!({"promptId":"old","text":"NEVER REPLAY"}),
            ),
        ];
        for n in 4..=3000 {
            rows.push(event(
                n,
                "message.completed",
                json!({"role":"assistant","text":format!("answer {n}"),"padding":"x".repeat(1800)}),
            ));
        }
        let raw = events(&f, &rows);
        let path = f.path().join("adopt.db");
        let mut r = Reader {
            root: Some(f.path().into()),
            interrupt_adoption: true,
            ..Default::default()
        };
        assert!(
            r.adopt(&path)
                .unwrap_err()
                .contains("injected interruption")
        );
        assert!(r.database.is_none());
        let c = Connection::open(&path).unwrap();
        let ready: i64 = c
            .query_row("SELECT ready FROM original_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ready, 0);
        drop(c);
        for _ in 0..200 {
            if !f.path().join("daemon/daemon.lock").exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        r.interrupt_adoption = false;
        r.adopt(&path).unwrap();
        let db = r.database.as_ref().unwrap();
        let count: i64 = db
            .conn
            .query_row("SELECT count(*) FROM original_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3000);
        let saved: Vec<u8> = db
            .conn
            .prepare("SELECT raw FROM original_events ORDER BY seq")
            .unwrap()
            .query_map([], |r| r.get::<_, Vec<u8>>(0))
            .unwrap()
            .flat_map(|r| r.unwrap())
            .collect();
        assert_eq!(saved, raw);
        let p = db
            .page(
                "original",
                &PageQuery {
                    limit: Some(2),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(p["messages"][1]["data"]["text"], "answer 3000");
        assert_eq!(p["messages"][0]["historyId"], 2999);
        let older = db
            .page(
                "original",
                &PageQuery {
                    limit: Some(2),
                    snapshot: Some(p["snapshot"].as_str().unwrap().into()),
                    before: Some(2999),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(older["messages"][1]["data"]["text"], "answer 2998");
        assert_eq!(
            db.conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name='receipts'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        release(r, &f);
        let mut r = Reader {
            root: Some(f.path().into()),
            ..Default::default()
        };
        r.adopt(&path).unwrap();
        assert_eq!(
            r.page("original", &PageQuery::default()).unwrap()["boundary"],
            3000
        );
        release(r, &f);
        assert_eq!(
            std::fs::read(f.path().join("sessions/original/events/000001.jsonl")).unwrap(),
            raw
        );
    }
    #[test]
    fn changed_malformed_sources_and_successful_deletion_are_preserved() {
        let f = tests_fixture();
        let raw = events(
            &f,
            &[event(1, "session.removed", json!({"phase":"removed"}))],
        );
        let path = f.path().join("adopt.db");
        let mut r = Reader {
            root: Some(f.path().into()),
            ..Default::default()
        };
        r.adopt(&path).unwrap();
        let p = r.page("original", &PageQuery::default()).unwrap();
        assert_eq!(p["summary"]["deletedAt"], "2026-01-02T00:00:00Z");
        assert_eq!(
            r.sessions(&project_id("/missing"), &ListQuery::default())
                .unwrap()["sessions"],
            json!([])
        );
        release(r, &f);
        events(
            &f,
            &[
                event(1, "session.removed", json!({"phase":"removed"})),
                event(2, "future.changed", json!({})),
            ],
        );
        let mut r = Reader {
            root: Some(f.path().into()),
            ..Default::default()
        };
        assert!(r.adopt(&path).unwrap_err().contains("source changed"));
        write(
            &f.path().join("sessions/original/events/000001.jsonl"),
            b"{malformed}\n",
        );
        let other = f.path().join("bad.db");
        assert!(r.adopt(&other).is_err());
        assert_eq!(
            std::fs::read(f.path().join("sessions/original/events/000001.jsonl")).unwrap(),
            b"{malformed}\n"
        );
        assert!(!raw.is_empty());
    }
    #[test]
    fn original_live_unknown_and_competing_owners_are_refused() {
        use std::os::unix::fs::PermissionsExt;
        let f = tests_fixture();
        std::fs::create_dir(f.path().join("daemon")).unwrap();
        std::fs::set_permissions(
            f.path().join("daemon"),
            std::fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        let lock = f.path().join("daemon/daemon.lock");
        write(
            &lock,
            json!({"v":1,"pid":std::process::id(),"nonce":"old","startedAt":0}).to_string(),
        );
        assert!(owner::Owner::acquire(f.path()).is_err());
        assert!(lock.exists());
        write(&lock, b"unknown");
        assert!(owner::Owner::acquire(f.path()).is_err());
        assert_eq!(std::fs::read(&lock).unwrap(), b"unknown");
        std::fs::remove_file(&lock).unwrap();
        let owner = owner::Owner::acquire(f.path()).unwrap();
        assert!(owner::Owner::acquire(f.path()).is_err());
        drop(owner);
        for _ in 0..200 {
            if !lock.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let _successor = owner::Owner::acquire(f.path()).unwrap();
    }
    #[test]
    fn reservation_outlives_host_handle_until_native_group_is_gone() {
        use std::os::unix::process::CommandExt;
        let f = tests_fixture();
        let owner = owner::Owner::acquire(f.path()).unwrap();
        let mut command = std::process::Command::new("sleep");
        command.arg("20");
        unsafe {
            command.pre_exec(|| {
                libc::setpgid(0, 0);
                Ok(())
            });
        }
        let mut child = command.spawn().unwrap();
        owner.track(child.id()).unwrap();
        drop(owner);
        std::thread::sleep(std::time::Duration::from_millis(30));
        assert!(owner::Owner::acquire(f.path()).is_err());
        child.kill().unwrap();
        child.wait().unwrap();
        let lock = f.path().join("daemon/daemon.lock");
        for _ in 0..200 {
            if !lock.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let _successor = owner::Owner::acquire(f.path()).unwrap();
    }

    #[tokio::test]
    async fn continuation_requires_original_native_identity_and_keeps_historical_authority_inert() {
        let f = tests_fixture();
        let project=f.path().to_str().unwrap();
        let meta = f.path().join("sessions/original/session.json");
        let mut m: Value = serde_json::from_slice(&std::fs::read(&meta).unwrap()).unwrap();
        m["projectRoot"] = json!(project);
        m["members"] = json!({"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}});
        write(&meta, m.to_string());
        let thread = "12345678-1234-1234-1234-123456789abc";
        events(
            &f,
            &[
                event(
                    1,
                    "task.created",
                    json!({"taskId":"lead","memberId":"lead","runnerId":"codex","modelId":"gpt-6.1-sol"}),
                ),
                event(
                    2,
                    "task.state",
                    json!({"taskId":"lead","state":"completed","nativeSessionId":thread}),
                ),
                event(
                    3,
                    "task.continued",
                    json!({"taskId":"lead","attempt":2,"nativeSessionId":thread}),
                ),
                event(
                    4,
                    "task.state",
                    json!({"taskId":"lead","state":"completed"}),
                ),
                event(5, "prompt.queued", json!({"text":"never execute"})),
                event(
                    6,
                    "approval.resolved",
                    json!({"decision":"allow","by":"old-grant"}),
                ),
            ],
        );
        let mut reader = Reader {
            root: Some(f.path().into()),
            ..Default::default()
        };
        reader.adopt(&f.path().join("adopt.db")).unwrap();
        let execution=f.path().join("execution.db");
        let mut store = crate::Store::open(&execution,project).unwrap();
        let native = f.path().join("native");
        std::fs::create_dir_all(native.join("sessions")).unwrap();
        let rollout = native.join(format!("sessions/rollout-{thread}.jsonl"));
        let binary = f.path().join("fake");
        write(&binary, "fake executable");
        write(
            &rollout,
            json!({"type":"session_meta","payload":{"id":thread,"cwd":"/wrong"}}).to_string(),
        );
        assert!(
            reader
                .activate("original", &mut store, &binary, &native)
                .unwrap_err()
                .contains("mismatch")
        );
        assert!(store.session_by_id("original").is_err());
        write(
            &rollout,
            json!({"type":"session_meta","payload":{"id":thread,"cwd":project}}).to_string(),
        );
        reader
            .activate("original", &mut store, &binary, &native)
            .unwrap();
        let s = store.session_by_id("original").unwrap();
        assert_eq!(s.original.as_ref().unwrap().attempt, 2);
        assert_eq!(s.native.as_ref().unwrap().thread, thread);
        assert_eq!(s.contract.as_ref().unwrap().lead_task, "lead");
        assert_eq!(s.contract.as_ref().unwrap().approvals, "relay");
        assert!(store.all().unwrap().is_empty());
        reader.check_context(&s).unwrap();
        let revision=s.contract.as_ref().unwrap().revision;
        let evolved=store.assign_member("original","lead",serde_json::from_value(json!({"runnerId":"codex","modelId":"gpt-6.1-sol","thinking":"high"})).unwrap(),revision).expect("idle adopted assignment must be editable");
        assert_eq!(evolved.original,s.original);
        assert_eq!(evolved.project,s.project);
        assert_eq!(evolved.contract.as_ref().unwrap().lead_task,s.contract.as_ref().unwrap().lead_task);
        assert_eq!(evolved.contract.as_ref().unwrap().generation,s.contract.as_ref().unwrap().generation+1);
        assert!(evolved.native.is_none());
        reader.check_context(&evolved).unwrap();
        let activated=reader.activate("original",&mut store,&binary,&native).unwrap();
        assert_eq!(activated["session"],serde_json::to_value(&evolved).unwrap());
        drop(store);
        let store=crate::Store::open(&execution,project).unwrap();
        assert_eq!(store.session_by_id("original").unwrap(),evolved);
        reader.check_context(&store.session_by_id("original").unwrap()).unwrap();
        let mut stale=evolved.clone();stale.original_generation=Some(stale.contract.as_ref().unwrap().generation);assert!(reader.check_context(&stale).is_err());
        // Hold real discovery, then change the original source. The authenticated
        // assignment handler must recheck provenance under its mutation lock.
        use tower::ServiceExt;
        use axum::{body::Body,http::Request};
        use std::os::unix::fs::PermissionsExt;
        let script=include_str!("../tests/fake_session_native.py").replace("elif m=='model/list':result","elif m=='model/list':\n  (root/'assignment-entered').touch()\n  deadline=time.monotonic()+10\n  while not (root/'assignment-release').exists():\n   if time.monotonic()>deadline:raise RuntimeError('release deadline')\n   time.sleep(.005)\n  result");
        write(&binary,script);std::fs::set_permissions(&binary,std::fs::Permissions::from_mode(0o700)).unwrap();
        let app=crate::server::App::new(store,"127.0.0.1:32123".into(),binary,None,"admin".into(),"recover".into());
        *app.native_role_root.lock().unwrap()=native;
        *app.history.lock().unwrap()=reader;
        let auth=crate::server::router(app.clone()).oneshot(Request::builder().method("POST").uri("/auth").header("host","127.0.0.1:32123").header("origin","http://127.0.0.1:32123").body(Body::from(app.issue_launch())).unwrap()).await.unwrap();
        let cookie=auth.headers()["set-cookie"].to_str().unwrap().split(';').next().unwrap().to_owned();
        let request=Request::builder().method("POST").uri("/api/sessions/original/assignments").header("host","127.0.0.1:32123").header("origin","http://127.0.0.1:32123").header("cookie",cookie).header("content-type","application/json").body(Body::from(json!({"api":deck2_shared::API,"memberId":"lead","assignment":{"runnerId":"codex","modelId":"openai-codex/gpt-6.1-sol","thinking":"high"},"expectedRevision":evolved.contract.as_ref().unwrap().revision}).to_string())).unwrap();
        let pending=tokio::spawn(crate::server::router(app.clone()).oneshot(request));
        tokio::time::timeout(std::time::Duration::from_secs(5),async {while !f.path().join("assignment-entered").exists(){tokio::time::sleep(std::time::Duration::from_millis(5)).await;}}).await.unwrap();
        let source=f.path().join("sessions/original/session.json");
        let mut changed:Value=serde_json::from_slice(&std::fs::read(&source).unwrap()).unwrap();changed["title"]=json!("changed source during discovery");write(&source,changed.to_string());
        write(&f.path().join("assignment-release"),"");
        let response=pending.await.unwrap().unwrap();assert_eq!(response.status(),409);
        assert_eq!(app.store.lock().unwrap().session_by_id("original").unwrap(),evolved);
        assert!(!f.path().join("dispatch-count").exists());
        assert!(app.store.lock().unwrap().all().unwrap().is_empty());
        let reader=std::mem::take(&mut *app.history.lock().unwrap());drop(app);
        release(reader, &f);
        let reader = Reader::default();
        assert!(reader.check_context(&s).is_err());
    }
    #[test]
    fn orphan_socket_and_unproven_dispatched_processes_never_enable_adoption() {
        use std::os::unix::fs::PermissionsExt;
        let f = tests_fixture();
        std::fs::create_dir(f.path().join("daemon")).unwrap();
        std::fs::set_permissions(
            f.path().join("daemon"),
            std::fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        let socket =
            std::os::unix::net::UnixListener::bind(f.path().join("daemon/daemon.sock")).unwrap();
        assert!(owner::Owner::acquire(f.path()).is_err());
        drop(socket);
        std::fs::remove_file(f.path().join("daemon/daemon.sock")).unwrap();
        events(
            &f,
            &[
                event(
                    1,
                    "task.created",
                    json!({"taskId":"lead","memberId":"lead","runnerId":"codex","modelId":"original"}),
                ),
                event(2, "task.state", json!({"taskId":"lead","state":"running"})),
            ],
        );
        let mut reader = Reader {
            root: Some(f.path().into()),
            ..Default::default()
        };
        assert!(reader.adopt(&f.path().join("adopt.db")).is_err());
        assert!(reader.database.is_none());
    }
    fn recovery_fixture(state: &str) -> tempfile::TempDir {
        let f = tests_fixture();
        let path = f.path().join("sessions/original/session.json");
        let mut meta: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        meta["members"] = json!({"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}});
        write(&path, meta.to_string());
        events(&f, &[
            event(1,"task.created",json!({"taskId":"lead","memberId":"lead","runnerId":"codex","modelId":"gpt-6.1-sol"})),
            event(2,"task.state",json!({"taskId":"lead","state":state,"nativeSessionId":"12345678-1234-1234-1234-123456789abc"})),
        ]);
        f
    }
    fn settled_lease(f: &tempfile::TempDir) -> Value {
        use std::os::unix::fs::PermissionsExt;
        let p = f.path().join("sessions/original/tasks/lead");
        std::fs::create_dir_all(&p).unwrap();
        std::fs::set_permissions(f.path().join("sessions/original/tasks"), std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o700)).unwrap();
        // A boot different from this kernel is positive containment evidence.
        let boot = std::fs::read_to_string("/proc/sys/kernel/random/boot_id").unwrap();
        let old = if boot.trim() == "00000000-0000-0000-0000-000000000001" {"00000000-0000-0000-0000-000000000002"} else {"00000000-0000-0000-0000-000000000001"};
        let lease = json!({"v":1,"taskId":"lead","nonce":"fixture","createdAt":"2026-01-01Z","state":"live","daemon":{"pid":1},"anchor":{"pid":1,"platform":"linux","boot":old,"starttime":"1"},"group":1});
        write(&p.join("lease.json"), lease.to_string());
        lease
    }
    // Protects original restart disposition, task/attempt identity, and raw history.
    // Oracle: RECOVER-COMPAT-01; fails if settled live work cannot continue after recovery.
    #[test]
    fn settled_interrupted_work_is_durable_without_rewriting_history() {
        let f = recovery_fixture("running");
        settled_lease(&f);
        let source = f.path().join("sessions/original/events/000001.jsonl");
        let raw = std::fs::read(&source).unwrap();
        let db = f.path().join("adopt.db");
        for _ in 0..2 {
            let mut r = Reader {root:Some(f.path().into()), ..Default::default()};
            r.adopt(&db).unwrap();
            let (s, ctx) = r.database.as_ref().unwrap().context("original", "/missing").unwrap();
            assert_eq!(ctx.task, "lead");
            assert_eq!(ctx.attempt, 1);
            assert_eq!(s.contract.unwrap().approvals, "relay");
            assert_eq!(r.page("original", &PageQuery::default()).unwrap()["recovery"]["tasks"]["lead"]["state"], "interrupted");
            assert_eq!(std::fs::read(&source).unwrap(), raw);
            release(r, &f);
        }
    }
    // Oracle: original created work never acquired processes; missing running lease does not qualify.
    #[test]
    fn never_dispatched_original_work_can_recover_but_running_without_proof_cannot() {
        let f = recovery_fixture("queued");
        let mut r = Reader {root:Some(f.path().into()), ..Default::default()};
        r.adopt(&f.path().join("adopt.db")).unwrap();
        r.database.as_ref().unwrap().context("original", "/missing").unwrap();
        release(r,&f);
        let f = recovery_fixture("running");
        let mut r = Reader {root:Some(f.path().into()), ..Default::default()};
        assert!(r.adopt(&f.path().join("adopt.db")).is_err());
    }
    // Oracle: original session lifecycle guards survive even when its task is terminal.
    #[test]
    fn stopped_ended_released_and_removed_original_sessions_stay_guarded() {
        for (kind,data) in [
            ("session.state",json!({"state":"stopping","cancelPrompts":true})),
            ("session.ended",json!({"reason":"stopped"})),
            ("session.released",json!({"epoch":1,"phase":"released"})),
            ("session.removed",json!({"phase":"removing"})),
            ("session.removed",json!({"phase":"removed"})),
        ] {
            let f = recovery_fixture("completed");
            let file=f.path().join("sessions/original/events/000001.jsonl");
            let mut raw=std::fs::read_to_string(&file).unwrap();
            raw.push_str(&format!("{}\n",event(3,kind,data)));
            write(&file,raw);
            let mut r = Reader {root:Some(f.path().into()), ..Default::default()};
            r.adopt(&f.path().join("adopt.db")).unwrap();
            assert!(r.database.as_ref().unwrap().context("original","/missing").is_err(), "{kind}");
            release(r,&f);
        }
    }
    // Protects fail-closed containment, including malformed/claiming leases and
    // current-boot absent, active and reused identities. All effects are fixture-owned.
    #[test]
    fn recovery_process_evidence_matrix_refuses_uncertain_ownership() {
        let boot=std::fs::read_to_string("/proc/sys/kernel/random/boot_id").unwrap();
        let stat=std::fs::read_to_string(format!("/proc/{}/stat",std::process::id())).unwrap();
        let start=stat.rsplit_once(')').unwrap().1.split_whitespace().nth(19).unwrap();
        for case in ["claiming","malformed","incomplete","platform","boot","worker","alive","reused","same-boot-absent"] {
            let f=recovery_fixture("running");
            let mut lease=settled_lease(&f);
            match case {
                "claiming" => lease["state"]=json!("claiming"),
                "incomplete" => {lease.as_object_mut().unwrap().remove("anchor");},
                "platform" => lease["anchor"]["platform"]=json!("darwin"),
                "boot" => lease["anchor"]["boot"]=json!("unknown"),
                "worker" => lease["worker"]=json!({"pid":1,"platform":"linux","boot":"unknown","starttime":"1"}),
                "alive" | "reused" => {
                    lease["anchor"]=json!({"pid":std::process::id(),"platform":"linux","boot":boot.trim(),"starttime":if case=="alive"{start}else{"0"}});
                    lease["group"]=json!(std::process::id());
                }
                "same-boot-absent" => {
                    lease["anchor"]=json!({"pid":2147483647,"platform":"linux","boot":boot.trim(),"starttime":"1"});
                    lease["group"]=json!(2147483647);
                }
                _ => {}
            }
            write(&f.path().join("sessions/original/tasks/lead/lease.json"),if case=="malformed" {"{bad".into()} else {lease.to_string()});
            let mut r=Reader{root:Some(f.path().into()),..Default::default()};
            let result=r.adopt(&f.path().join("adopt.db"));
            if case=="same-boot-absent" {
                result.unwrap();
                r.database.as_ref().unwrap().context("original","/missing").unwrap();
                release(r,&f);
            } else {assert!(result.is_err(),"{case}");}
        }
    }
    #[test]
    fn recovery_rechecks_source_owner_and_lease_after_activation() {
        for change in ["source","owner","lease"] {
            let f=recovery_fixture("running");settled_lease(&f);
            let mut r=Reader{root:Some(f.path().into()),..Default::default()};
            r.adopt(&f.path().join("adopt.db")).unwrap();
            let (mut session,context)=r.database.as_ref().unwrap().context("original","/missing").unwrap();
            session.native=Some(deck2_shared::NativeContext{runner:Some(deck2_shared::NativeRunner::Codex),thread:context.thread, mode:deck2_shared::Mode::SessionV1,provenance:None});
            r.check_context(&session).unwrap();
            match change {
                "source" => write(&f.path().join("sessions/original/events/000001.jsonl"),format!("{}\n",event(1,"future.changed",json!({})))),
                "owner" => write(&f.path().join("daemon/daemon.lock"),json!({"v":1,"pid":std::process::id(),"nonce":"competitor"}).to_string()),
                "lease" => std::fs::remove_file(f.path().join("sessions/original/tasks/lead/lease.json")).unwrap(),
                _=>unreachable!(),
            }
            assert!(r.check_context(&session).is_err(),"{change}");
            drop(r); // A replaced owner lock belongs to the fixture and is never removed by us.
        }
    }
    #[test]
    fn only_bound_never_delivered_prompt_provenance_recovers_missing_running_lease() {
        for delivered in [false,true] {
            let f=recovery_fixture("completed");
            let mut rows=vec![
                event(1,"task.created",json!({"taskId":"lead","memberId":"lead","runnerId":"codex","modelId":"gpt-6.1-sol"})),
                event(2,"task.state",json!({"taskId":"lead","state":"completed"})),
                event(3,"prompt.queued",json!({"promptId":"old","text":"NEVER REPLAY","textHash":"fixture-hash"})),
                event(4,"task.continued",json!({"taskId":"lead","attempt":2,"promptId":"old","nativeSessionId":"12345678-1234-1234-1234-123456789abc"})),
                event(5,"task.state",json!({"taskId":"lead","state":"running"})),
            ];
            if delivered {rows.push(event(6,"prompt.dispatched",json!({"promptId":"old","taskId":"lead","attempt":2,"handoff":"gated"})));rows.push(event(7,"prompt.handoff",json!({"promptId":"old","taskId":"lead","attempt":2,"state":"sending"})));}
            events(&f,&rows);
            let mut r=Reader{root:Some(f.path().into()),..Default::default()};
            let result=r.adopt(&f.path().join("adopt.db"));
            if delivered {assert!(result.is_err());} else {result.unwrap();assert_eq!(r.database.as_ref().unwrap().context("original","/missing").unwrap().1.attempt,2);release(r,&f);}
        }
    }
    // Oracle: Deck1 Ledger guarded returns restore FIFO provenance; no old input executes.
    #[test]
    fn recovery72_refused_return() { recovery72_returns(&["refused"]); }
    #[test]
    fn recovery72_guarded_returns_and_negative_controls() {
        recovery72_returns(&["requeued", "refused", "sending", "delivered", "unknown", "wrong-task", "wrong-attempt", "wrong-prompt", "stale-seq", "released-barrier", "accepted"]);
    }
    fn recovery72_returns(cases: &[&str]) {
        for &case in cases {
            let f = recovery_fixture("completed");
            let steering = matches!(case, "refused" | "stale-seq" | "released-barrier" | "accepted");
            let mut rows = vec![
                event(1,"prompt.queued",json!({"promptId":"old","text":"NEVER REPLAY","textHash":"hash"})),
                event(2,"task.created",json!({"taskId":"lead","memberId":"lead","runnerId":"codex","modelId":"gpt-6.1-sol","promptId":"old"})),
                event(3,if steering {"prompt.steering"} else {"prompt.dispatched"},json!({"promptId":"old","taskId":"lead","attempt":1,"handoff":"gated"})),
            ];
            if matches!(case,"sending" | "delivered" | "unknown") {
                rows.push(event(4,"prompt.handoff",json!({"promptId":"old","taskId":"lead","attempt":1,"state":"sending"})));
                if case != "sending" { rows.push(event(5,"prompt.handoff",json!({"promptId":"old","taskId":"lead","attempt":1,"state":case}))); }
            }
            if case == "released-barrier" { rows.push(event(4,"prompt.steered",json!({"promptId":"old","steeringSeq":3,"state":"unknown"}))); }
            rows.push(event(6,if steering {"prompt.steered"} else {"prompt.requeued"},json!({
                "promptId":if case=="wrong-prompt" {"other"} else {"old"},
                "taskId":if case=="wrong-task" {"other"} else {"lead"},
                "attempt":if case=="wrong-attempt" {2} else {1},
                "steeringSeq":if case=="stale-seq" {99} else {3},
                "state":if case=="accepted" {"accepted"} else {"not-accepted"},"queueFallback":true
            })));
            rows.extend([
                event(7,"task.state",json!({"taskId":"lead","state":"interrupted"})),
                event(8,"task.continued",json!({"taskId":"lead","attempt":2,"promptId":"old","nativeSessionId":"12345678-1234-1234-1234-123456789abc"})),
                event(9,"task.state",json!({"taskId":"lead","state":"running"})),
            ]);
            for (i,row) in rows.iter_mut().enumerate() {row["seq"]=json!(i+1);}
            events(&f,&rows);
            let mut r=Reader{root:Some(f.path().into()),..Default::default()};
            let result=r.adopt(&f.path().join("adopt.db"));
            if matches!(case,"requeued" | "refused") {
                result.unwrap_or_else(|e|panic!("{case}: {e}"));
                assert_eq!(r.database.as_ref().unwrap().context("original","/missing").unwrap().1.attempt,2);
                release(r,&f);
            } else { assert!(result.is_err(),"{case}"); }
        }
    }
    // Oracle: persisted containment obligations survive restart; only a missing row is legacy absence.
    #[test]
    fn recovery72_restart_preserves_proof_and_supports_legacy_absence() {
        for case in ["missing-lease", "legacy", "corrupt", "unsupported", "wrong-attempt"] {
            let f=recovery_fixture("running");
            events(&f,&[
                event(1,"prompt.queued",json!({"promptId":"old","text":"NEVER REPLAY","textHash":"hash"})),
                event(2,"task.created",json!({"taskId":"lead","memberId":"lead","runnerId":"codex","modelId":"gpt-6.1-sol","promptId":"old"})),
                event(3,"task.state",json!({"taskId":"lead","state":"running","nativeSessionId":"12345678-1234-1234-1234-123456789abc"})),
            ]);
            settled_lease(&f);
            let path=f.path().join("adopt.db");
            let mut r=Reader{root:Some(f.path().into()),..Default::default()};r.adopt(&path).unwrap();
            let saved=r.database.as_ref().unwrap().recovery("original").unwrap();
            assert_eq!(saved["tasks"]["lead"]["reason"],"process-containment-settled");
            release(r,&f);
            let c=Connection::open(&path).unwrap();
            match case {
                "missing-lease" => std::fs::remove_file(f.path().join("sessions/original/tasks/lead/lease.json")).unwrap(),
                "legacy" => {c.execute("DELETE FROM original_recovery",[]).unwrap();},
                _ => {let mut bad=saved.clone();if case=="unsupported" {bad["version"]=json!(99);} else if case=="wrong-attempt" {bad["tasks"]["lead"]["attempt"]=json!(99);}
                    c.execute("UPDATE original_recovery SET body=?1",[if case=="corrupt" {"{bad".into()} else {bad.to_string()}]).unwrap();},
            }
            drop(c);
            let mut r=Reader{root:Some(f.path().into()),..Default::default()};
            let result=r.adopt(&path);
            if case=="legacy" {result.unwrap();assert_eq!(r.database.as_ref().unwrap().recovery("original").unwrap(),saved);release(r,&f);} else {assert!(result.is_err(),"{case}");}
        }
    }
    // A dead anchor alone is insufficient while its fixture-owned group remains alive.
    #[test]
    fn recovered_work_requires_the_entire_original_process_group_to_be_gone() {
        use std::os::unix::process::CommandExt;
        let f=recovery_fixture("running");
        let mut cmd=std::process::Command::new("sh");cmd.args(["-c","sleep 20 &"]);
        cmd.process_group(0);
        let child=cmd.spawn().unwrap();
        struct Group(std::process::Child);
        impl Drop for Group {fn drop(&mut self){unsafe{libc::kill(-(self.0.id() as i32),libc::SIGKILL);}let _=self.0.wait();}}
        let group=Group(child);
        let mut zombie=None;
        for _ in 0..200 {
            let stat=std::fs::read_to_string(format!("/proc/{}/stat",group.0.id())).unwrap();
            let fields=stat.rsplit_once(')').unwrap().1.split_whitespace().collect::<Vec<_>>();
            if fields[0]=="Z" {zombie=Some(fields[19].to_string());break;}
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let start=zombie.expect("fixture anchor did not exit");
        let mut lease=settled_lease(&f);
        lease["anchor"]=json!({"pid":group.0.id(),"platform":"linux","boot":std::fs::read_to_string("/proc/sys/kernel/random/boot_id").unwrap().trim(),"starttime":start});
        lease["group"]=json!(group.0.id());
        write(&f.path().join("sessions/original/tasks/lead/lease.json"),lease.to_string());
        let (dir,_)=Reader{root:Some(f.path().into()),..Default::default()}.metadata("original").unwrap();
        assert!(owner::settled(&dir).unwrap_err().contains("group is alive"));
    }
    // Context validation waiting for history must not retain Store: workspace and
    // notification projections need both locks and must remain able to finish.
    #[test]
    fn original_context_wait_does_not_block_independent_store_progress() {
        let root=tempfile::tempdir().unwrap();
        let app=crate::server::App::new(crate::Store::open_memory(root.path().to_str().unwrap()).unwrap(),"127.0.0.1:3333".into(),"/missing/native".into(),Some("unavailable".into()),"admin".into(),"deck2 open".into());
        let id=app.store.lock().unwrap().sessions().unwrap()[0].id.clone();
        let history=app.history.lock().unwrap();
        let (send,recv)=std::sync::mpsc::channel();
        let worker={let app=app.clone();std::thread::spawn(move || {send.send(unsafe{libc::gettid()}).unwrap();app.check_original_context(&id)})};
        let tid=recv.recv().unwrap();
        let mut waiting=false;
        for _ in 0..500 {
            let state=std::fs::read_to_string(format!("/proc/self/task/{tid}/wchan")).unwrap();
            if state.contains("futex") {waiting=true;break;}
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let store_available=app.store.try_lock().is_ok();
        drop(history);
        worker.join().unwrap().unwrap();
        assert!(waiting,"context worker did not reach its controlled lock wait");
        assert!(store_available,"context wait starved Store: workspace/notification lock inversion");
    }
    // Protects the production MCP resolver, immutable assignment and logical N+1.
    // Oracle: ORIGINAL-TASK-01/02; the passive history must not be an execution task.
    #[tokio::test]
    async fn original_task_continuation_through_authenticated_mcp() {
        original_task_continuation(false).await;
    }
    // Revocation must reject admitted authority even after wall-clock rollback.
    // A future persisted fence models that clock boundary without changing the
    // host clock, sleeping, or allowing concurrent tests to alter the oracle.
    #[tokio::test]
    async fn original_task_revocation_after_clock_rollback() {
        original_task_continuation(true).await;
    }
    async fn original_task_continuation(clock_rollback: bool) {
        let f = tests_fixture();
        let project = f.path().to_str().unwrap();
        let meta = f.path().join("sessions/original/session.json");
        let mut m: Value = serde_json::from_slice(&std::fs::read(&meta).unwrap()).unwrap();
        m["projectRoot"] = json!(project);
        m["members"] = json!({"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"},"apply-deep":{"runnerId":"codex","modelId":"gpt-6.1-sol"}});
        write(&meta, m.to_string());
        let thread = "12345678-1234-1234-1234-123456789abc";
        let mut rows = vec![
            event(1,"task.created",json!({"taskId":"lead","memberId":"lead","runnerId":"codex","modelId":"gpt-6.1-sol"})),
            event(2,"task.state",json!({"taskId":"lead","state":"completed","nativeSessionId":thread}))
        ];
        rows[0]["source"]["attempt"] = json!(1);
        rows[1]["source"]["attempt"] = json!(1);
        for n in 1..=2 {
            for (kind,data) in [
                (if n==1 {"task.created"} else {"task.continued"},json!({"taskId":"old-worker","memberId":"apply-deep","attempt":n,"runnerId":"codex","modelId":"gpt-6.1-sol","assignedRoleId":"deck-apply-deep","continuityRole":"work","dependsOn":[],"structured":{"acceptance":{"items":[{"id":"A1","text":"Preserve delegated behavior"}]},"findings":[{"id":"F1","state":"open","text":"Check the original boundary","evidenceSeqs":[1]}],"findingStates":{"F1":{"state":"open","seq":1}}}})),
                ("task.result",json!({"summary":format!("Historical report {n}")})),
                ("task.state",json!({"state":"completed"}))
            ] {
                let mut data=data;if n==2 {data.as_object_mut().unwrap().remove("structured");}
                let mut e=event(rows.len() as u64+1,kind,data);
                e["source"]=json!({"taskId":"old-worker","memberId":"apply-deep","attempt":n});
                rows.push(e);
            }
        }
        for (id,runner,role,dependencies) in [("blocked-worker","codex",Some("deck-apply-deep"),json!(["original-decision"])),("unsupported-worker","pi",Some("deck-apply-deep"),json!([])),("missing-role","codex",None,json!([]))] {
            for (kind,data) in [("task.created",json!({"taskId":id,"memberId":"apply-deep","runnerId":runner,"modelId":"gpt-6.1-sol","assignedRoleId":role,"continuityRole":"work","dependsOn":dependencies,"action":"inspect"})),("task.state",json!({"state":"completed"}))] {
                let mut e=event(rows.len() as u64+1,kind,data);e["source"]=json!({"taskId":id,"memberId":"apply-deep","attempt":1});rows.push(e);
            }
        }
        // Late integration belongs to its exact settled attempt, not the latest one.
        for (attempt,state) in [(2,"blocked"),(1,"integrated")] {
            rows.push(event(rows.len() as u64+1,"task.integration",json!({"taskId":"old-worker","attempt":attempt,"leadTaskId":"lead","leadAttempt":7,"state":state})));
        }
        for state in ["cancelled","interrupted"] {
            let id=format!("{state}-worker");
            for (kind,data) in [("task.created",json!({"taskId":id,"memberId":"apply-deep","runnerId":"codex","modelId":"gpt-6.1-sol","assignedRoleId":"deck-apply-deep","continuityRole":"work"})),("task.result",json!({"summary":"Retained interrupted output","reportArtifactUnavailable":true})),("task.state",json!({"state":state,"stopOrigin":"user"}))] {
                let mut e=event(rows.len() as u64+1,kind,data);e["source"]=json!({"taskId":id,"memberId":"apply-deep","attempt":1});rows.push(e);
            }
        }
        for id in ["unknown-integration","foreign-lifecycle","recovery-worker"] {
            for n in 1..=2 {
                for (kind,data) in [(if n==1 {"task.created"}else{"task.continued"},json!({"taskId":id,"memberId":"apply-deep","runnerId":"codex","modelId":"gpt-6.1-sol","assignedRoleId":"deck-apply-deep","continuityRole":"work","recoveryPredecessorAttempt":if id=="recovery-worker" && n==2 {json!(1)}else{Value::Null}})),("task.result",json!({"summary":format!("{id} report {n}")})),("task.state",json!({"state":if n==2 && id=="recovery-worker" {"cancelled"}else{"completed"}}))] {
                    let mut e=event(rows.len() as u64+1,kind,data);e["source"]=json!({"taskId":id,"memberId":"apply-deep","attempt":n});rows.push(e);
                }
            }
            let (kind,attempt)=if id=="foreign-lifecycle" {("task.state",1)}else if id=="unknown-integration" {("task.integration",3)}else{("task.integration",1)};
            let mut e=event(rows.len() as u64+1,kind,json!({"taskId":id,"attempt":attempt,"state":if kind=="task.state" {"completed"}else{"integrated"},"leadTaskId":"lead","leadAttempt":7}));
            e["source"]=json!({"taskId":id,"memberId":"apply-deep","attempt":attempt});rows.push(e);
        }
        let raw=events(&f,&rows);
        let thread_b="22345678-1234-1234-1234-123456789abc";
        let bdir=f.path().join("sessions/original-b/events");std::fs::create_dir_all(&bdir).unwrap();
        {use std::os::unix::fs::PermissionsExt;for path in [bdir.clone(),bdir.parent().unwrap().to_path_buf()] {std::fs::set_permissions(path,std::fs::Permissions::from_mode(0o700)).unwrap();}}
        let mut metadata_b=m.clone();metadata_b["sessionId"]=json!("original-b");write(&bdir.parent().unwrap().join("session.json"),metadata_b.to_string());
        let mut rows_b=rows.clone();for e in &mut rows_b {e["sessionId"]=json!("original-b");if e["data"]["nativeSessionId"]==thread {e["data"]["nativeSessionId"]=json!(thread_b);}}
        let raw_b=rows_b.iter().map(|e|format!("{e}\n")).collect::<String>();write(&bdir.join("000001.jsonl"),&raw_b);
        let mut reader=Reader {root:Some(f.path().into()),..Default::default()};
        reader.adopt(&f.path().join("adopt.db")).unwrap();
        let mut store=crate::Store::open(&f.path().join("execution.db"),project).unwrap();
        let native=f.path().join("native");
        std::fs::create_dir_all(native.join("sessions")).unwrap();
        write(&native.join(format!("sessions/rollout-{thread}.jsonl")),json!({"type":"session_meta","payload":{"id":thread,"cwd":project}}).to_string());
        let binary=f.path().join("fake");write(&binary,"fake executable");
        reader.activate("original",&mut store,&binary,&native).unwrap();
        write(&native.join(format!("sessions/rollout-{thread_b}.jsonl")),json!({"type":"session_meta","payload":{"id":thread_b,"cwd":project}}).to_string());reader.activate("original-b",&mut store,&binary,&native).unwrap();
        let before=store.session_by_id("original").unwrap();
        store.assign_member("original","apply-deep",serde_json::from_value(json!({"runnerId":"codex","modelId":"recorded-worker","thinking":"high"})).unwrap(),before.contract.unwrap().revision).unwrap();
        store.register_codex(crate::tasks::digest(b"fake executable")).unwrap();
        if clock_rollback {
            let mut session=store.session_by_id("original").unwrap();
            session.contract.as_mut().unwrap().grants_revoked_at=crate::now()+60_000;
            store.save_session(&session).unwrap();
        }
        let input=serde_json::from_value(json!({"api":deck2_shared::API,"id":"current-lead","session":"original","mode":"session_v1","prompt":"Continue delegated work"})).unwrap();
        let mut r=store.admit(&input).unwrap();r.phase=deck2_shared::Phase::Running;r.dispatch_ms=Some(crate::now());r.thread=Some(thread.into());r.turn=Some("current-turn".into());store.save(&mut r).unwrap();
        let app=crate::server::App::new(store,"127.0.0.1:32123".into(),binary,None,"admin".into(),"recover".into());
        *app.history.lock().unwrap()=reader;
        let bridge=crate::session_mcp::Bridge::start(&app,"current-lead").await.unwrap();
        let args=json!({"agent":"apply-deep","continueTaskId":"old-worker","task":"Continue the authorized work","sourceTasks":[{"taskId":"cancelled-worker","attempt":1}]});
        async fn invoke_http(config:&Value,name:&str,args:&Value,id:u64)->(u16,Value) {
            let response=reqwest::Client::new().post(config["url"].as_str().unwrap()).header("authorization",config["http_headers"]["Authorization"].as_str().unwrap()).json(&json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":args}})).send().await.unwrap();
            (response.status().as_u16(),response.json().await.unwrap())
        }
        async fn invoke(config:&Value,name:&str,args:&Value,id:u64)->Value {
            invoke_http(config,name,args,id).await.1
        }
        for id in ["blocked-worker","unsupported-worker","missing-role","foreign-session-task"] {
            let refused=invoke(&bridge.config,"deck_delegate",&json!({"agent":"apply-deep","continueTaskId":id,"task":"Attempt unsupported continuation"}),70).await;
            assert_eq!(refused["result"]["isError"],true,"{id}: {refused}");assert!(app.store.lock().unwrap().tasks().unwrap().is_empty());
        }
        for invalid in [json!({"agent":"apply-deep","continueTaskId":7,"task":"Must not create another task"}),json!({"taskId":"old-worker","attempt":"2"})] {
            let name=if invalid.get("agent").is_some(){"deck_delegate"}else{"deck_task_result"};assert_eq!(invoke(&bridge.config,name,&invalid,73).await["result"]["isError"],true);assert!(app.store.lock().unwrap().tasks().unwrap().is_empty());
        }
        let passive=invoke(&bridge.config,"deck_task_list",&json!({}),71).await;assert_eq!(passive["result"]["isError"],false);assert!(app.store.lock().unwrap().tasks().unwrap().is_empty());
        let waited=invoke(&bridge.config,"deck_task_wait",&json!({"taskIds":["old-worker"],"timeoutSec":0}),72).await;assert_eq!(waited["result"]["isError"],false);assert!(app.store.lock().unwrap().tasks().unwrap().is_empty());
        {
            let session=app.store.lock().unwrap().session_by_id("original").unwrap();
            let history=app.history.lock().unwrap();
            for id in ["unknown-integration","foreign-lifecycle"] {assert!(history.task_binding(&session,id).is_err(),"invalid lineage {id}");}
            let (recovery,_)=history.task_binding(&session,"recovery-worker").unwrap();
            assert_eq!(recovery.predecessor["integrated"],true);assert_eq!(recovery.claims["latestDisposition"]["state"],"cancelled");
            assert!(recovery.handoff.contains("recovery-worker report 1"));assert!(!recovery.handoff.contains("recovery-worker report 2"));
            let evidence:Value=serde_json::from_str(recovery.handoff.lines().nth(1).unwrap()).unwrap();assert_eq!(evidence["report"]["attempt"],1);assert_eq!(evidence["report"]["finalReport"],true);

        }
        let response=invoke(&bridge.config,"deck_delegate",&args,78).await;
        assert_eq!(response["result"]["isError"],false,"{response}");
        let result:Value=serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(result["taskId"],"old-worker");assert_eq!(result["attempt"],3);assert_eq!(result["memberId"],"apply-deep");
        let (internal,attempt)={let store=app.store.lock().unwrap();let t=store.logical_task("original","old-worker").unwrap();(t.id.clone(),t.attempts[0].id.clone())};
        // This fixture deliberately has an invalid executable. Wait for that
        // worker to settle, then exercise only the authenticated read transport
        // with a synthetic preparing member; never revive a native process.
        tokio::time::timeout(std::time::Duration::from_secs(5),async {
            while app.active.lock().unwrap().contains_key(&format!("child:{attempt}")) {tokio::time::sleep(std::time::Duration::from_millis(5)).await;}
        }).await.unwrap();
        let settled={let store=app.store.lock().unwrap();let mut t=store.task(&internal).unwrap();assert_eq!(t.attempts[0].phase,deck2_shared::Phase::Failed);assert!(t.attempts[0].dispatch_ms.is_none());let prior=t.clone();t.attempts[0].phase=deck2_shared::Phase::Preparing;store.save_task(&t).unwrap();prior};
        let member=crate::session_mcp::Bridge::start_member(&app,&internal,&attempt).await.unwrap();
        for (id,n,text) in [("old-worker",2,"Historical report 2"),("cancelled-worker",1,"Retained interrupted output")] {
            let response=invoke(&member.config,"deck_task_result",&json!({"taskId":id,"attempt":n}),91).await;assert_eq!(response["result"]["isError"],false,"{response}");let read:Value=serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();assert_eq!(read["result"]["text"],text);assert_eq!(read["source"]["session"],"original");
        }

        drop(member);app.store.lock().unwrap().save_task(&settled).unwrap();
        for (i,state) in ["cancelled","interrupted"].iter().enumerate() {
            let id=format!("{state}-worker");
            let response=invoke(&bridge.config,"deck_task_result",&json!({"taskId":id,"attempt":1}),75+i as u64).await;
            let retained:Value=serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
            assert_eq!(retained["finalReport"],false);assert_eq!(retained["partial"],true);assert_eq!(retained["phase"],*state);assert_eq!(retained["stopOrigin"],"user");assert_eq!(retained["result"]["text"],"Retained interrupted output");assert_eq!(retained["result"]["reportArtifactUnavailable"],true);
            let session=app.store.lock().unwrap().session_by_id("original").unwrap();
            let (binding,_)=app.history.lock().unwrap().task_binding(&session,&id).unwrap();
            let evidence:Value=serde_json::from_str(binding.handoff.lines().nth(1).unwrap()).unwrap();
            assert_eq!(evidence["report"]["partial"],true);assert_eq!(evidence["report"]["finalReport"],false);assert_eq!(evidence["report"]["disposition"],*state);assert_eq!(evidence["report"]["stopOrigin"],"user");
        }
        let again=invoke(&bridge.config,"deck_delegate",&args,78).await;
        assert_eq!(again,response,"identical host invocation must be idempotent");
        let mut changed=args.clone();changed["task"]=json!("Conflicting payload");
        let conflict=invoke(&bridge.config,"deck_delegate",&changed,78).await;
        assert_eq!(conflict["result"]["isError"],true);assert!(conflict.to_string().contains("identity conflict"));
        let mut foreign=args.clone();foreign["agent"]=json!("quality");
        assert_eq!(invoke(&bridge.config,"deck_delegate",&foreign,79).await["result"]["isError"],true);
        let old=invoke(&bridge.config,"deck_task_result",&json!({"taskId":"old-worker","attempt":2}),80).await;
        assert_eq!(old["result"]["isError"],false,"{old}");
        let read:Value=serde_json::from_str(old["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(read["finalReport"],true);assert_eq!(read["partial"],false);assert_eq!(read["result"]["text"],"Historical report 2");assert_eq!(read["evidenceSeqs"][0]["source"],"original");
        let mut integration=json!({"taskId":"old-worker","attempt":2,"commandId":"original-integration","state":"integrated","note":"Inspected exact original report","evidenceSeqs":[read["evidenceSeqs"][0]["seq"]]});
        assert_eq!(invoke(&bridge.config,"deck_task_integrate",&integration,81).await["result"]["isError"],true,"numeric original/current collision cannot satisfy evidence");
        integration["evidenceSeqs"]=read["evidenceSeqs"].clone();
        assert_eq!(invoke(&bridge.config,"deck_task_integrate",&integration,82).await["result"]["isError"],false);
        let source_claims={let store=app.store.lock().unwrap();let t=store.logical_task("original","old-worker").unwrap();serde_json::from_str::<Value>(t.structured.as_deref().unwrap()).unwrap()};
        assert_eq!(source_claims["findings"][0]["evidenceSeqs"][0]["source"],"original");
        assert_eq!(source_claims["findingStates"]["F1"]["seq"]["source"],"original");
        assert!(source_claims["historicalActor"].is_object());

        {
            let store=app.store.lock().unwrap();let mut task=store.logical_task("original","old-worker").unwrap();
            assert_eq!(task.original.as_ref().unwrap().predecessor["integrated"],false);assert_eq!(task.attempts.len(),1);assert_eq!(task.number(0),3);assert_eq!(task.original.as_ref().unwrap().assignment.model_id,"gpt-6.1-sol");assert_eq!(task.authority_root(&task.attempts[0]),"current-lead");
            task.attempts[0].phase=deck2_shared::Phase::Completed;task.attempts[0].settled_ms=Some(crate::now());store.save_normal_task(&task).unwrap();
            store.conn.execute_batch("CREATE TRIGGER reject_original_call BEFORE INSERT ON task_calls BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;").unwrap();
        }
        assert_eq!(invoke(&bridge.config,"deck_delegate",&args,83).await["result"]["isError"],true);
        {
            let store=app.store.lock().unwrap();assert_eq!(store.logical_task("original","old-worker").unwrap().attempts.len(),1);store.conn.execute_batch("DROP TRIGGER reject_original_call").unwrap();
        }
        let seq={let store=app.store.lock().unwrap();let t=store.logical_task("original","old-worker").unwrap();store.conn.query_row("SELECT seq FROM session_events WHERE task=?1 AND attempt=?2 AND kind='task.terminal'",params![t.id,t.attempts[0].id],|r|r.get::<_,u64>(0)).unwrap()};
        integration["commandId"]=json!("current-finding-resolution");integration["findingResolutions"]=json!([{"taskId":"old-worker","findingId":"F1","state":"resolved","reason":"Current Lead checked the recorded boundary","evidenceSeqs":read["evidenceSeqs"]}]);
        assert_eq!(invoke(&bridge.config,"deck_task_integrate",&integration,86).await["result"]["isError"],true,"original references cannot satisfy current finding evidence");
        integration["findingResolutions"][0]["evidenceSeqs"]=json!([seq]);
        let resolved=invoke(&bridge.config,"deck_task_integrate",&integration,87).await;assert_eq!(resolved["result"]["isError"],false,"{resolved}");
        let claims:Value=serde_json::from_str(app.store.lock().unwrap().logical_task("original","old-worker").unwrap().structured.as_deref().unwrap()).unwrap();assert_eq!(claims["findingStates"]["F1"]["state"],"resolved");

        let replan=json!({"agent":"apply-deep","continueTaskId":"blocked-worker","task":"Inspect under the current user instruction","dependsOn":[],"action":"inspect","replan":{"promptId":"current-lead","note":"Current user explicitly revised the original dependency"},"commandId":"original-dependency-replan"});
        let replanned=invoke(&bridge.config,"deck_delegate",&replan,88).await;assert_eq!(replanned["result"]["isError"],false,"{replanned}");
        let state:Value=serde_json::from_str(app.store.lock().unwrap().logical_task("original","blocked-worker").unwrap().structured.as_deref().unwrap()).unwrap();assert_eq!(state["dependsOn"],json!([]));assert!(state.get("originalDependencies").is_none());
        // Current authority revocation is independent of historical source fences.
        let attempts_before={let store=app.store.lock().unwrap();store.tasks().unwrap().iter().map(|t|(t.id.clone(),t.attempts.len())).collect::<std::collections::BTreeMap<_,_>>()};
        app.store.lock().unwrap().revoke_session_grants("original").unwrap();
        let authority={let store=app.store.lock().unwrap();let r=store.get("current-lead").unwrap().unwrap();let current=store.session_by_id("original").unwrap().contract.unwrap();let admitted=r.configuration.unwrap().session_contract.unwrap();json!({"currentRevokedAt":current.grants_revoked_at,"admittedRevokedAt":admitted.grants_revoked_at,"currentGeneration":current.generation,"admittedGeneration":admitted.generation,"sameLead":current.lead_task==admitted.lead_task,"phase":r.phase,"cancelRequested":r.cancel_requested})};
        let (status,revoked)=invoke_http(&bridge.config,"deck_delegate",&args,84).await;
        eprintln!("revocation diagnostic: {}",json!({"status":status,"response":revoked,"authority":authority}));
        assert!(revoked["result"]["isError"]==true || revoked.get("error").is_some(),"status={status} response={revoked} authority={authority}");assert!(revoked.to_string().contains("authority revoked"));
        assert_eq!(status,403,"revoked delegation must fail at the authenticated transport boundary");
        assert!(authority["currentRevokedAt"].as_u64().unwrap()>authority["admittedRevokedAt"].as_u64().unwrap(),"{authority}");
        {
            let mut store=app.store.lock().unwrap();
            assert_eq!(store.tasks().unwrap().iter().map(|t|(t.id.clone(),t.attempts.len())).collect::<std::collections::BTreeMap<_,_>>(),attempts_before,"revoked request created or continued work");
            let previous=store.session_by_id("original").unwrap().contract.unwrap().grants_revoked_at;
            store.revoke_session_grants("original").unwrap();
            assert!(store.session_by_id("original").unwrap().contract.unwrap().grants_revoked_at>previous,"repeated revocation must advance even before wall time catches up");
        }
        // Source replacement is independently rejected before an executable binding.
        write(&f.path().join("sessions/original/events/000001.jsonl"),[raw.as_slice(),b" "].concat());
        let original_session={app.store.lock().unwrap().session_by_id("original").unwrap()};
        assert!(app.history.lock().unwrap().check_context(&original_session).unwrap_err().contains("source changed"));
        write(&f.path().join("sessions/original/events/000001.jsonl"),&raw);
        crate::session_tasks::inspect_events(&app.store.lock().unwrap().conn).unwrap();
        assert_eq!(std::fs::read(f.path().join("sessions/original/events/000001.jsonl")).unwrap(),raw);
        // The same original ID in another authenticated session must bind to a
        // different execution row, and equal original seq/digest cannot cross it.
        let internal_a={let mut store=app.store.lock().unwrap();let mut r=store.get("current-lead").unwrap().unwrap();r.phase=deck2_shared::Phase::Completed;store.save(&mut r).unwrap();store.logical_task("original","old-worker").unwrap().id};
        {let mut store=app.store.lock().unwrap();let input=serde_json::from_value(json!({"api":deck2_shared::API,"id":"current-lead-b","session":"original-b","mode":"session_v1","prompt":"Continue B","queue":true})).unwrap();let mut r=store.admit(&input).unwrap();r.phase=deck2_shared::Phase::Running;r.thread=Some(thread_b.into());r.turn=Some("turn-b".into());store.save(&mut r).unwrap();}
        let bridge_b=crate::session_mcp::Bridge::start(&app,"current-lead-b").await.unwrap();let bound_b=invoke(&bridge_b.config,"deck_delegate",&args,78).await;assert_eq!(bound_b["result"]["isError"],false,"{bound_b}");
        {let store=app.store.lock().unwrap();let task=store.logical_task("original-b","old-worker").unwrap();assert_ne!(task.id,internal_a);assert_eq!(task.number(0),3);assert_eq!(task.authority_root(&task.attempts[0]),"current-lead-b");assert_eq!(store.logical_task("original","old-worker").unwrap().id,internal_a);}
        let foreign_evidence=json!({"taskId":"old-worker","attempt":2,"commandId":"cross-session-original-integration","state":"integrated","note":"Try equal original seq and text digest","evidenceSeqs":read["evidenceSeqs"]});assert_eq!(invoke(&bridge_b.config,"deck_task_integrate",&foreign_evidence,89).await["result"]["isError"],true);
        assert_eq!(std::fs::read_to_string(bdir.join("000001.jsonl")).unwrap(),raw_b);
        let reopened=crate::Store::open(&f.path().join("execution.db"),project).unwrap();
        let task=reopened.logical_task("original","old-worker").unwrap();assert_eq!(task.attempts.len(),1);assert_eq!(task.number(0),3);let task_b=reopened.logical_task("original-b","old-worker").unwrap();assert_ne!(task_b.id,task.id);assert_eq!(task_b.attempts.len(),1);assert_eq!(task_b.number(0),3);

    }

    fn tests_fixture() -> tempfile::TempDir {
        use std::os::unix::fs::PermissionsExt;
        let f = tempfile::tempdir().unwrap();
        std::fs::set_permissions(f.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let d = f.path().join("sessions/original/events");
        std::fs::create_dir_all(&d).unwrap();
        for p in [
            f.path().join("sessions"),
            f.path().join("sessions/original"),
            d.clone(),
        ] {
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let p = f.path().join("sessions/original/session.json");
        std::fs::write(&p,json!({"v":1,"sessionId":"original","projectRoot":"/missing","createdAt":"2026-01-01Z","members":{"lead":{"runnerId":"unsupported","modelId":"old"}},"future":{"keep":true}}).to_string()).unwrap();
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600)).unwrap();
        f
    }
}

//! Recover historical native item boundaries from the existing event ledger once.
use deck2_shared::MessageTime;
use rusqlite::{Connection, Result, params};

pub(super) fn backfill(conn: &Connection) -> Result<()> {
    if conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM meta WHERE key='message_times_v1')",
        [],
        |r| r.get::<_, bool>(0),
    )? {
        return Ok(());
    }
    let mut candidates = conn.prepare("SELECT DISTINCT json_extract(body,'$.receiptId'),session,task,attempt FROM session_events WHERE kind>='notification:message:' AND kind<'notification:message;' AND json_extract(body,'$.displayStart') > 0 AND json_type(body,'$.receiptId')='text' AND session IS NOT NULL AND task IS NOT NULL AND attempt IS NOT NULL")?;
    let mut events = conn.prepare("SELECT kind,json_extract(body,'$.delta'),json_extract(body,'$.at_ms'),json_extract(body,'$.displayStart') FROM session_events WHERE session=?1 AND task=?2 AND attempt=?3 ORDER BY seq")?;
    for candidate in candidates.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })? {
        let (id, session, task, attempt) = candidate?;
        let mut rows = events.query(params![session, task, attempt])?;
        let mut text = String::new();
        let mut ends = Vec::new();
        let mut starts = Vec::new();
        let mut offset = 0;
        while let Some(row) = rows.next()? {
            let kind: String = row.get(0)?;
            if kind.starts_with("receipt:") {
                if let Some(delta) = row.get::<_, Option<String>>(1)?.filter(|d| !d.is_empty()) {
                    offset += delta.encode_utf16().count();
                    ends.push((offset, row.get::<_, Option<u64>>(2)?));
                    text.push_str(&delta);
                }
            } else if kind.starts_with("notification:message:")
                && let Some(start) = row.get::<_, Option<usize>>(3)?
            {
                starts.push(start);
            }
        }
        starts.sort_unstable();
        starts.dedup();
        let times: Vec<_> = starts
            .into_iter()
            .filter_map(|start| {
                ends.get(ends.partition_point(|(end, _)| *end <= start))
                    .and_then(|&(_, at_ms)| at_ms.map(|at_ms| MessageTime { start, at_ms, kind: None }))
            })
            .collect();
        if times.first().is_some_and(|t| t.start == 0) {
            conn.execute("UPDATE receipts SET body=json_set(body,'$.message_times',json(?1)) WHERE id=?2 AND json_extract(body,'$.text')=?3 AND json_extract(body,'$.message_times') IS NULL",params![serde_json::to_string(&times).expect("serializable message times"),id,text])?;
        }
    }
    conn.execute(
        "INSERT OR IGNORE INTO meta(key,value) VALUES('message_times_v1','1')",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reconstructs_historical_messages_only_from_matching_output() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE receipts(id TEXT PRIMARY KEY,body TEXT); CREATE TABLE session_events(seq INTEGER PRIMARY KEY,session TEXT,task TEXT,attempt TEXT,kind TEXT,body TEXT);").unwrap();
        for (id, text) in [
            ("complete", "🧭 first\n\nsecond"),
            ("incomplete", "missing delta"),
        ] {
            db.execute(
                "INSERT INTO receipts VALUES(?1,?2)",
                params![id, json!({"text":text}).to_string()],
            )
            .unwrap();
            for (kind, data) in [
                ("receipt:1", json!({"delta":"🧭","at_ms":1000})),
                ("receipt:2", json!({"delta":" first","at_ms":2000})),
                (
                    "notification:message:1",
                    json!({"receiptId":id,"displayStart":0}),
                ),
                ("receipt:3", json!({"delta":"\n\n","at_ms":4000})),
                ("receipt:4", json!({"delta":"second","at_ms":661000})),
                (
                    "notification:message:2",
                    json!({"receiptId":id,"displayStart":10}),
                ),
            ] {
                db.execute("INSERT INTO session_events(session,task,attempt,kind,body) VALUES('s','t',?1,?2,?3)",params![id,kind,data.to_string()]).unwrap();
            }
        }
        backfill(&db).unwrap();
        backfill(&db).unwrap();
        let times: String = db
            .query_row(
                "SELECT json_extract(body,'$.message_times') FROM receipts WHERE id='complete'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&times).unwrap(),
            json!([{"start":0,"at_ms":1000},{"start":10,"at_ms":661000}])
        );
        assert!(db.query_row("SELECT json_extract(body,'$.message_times') IS NULL FROM receipts WHERE id='incomplete'",[],|r|r.get::<_,bool>(0)).unwrap());
    }
}

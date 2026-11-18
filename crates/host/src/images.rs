//! Bounded private image storage. The Store mutex serializes upload, removal and
//! command admission. Receipt references pin bytes; staging is never auto-evicted.
use crate::Store;
use deck2_shared::ImageAttachment;
use rusqlite::{OptionalExtension, params};
use std::io::Cursor;
pub const MAX_IMAGE: usize = 5 * 1024 * 1024;

pub fn validate(bytes: &[u8]) -> Result<ImageAttachment, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE {
        return Err("Image must be between 1 byte and 5 MiB".into());
    }
    let format = image::guess_format(bytes).map_err(|_| "Unsupported image contents")?;
    let mime = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err("Only PNG, JPEG and WebP images are supported".into()),
    };
    let reader = || {
        let mut r = image::ImageReader::with_format(Cursor::new(bytes), format);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(16384);
        limits.max_image_height = Some(16384);
        limits.max_alloc = Some(192 * 1024 * 1024);
        r.limits(limits);
        r
    };
    let (width, height) = reader()
        .into_dimensions()
        .map_err(|_| "Invalid image dimensions")?;
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > 40_000_000
    {
        return Err("Image exceeds 16384 pixels per side or 40 megapixels".into());
    }
    // Decode sequentially with an allocation ceiling, not just a trusted header.
    reader()
        .decode()
        .map_err(|_| "Malformed or unsupported image data")?;
    Ok(ImageAttachment {
        id: uuid::Uuid::new_v4().to_string(),
        digest: crate::tasks::digest(bytes),
        mime: mime.into(),
        size: bytes.len() as u64,
        width,
        height,
    })
}
impl Store {
    pub(crate) fn init_images(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, session TEXT NOT NULL, upload TEXT NOT NULL, metadata TEXT NOT NULL, bytes BLOB NOT NULL, UNIQUE(session,upload)); CREATE TABLE IF NOT EXISTS image_cancellations (session TEXT NOT NULL, upload TEXT NOT NULL, PRIMARY KEY(session,upload));").map_err(|_|"Cannot initialize private image storage".into())
    }
    pub fn image(&self, session: &str, id: &str) -> Result<(ImageAttachment, Vec<u8>), String> {
        self.session_by_id(session)?;
        let (meta, bytes): (String, Vec<u8>) = self
            .conn
            .query_row(
                "SELECT metadata,bytes FROM images WHERE session=?1 AND id=?2",
                params![session, id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "Unknown image in this conversation")?;
        let a: ImageAttachment =
            serde_json::from_str(&meta).map_err(|_| "Invalid image metadata")?;
        if a.id != id || a.size != bytes.len() as u64 || a.digest != crate::tasks::digest(&bytes) {
            return Err("Stored image integrity failed".into());
        }
        Ok((a, bytes))
    }
    pub fn cancel_upload(&self, session: &str, upload: &str) -> Result<(), String> {
        self.session_by_id(session)?;
        if !(8..=80).contains(&upload.len())
            || !upload
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Invalid upload identity".into());
        }
        // A repeated cancellation acknowledges an already durable removal even
        // when the bounded cancellation ledger has reached capacity.
        let cancelled: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM image_cancellations WHERE session=?1 AND upload=?2)",
                params![session, upload],
                |r| r.get(0),
            )
            .map_err(|_| "Cannot inspect removed upload")?;
        if cancelled {
            return Ok(());
        }
        let count: i64 = self
            .conn
            .query_row(
                "SELECT count(*) FROM image_cancellations WHERE session=?1",
                [session],
                |r| r.get(0),
            )
            .map_err(|_| "Cannot inspect upload history")?;
        if count >= 4096 {
            return Err(
                "Upload history is full; keep this draft or remove the settled conversation".into(),
            );
        }
        if let Ok(a) = self.uploaded_image(session, upload) {
            self.remove_image(session, &a.id)?;
        }
        self.conn
            .execute(
                "INSERT OR IGNORE INTO image_cancellations VALUES (?1,?2)",
                params![session, upload],
            )
            .map_err(|_| "Cannot record removed upload")?;
        Ok(())
    }
    pub fn uploaded_image(&self, session: &str, upload: &str) -> Result<ImageAttachment, String> {
        let id: String = self
            .conn
            .query_row(
                "SELECT id FROM images WHERE session=?1 AND upload=?2",
                params![session, upload],
                |r| r.get(0),
            )
            .map_err(|_| "Upload has not been acknowledged")?;
        self.image(session, &id).map(|v| v.0)
    }
    pub fn command_images(
        &self,
        session: &str,
        ids: &[String],
    ) -> Result<Vec<ImageAttachment>, String> {
        if ids.len() > 8 || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
        {
            return Err("Use up to 8 distinct images per message".into());
        }
        let mut total = 0;
        let mut images = Vec::new();
        for id in ids {
            let (a, _) = self.image(session, id)?;
            total += a.size;
            if total > 20 * 1024 * 1024 {
                return Err("Images exceed 20 MiB per message".into());
            }
            images.push(a);
        }
        Ok(images)
    }
    pub fn upload_image(
        &self,
        session: &str,
        upload: &str,
        metadata: ImageAttachment,
        bytes: &[u8],
    ) -> Result<ImageAttachment, String> {
        self.session_by_id(session)?;
        if !(8..=80).contains(&upload.len())
            || !upload
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Invalid upload retry identity".into());
        }
        let cancelled: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM image_cancellations WHERE session=?1 AND upload=?2)",
                params![session, upload],
                |r| r.get(0),
            )
            .map_err(|_| "Cannot inspect removed upload")?;
        if cancelled {
            return Err("This upload was removed; select the image again".into());
        }
        // Cancellations retain tiny retry identities to reject late body completions.
        let count: i64 = self
            .conn
            .query_row(
                "SELECT count(*) FROM image_cancellations WHERE session=?1",
                [session],
                |r| r.get(0),
            )
            .map_err(|_| "Cannot inspect upload history")?;
        if count >= 4096 {
            return Err(
                "Upload history is full; create a new conversation for further images".into(),
            );
        }
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM images WHERE session=?1 AND upload=?2",
                params![session, upload],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Cannot inspect upload")?;
        if let Some(id) = existing {
            let (a, _) = self.image(session, &id)?;
            return if a.digest == metadata.digest {
                Ok(a)
            } else {
                Err("Upload identity conflicts with previous image".into())
            };
        }
        let pinned: std::collections::HashSet<_> = self
            .all()?
            .into_iter()
            .flat_map(|r| r.attachments.into_iter().map(|a| a.id))
            .collect();
        let mut stmt = self
            .conn
            .prepare("SELECT id,length(bytes) FROM images")
            .map_err(|_| "Cannot inspect staged images")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))
            })
            .map_err(|_| "Cannot inspect staging")?;
        let (mut count, mut size) = (0, bytes.len() as u64);
        for row in rows {
            let (id, n) = row.map_err(|_| "Cannot inspect staging")?;
            if !pinned.contains(&id) {
                count += 1;
                size += n;
            }
        }
        if count >= 128 || size > 128 * 1024 * 1024 {
            return Err(
                "Image staging is full; remove unused drafts before uploading more images".into(),
            );
        }
        self.conn
            .execute(
                "INSERT INTO images VALUES (?1,?2,?3,?4,?5)",
                params![
                    metadata.id,
                    session,
                    upload,
                    serde_json::to_string(&metadata).map_err(|_| "Cannot encode image")?,
                    bytes
                ],
            )
            .map_err(|_| "Cannot persist image")?;
        Ok(metadata)
    }
    pub fn remove_image(&self, session: &str, id: &str) -> Result<(), String> {
        self.image(session, id)?;
        if self
            .all()?
            .iter()
            .any(|r| r.attachments.iter().any(|a| a.id == id))
        {
            return Err("Admitted image references are retained".into());
        }
        self.conn
            .execute(
                "DELETE FROM images WHERE session=?1 AND id=?2",
                params![session, id],
            )
            .map_err(|_| "Cannot remove staged image")?;
        Ok(())
    }
    /// Paths exist only during the owning native attempt; the directory is private.
    pub fn native_images(
        &self,
        r: &deck2_shared::Receipt,
    ) -> Result<(tempfile::TempDir, Vec<serde_json::Value>), String> {
        let dir = tempfile::Builder::new()
            .prefix("deck2-images-")
            .tempdir()
            .map_err(|_| "Cannot prepare private images")?;
        let mut parts = Vec::new();
        for (i, expected) in r.attachments.iter().enumerate() {
            let (a, bytes) = self.image(&r.session, &expected.id)?;
            if &a != expected {
                return Err("Admitted image integrity changed".into());
            }
            let ext = match a.mime.as_str() {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                "image/webp" => "webp",
                _ => return Err("Invalid stored image format".into()),
            };
            let path = dir.path().join(format!("{i}.{ext}"));
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .map_err(|_| "Cannot prepare private image")?;
            file.write_all(&bytes)
                .map_err(|_| "Cannot prepare private image")?;
            parts.push(serde_json::json!({"type":"localImage","path":path}));
        }
        Ok((dir, parts))
    }
}

pub(crate) fn inspect(conn: &rusqlite::Connection) -> Result<(), String> {
    let invalid = "Invalid private image state; preserve it for inspection";
    let mut stmt = conn
        .prepare("SELECT id,session,upload,metadata,length(bytes) FROM images")
        .map_err(|_| invalid)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .map_err(|_| invalid)?;
    conn.prepare("SELECT session,upload FROM image_cancellations")
        .map_err(|_| invalid)?;
    let mut identities = std::collections::HashMap::new();
    for row in rows {
        let (id, session, upload, metadata, len) = row.map_err(|_| invalid)?;
        let a: ImageAttachment = serde_json::from_str(&metadata).map_err(|_| invalid)?;
        if a.id != id
            || uuid::Uuid::parse_str(&id).is_err()
            || upload.len() > 80
            || a.digest.len() != 64
            || !a.digest.bytes().all(|b| b.is_ascii_hexdigit())
            || !matches!(a.mime.as_str(), "image/png" | "image/jpeg" | "image/webp")
            || len <= 0
            || len as usize > MAX_IMAGE
            || a.size != len as u64
            || a.width == 0
            || a.height == 0
            || a.width > 16384
            || a.height > 16384
            || u64::from(a.width) * u64::from(a.height) > 40_000_000
        {
            return Err(invalid.into());
        }
        conn.query_row("SELECT id FROM sessions WHERE id=?1", [&session], |r| {
            r.get::<_, String>(0)
        })
        .map_err(|_| invalid)?;
        identities.insert(id, (session, a));
    }
    let mut stmt = conn
        .prepare("SELECT body FROM receipts")
        .map_err(|_| invalid)?;
    for body in stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| invalid)?
    {
        let r: deck2_shared::Receipt =
            serde_json::from_str(&body.map_err(|_| invalid)?).map_err(|_| invalid)?;
        if r.attachments.len() > 8
            || r.attachments.iter().map(|a| a.size).sum::<u64>() > 20 * 1024 * 1024
            || r.attachments
                .iter()
                .map(|a| &a.id)
                .collect::<std::collections::HashSet<_>>()
                .len()
                != r.attachments.len()
        {
            return Err(invalid.into());
        }
        for a in &r.attachments {
            if identities.get(&a.id) != Some(&(r.session.clone(), a.clone())) {
                return Err(invalid.into());
            }
        }
    }
    Ok(())
}

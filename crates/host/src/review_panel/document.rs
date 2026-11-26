use super::*;
use catalog::{Blob, Kind, Row, WorkEntry};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::io::Read;

const DISPLAY: usize = 1024 * 1024;
const LONGEST_LINE: usize = 64 * 1024;
const MAX_LINES: usize = 100_000;
const STATS_BYTES: usize = 8 * DISPLAY;
const STATS_STEPS: usize = 2_000_000;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Side {
    Absent,
    Text {
        text: String,
        bytes: usize,
        mode: String,
    },
    Binary {
        bytes: usize,
        mode: String,
    },
    Encoding {
        bytes: usize,
        mode: String,
    },
    TooLarge {
        bytes: usize,
        mode: String,
    },
    Symlink {
        bytes: usize,
        mode: String,
    },
    Gitlink {
        bytes: Option<usize>,
        mode: String,
    },
    Special {
        bytes: Option<usize>,
        mode: String,
    },
    Unavailable {
        bytes: Option<usize>,
        mode: Option<String>,
    },
}

impl Side {
    fn content(bytes: Vec<u8>, mode: String) -> Self {
        let len = bytes.len();
        if bytes.contains(&0) {
            return Self::Binary { bytes: len, mode };
        }
        match String::from_utf8(bytes) {
            Ok(text) => {
                let lines = text.split_inclusive('\n');
                if lines.clone().count() > MAX_LINES
                    || lines.into_iter().any(|line| line.len() > LONGEST_LINE)
                {
                    Self::TooLarge { bytes: len, mode }
                } else {
                    Self::Text {
                        text,
                        bytes: len,
                        mode,
                    }
                }
            }
            Err(_) => Self::Encoding { bytes: len, mode },
        }
    }

    fn lines(&self) -> std::result::Result<Vec<&str>, &'static str> {
        match self {
            Self::Absent => Ok(Vec::new()),
            Self::Text { text, .. } => Ok(text.split_inclusive('\n').collect()),
            Self::Binary { .. } => Err("binary"),
            Self::Encoding { .. } => Err("encoding"),
            Self::TooLarge { .. } => Err("tooLarge"),
            Self::Symlink { .. }
            | Self::Gitlink { .. }
            | Self::Special { .. }
            | Self::Unavailable { .. } => Err("special"),
        }
    }
}

struct Pair {
    before: Option<Side>,
    after: Side,
    version: String,
}

pub(super) fn file(
    observation: &Observation<'_>,
    catalog: &Catalog,
    row: &Row,
    current: Option<&WorkEntry>,
    known: Option<&str>,
) -> Result<Value> {
    let pair = read_pair(
        observation,
        row,
        current,
        catalog.view != View::All,
        &mut (2 * DISPLAY),
    )?;
    if known == Some(&pair.version) {
        return Ok(json!({
            "kind": "unchanged", "id": row.entry.id(), "generation": catalog.generation, "version": pair.version
        }));
    }
    Ok(json!({
        "kind": "document", "id": row.entry.id(), "generation": catalog.generation, "version": pair.version,
        "entry": row.entry, "before": pair.before, "after": pair.after
    }))
}

pub(super) fn stats(
    observation: &Observation<'_>,
    catalog: &Catalog,
    rows: &[&Row],
    current: &[Option<WorkEntry>],
) -> Result<Value> {
    let mut bytes = STATS_BYTES;
    let mut steps = STATS_STEPS;
    let mut seen = HashMap::new();
    let mut items = Vec::with_capacity(rows.len());
    for (row, current) in rows.iter().zip(current) {
        let id = row.entry.id();
        if !seen.contains_key(id) {
            let stat = match () {
                _ if row.entry.conflicted() => unavailable("conflict"),
                _ if observation.check_budget().is_err() => unavailable("budget"),
                _ => match read_pair(observation, row, current.as_ref(), true, &mut bytes) {
                    Ok(pair) => {
                        line_stat(pair.before.as_ref().ok_or(STALE)?, &pair.after, &mut steps)
                    }
                    Err(error) if error.code == LIMIT.code => unavailable("budget"),
                    Err(error) => return Err(error),
                },
            };
            seen.insert(id, stat);
        }
        let stat = &seen[id];
        items.push(json!({"id": id, "stat": stat}));
    }
    Ok(json!({"generation": catalog.generation, "items": items}))
}

fn unavailable(reason: &str) -> Value {
    json!({ "kind": "unavailable", "reason": reason })
}

fn line_stat(before: &Side, after: &Side, steps: &mut usize) -> Value {
    let old = match before.lines() {
        Ok(lines) => lines,
        Err(reason) => return unavailable(reason),
    };
    let new = match after.lines() {
        Ok(lines) => lines,
        Err(reason) => return unavailable(reason),
    };
    match line_diff(&old, &new, steps) {
        Some((added, deleted)) => json!({"kind": "lines", "added": added, "deleted": deleted}),
        None => unavailable("budget"),
    }
}

// Bounded Myers edit distance. Interning lines makes frontier comparisons
// constant time even for files with many repetitions of one very long line.
fn line_diff(old: &[&str], new: &[&str], steps: &mut usize) -> Option<(usize, usize)> {
    let prefix = old.iter().zip(new).take_while(|(a, b)| a == b).count();
    let (old, new) = (&old[prefix..], &new[prefix..]);
    let suffix = old
        .iter()
        .rev()
        .zip(new.iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let (old, new) = (&old[..old.len() - suffix], &new[..new.len() - suffix]);
    if old.is_empty() || new.is_empty() {
        return Some((new.len(), old.len()));
    }
    let mut interned = HashMap::new();
    let indexed: Vec<_> = old
        .iter()
        .chain(new)
        .map(|line| {
            let index = interned.len();
            *interned.entry(*line).or_insert(index)
        })
        .collect();
    let (old, new) = indexed.split_at(old.len());
    let n = old.len() as isize;
    let m = new.len() as isize;
    let max = n + m;
    let mut furthest = vec![0isize; max as usize * 2 + 3];
    let at = |diagonal: isize| (max + 1 + diagonal) as usize;
    for edits in 0..=max {
        for k in (-edits..=edits).step_by(2) {
            *steps = steps.checked_sub(1)?;
            let mut x = if k == -edits || (k != edits && furthest[at(k - 1)] < furthest[at(k + 1)])
            {
                furthest[at(k + 1)]
            } else {
                furthest[at(k - 1)] + 1
            };
            let mut y = x - k;
            while x < n && y < m && old[x as usize] == new[y as usize] {
                *steps = steps.checked_sub(1)?;
                x += 1;
                y += 1;
            }
            furthest[at(k)] = x;
            if x >= n && y >= m {
                return Some((
                    ((edits + m - n) / 2) as usize,
                    ((edits + n - m) / 2) as usize,
                ));
            }
        }
    }
    None
}

fn read_pair(
    observation: &Observation<'_>,
    row: &Row,
    current: Option<&WorkEntry>,
    include_before: bool,
    budget: &mut usize,
) -> Result<Pair> {
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(&row.entry.version_metadata()).map_err(|_| UNSUPPORTED)?);
    let before = if include_before {
        Some(base_side(
            observation,
            row.before.as_ref(),
            &mut hash,
            budget,
        )?)
    } else {
        None
    };
    let after = work_side(observation, &row.path, current, &mut hash, budget)?;
    hash.update(serde_json::to_vec(&(&before, &after)).map_err(|_| UNSUPPORTED)?);
    Ok(Pair {
        before,
        after,
        version: format!("{:x}", hash.finalize()),
    })
}

fn base_side(
    observation: &Observation<'_>,
    blob: Option<&Blob>,
    hash: &mut Sha256,
    budget: &mut usize,
) -> Result<Side> {
    let Some(blob) = blob else {
        return Ok(Side::Absent);
    };
    let mode = blob.mode.clone();
    hash.update(blob.oid.as_bytes());
    if blob.kind() == Kind::Gitlink {
        return Ok(Side::Gitlink { bytes: None, mode });
    }
    let size = match observation.blob_size(blob) {
        Ok(size) => size,
        Err(error) if error.code == UNSUPPORTED.code => {
            return Ok(Side::Unavailable {
                bytes: None,
                mode: Some(mode),
            });
        }
        Err(error) => return Err(error),
    };
    if blob.kind() == Kind::Symlink {
        return Ok(Side::Symlink { bytes: size, mode });
    }
    if size > DISPLAY {
        return Ok(Side::TooLarge { bytes: size, mode });
    }
    *budget = budget.checked_sub(size).ok_or(LIMIT)?;
    let bytes = observation.blob_bytes(blob, size)?;
    Ok(Side::content(bytes, mode))
}

fn work_side(
    observation: &Observation<'_>,
    path: &[u8],
    current: Option<&WorkEntry>,
    hash: &mut Sha256,
    budget: &mut usize,
) -> Result<Side> {
    let Some(current) = current else {
        catalog::verify_absent(observation.root(), path)?;
        return Ok(Side::Absent);
    };
    let mode = current.mode.clone();
    let size = usize::try_from(current.meta.len()).map_err(|_| LIMIT)?;
    let root = observation.root();
    let side = match current.kind {
        Kind::Gitlink => {
            if let Some(oid) = &current.gitlink {
                hash.update(oid.as_bytes());
            }
            Side::Gitlink { bytes: None, mode }
        }
        Kind::Special | Kind::Directory => Side::Special { bytes: None, mode },
        Kind::Symlink => {
            let target = current.link_target(root, path)?;
            hash.update(&target);
            Side::Symlink {
                bytes: target.len(),
                mode,
            }
        }
        Kind::File => {
            let file = match current.regular(root, path) {
                Ok(file) => Some(file),
                Err(error) if error.code == UNSUPPORTED.code => None,
                Err(error) => return Err(error),
            };
            if let Some(file) = file {
                let size_to_read = size.min(DISPLAY);
                *budget = budget.checked_sub(size_to_read).ok_or(LIMIT)?;
                let mut bytes = Vec::new();
                file.take(size_to_read as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|_| UNSUPPORTED)?;
                if bytes.len() != size_to_read {
                    return Err(STALE);
                }
                hash.update(&bytes);
                if size > DISPLAY {
                    // Keep oversized reads capped. Include inode and write
                    // timestamps so an edit beyond the displayed prefix invalidates it.
                    hash.update(current.change_stamp());
                    Side::TooLarge { bytes: size, mode }
                } else {
                    Side::content(bytes, mode)
                }
            } else {
                Side::Unavailable {
                    bytes: Some(size),
                    mode: Some(mode),
                }
            }
        }
    };
    current.check(root, path)?;
    Ok(side)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_line_counts_handle_repeated_lines_empty_sides_and_exhausted_budget() {
        assert_eq!(
            line_diff(&["a", "b", "a", "c"], &["a", "a", "b", "c"], &mut 100),
            Some((1, 1))
        );
        assert_eq!(line_diff(&[], &["\n"], &mut 100), Some((1, 0)));
        assert_eq!(line_diff(&["a"], &["b"], &mut 1), None);
        assert_eq!(
            line_stat(
                &Side::Text {
                    text: "a\n".into(),
                    bytes: 2,
                    mode: "100644".into()
                },
                &Side::Text {
                    text: "a".into(),
                    bytes: 1,
                    mode: "100644".into()
                },
                &mut 100,
            ),
            json!({"kind": "lines", "added": 1, "deleted": 1})
        );
    }
}

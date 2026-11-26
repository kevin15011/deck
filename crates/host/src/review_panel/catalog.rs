use super::*;
use crate::git_review::ConfinedGit;
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::{CString, OsStr},
    fs::Metadata,
    io::{self, Read},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::ffi::OsStrExt,
    },
};

const MAX_NAMES: usize = 16 * 1024 * 1024;
const MAX_ROWS: usize = 100_000;
const GIT_OUTPUT: usize = MAX_NAMES + 12 * 1024 * 1024;
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const RENAME_LIMIT: usize = 256;
const RENAME_BYTES: usize = 16 * 1024 * 1024;
const RECONCILE_BYTES: usize = 64 * 1024 * 1024;

type RawPath = Vec<u8>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Kind {
    File,
    Directory,
    Symlink,
    Gitlink,
    Special,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(super) enum Status {
    M,
    A,
    D,
    U,
    R,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Detail {
    Untracked,
    Conflict,
    Mode,
    Type,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Entry {
    id: String,
    path: String,
    old_path: Option<String>,
    pub kind: Kind,
    pub status: Option<Status>,
    detail: Option<Detail>,
}

impl Entry {
    pub(super) fn id(&self) -> &str {
        &self.id
    }

    pub(super) fn version_metadata(&self) -> impl Serialize {
        (
            &self.path,
            &self.old_path,
            self.kind,
            self.status,
            self.detail,
        )
    }

    pub(super) fn conflicted(&self) -> bool {
        self.detail == Some(Detail::Conflict)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum BaseKind {
    Head,
    Empty,
    MergeBase,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
struct Base {
    kind: BaseKind,
    oid: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum OriginSource {
    Symbolic,
    Fallback,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
struct Origin {
    #[serde(rename = "ref")]
    reference: String,
    oid: String,
    source: OriginSource,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
struct Comparison {
    head: Option<String>,
    base: Option<Base>,
    origin: Option<Origin>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Blob {
    pub mode: String,
    pub oid: String,
}

impl Blob {
    fn new(mode: &str, oid: &str) -> Result<Self> {
        if !matches!(mode, "100644" | "100755" | "120000" | "160000") || !valid_oid(oid) {
            return Err(UNSUPPORTED);
        }
        Ok(Self {
            mode: mode.into(),
            oid: oid.into(),
        })
    }

    pub(super) fn kind(&self) -> Kind {
        match self.mode.as_str() {
            "120000" => Kind::Symlink,
            "160000" => Kind::Gitlink,
            _ => Kind::File,
        }
    }
}

#[derive(Default)]
struct IndexEntry {
    stage: Option<Blob>,
    conflict: bool,
    gitlink: bool,
    bypasses_worktree: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Change {
    status: Status,
    detail: Option<Detail>,
    old_path: Option<RawPath>,
    old: Option<Blob>,
    new_kind: Option<Kind>,
}

pub(super) struct Row {
    pub entry: Entry,
    pub path: RawPath,
    pub before: Option<Blob>,
    old_path: Option<RawPath>,
}

pub(super) struct Catalog {
    pub view: View,
    pub generation: String,
    pub created: Instant,
    pub bytes: usize,
    comparison: Comparison,
    cursor_key: uuid::Uuid,
    rows: Vec<Row>,
    ids: HashMap<String, usize>,
}

impl Catalog {
    pub(super) fn entry(&self, id: &str) -> Result<&Row> {
        self.ids.get(id).map(|i| &self.rows[*i]).ok_or(ENTRY)
    }

    fn cursor(&self, offset: usize, filter: &str) -> String {
        let digest =
            crate::tasks::digest(format!("{}\0{offset}\0{filter}", self.cursor_key).as_bytes());
        format!("{offset}.{digest}")
    }

    pub(super) fn page(&self, limit: usize, cursor: Option<&str>, filter: &str) -> Result<Value> {
        let offset = match cursor {
            Some(cursor) => {
                let (value, _) = cursor.split_once('.').ok_or(STALE)?;
                let offset = value.parse().map_err(|_| STALE)?;
                if self.cursor(offset, filter) != cursor {
                    return Err(STALE);
                }
                offset
            }
            None => 0,
        };
        let (matched, entries) = if filter.is_empty() {
            let entries = self
                .rows
                .iter()
                .skip(offset)
                .take(limit)
                .map(|row| &row.entry)
                .collect::<Vec<_>>();
            (self.rows.len(), entries)
        } else {
            let needle = filter.to_lowercase();
            let mut matched = 0;
            let mut entries = Vec::new();
            for row in &self.rows {
                if row.entry.path.to_lowercase().contains(&needle) {
                    if matched >= offset && entries.len() < limit {
                        entries.push(&row.entry);
                    }
                    matched += 1;
                }
            }
            (matched, entries)
        };
        if offset > matched {
            return Err(STALE);
        }
        let next = offset + entries.len();
        let next_cursor = (limit > 0 && next < matched).then(|| self.cursor(next, filter));
        Ok(serde_json::json!({
            "view": self.view,
            "generation": self.generation,
            "head": self.comparison.head,
            "base": self.comparison.base,
            "origin": self.comparison.origin,
            "total": self.rows.len(),
            "matched": matched,
            "nextCursor": next_cursor,
            "entries": entries,
        }))
    }
}

pub(super) struct Observation<'a> {
    root: &'a File,
    git: ConfinedGit,
    deadline: Instant,
    view: View,
    repository: bool,
    comparison: Comparison,
}

impl<'a> Observation<'a> {
    pub(super) fn open(
        project: &ProjectBinding,
        root: &'a File,
        permit: Arc<tokio::sync::OwnedSemaphorePermit>,
        deadline: Instant,
        view: View,
    ) -> Result<Self> {
        let repository = !git_review::is_missing(root, FsPath::new(".git"));
        if !repository && view != View::All {
            return Err(NO_REPOSITORY);
        }
        let git = ConfinedGit::prepare(
            FsPath::new(&project.root),
            root.try_clone().map_err(|_| PROJECT)?,
            permit,
            deadline,
        )
        .map_err(Error::git)?;
        let mut observation = Self {
            root,
            git,
            deadline,
            view,
            repository,
            comparison: Comparison {
                head: None,
                base: None,
                origin: None,
            },
        };
        observation.comparison = observation.baseline()?;
        Ok(observation)
    }

    pub(super) fn verify_metadata(&self) -> Result<()> {
        self.git
            .verify_review_metadata(
                self.comparison
                    .origin
                    .as_ref()
                    .map(|origin| origin.reference.as_str()),
            )
            .map_err(|_| STALE)
    }

    pub(super) fn root(&self) -> &File {
        self.root
    }

    pub(super) fn check_budget(&self) -> Result<()> {
        if Instant::now() > self.deadline {
            return Err(LIMIT);
        }
        Ok(())
    }

    fn raw_git(
        &self,
        command: &[&str],
        paths: &[&[u8]],
        input: Option<&[u8]>,
        limit: usize,
    ) -> Result<(Vec<u8>, std::process::ExitStatus)> {
        let mut args: Vec<_> = command.iter().map(OsStr::new).collect();
        if !paths.is_empty() {
            args.push(OsStr::new("--"));
            args.extend(paths.iter().map(|path| OsStr::from_bytes(path)));
        }
        self.git
            .run(&args, input, self.deadline, limit, &|| Ok(()))
            .map_err(Error::git)
    }

    fn git(&self, command: &[&str], paths: &[&[u8]], limit: usize) -> Result<Vec<u8>> {
        let (bytes, status) = self.raw_git(command, paths, None, limit)?;
        status.success().then_some(bytes).ok_or(UNSUPPORTED)
    }

    fn resolve_oid(&self, reference: &str) -> Result<Option<String>> {
        let (bytes, status) = self.raw_git(
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                "--end-of-options",
                reference,
            ],
            &[],
            None,
            128,
        )?;
        match status.code() {
            Some(0) => Ok(Some(parse_oid(&bytes)?)),
            Some(1) => Ok(None),
            _ => Err(UNSUPPORTED),
        }
    }

    fn symbolic_ref(&self, reference: &str) -> Result<Option<String>> {
        let (bytes, status) =
            self.raw_git(&["symbolic-ref", "--quiet", reference], &[], None, 4096)?;
        match status.code() {
            Some(0) => {
                let bytes = bytes.strip_suffix(b"\n").ok_or(UNSUPPORTED)?;
                let reference = std::str::from_utf8(bytes).map_err(|_| UNSUPPORTED)?;
                Ok(Some(reference.into()))
            }
            Some(1) => Ok(None),
            _ => Err(UNSUPPORTED),
        }
    }

    fn baseline(&self) -> Result<Comparison> {
        if !self.repository {
            return Ok(Comparison {
                head: None,
                base: None,
                origin: None,
            });
        }
        let head = self.resolve_oid("HEAD")?;
        if head.is_none() && self.symbolic_ref("HEAD")?.is_none() {
            return Err(UNSUPPORTED);
        }
        if head.is_some() && self.resolve_oid("HEAD^{commit}")? != head {
            return Err(UNSUPPORTED);
        }
        let (base, origin) = if self.view == View::Diff {
            let head = head.as_deref().ok_or(NO_HEAD)?;
            let origin = self.origin()?;
            let (bytes, status) = self.raw_git(
                &["merge-base", "--all", &origin.oid, head],
                &[],
                None,
                64 * 1024,
            )?;
            if status.code() == Some(1) || !status.success() && self.git.is_shallow() {
                return Err(NO_MERGE_BASE);
            }
            if !status.success() {
                return Err(UNSUPPORTED);
            }
            let mut bases = bytes
                .strip_suffix(b"\n")
                .unwrap_or(&bytes)
                .split(|byte| *byte == b'\n');
            let oid = parse_oid(bases.next().ok_or(NO_MERGE_BASE)?)?;
            if bases.next().is_some() {
                return Err(AMBIGUOUS);
            }
            (
                Base {
                    kind: BaseKind::MergeBase,
                    oid: Some(oid),
                },
                Some(origin),
            )
        } else {
            (
                Base {
                    kind: if head.is_some() {
                        BaseKind::Head
                    } else {
                        BaseKind::Empty
                    },
                    oid: head.clone(),
                },
                None,
            )
        };
        Ok(Comparison {
            head,
            base: Some(base),
            origin,
        })
    }

    fn origin(&self) -> Result<Origin> {
        if let Some(reference) = self.symbolic_ref("refs/remotes/origin/HEAD")?
            && reference.starts_with("refs/remotes/origin/")
            && reference != "refs/remotes/origin/HEAD"
            && let Some(oid) = self.resolve_oid(&format!("{reference}^{{commit}}"))?
        {
            return Ok(Origin {
                reference,
                oid,
                source: OriginSource::Symbolic,
            });
        }
        for reference in ["refs/remotes/origin/main", "refs/remotes/origin/master"] {
            if let Some(oid) = self.resolve_oid(&format!("{reference}^{{commit}}"))? {
                return Ok(Origin {
                    reference: reference.into(),
                    oid,
                    source: OriginSource::Fallback,
                });
            }
        }
        Err(NO_ORIGIN)
    }

    fn index(&self, paths: &[&[u8]]) -> Result<BTreeMap<RawPath, IndexEntry>> {
        let mut index: BTreeMap<RawPath, IndexEntry> = BTreeMap::new();
        let bytes = self.git(&["ls-files", "--stage", "-v", "-z"], paths, GIT_OUTPUT)?;
        let mut names = 0;
        for row in records(&bytes)? {
            let tab = row
                .iter()
                .position(|byte| *byte == b'\t')
                .ok_or(UNSUPPORTED)?;
            let path = &row[tab + 1..];
            validate_path(path)?;
            let (flag, mode, oid, stage) = match ascii_line(&row[..tab])?
                .split(' ')
                .collect::<Vec<_>>()
                .as_slice()
            {
                [flag, mode, oid, stage] => (*flag, *mode, *oid, *stage),
                _ => return Err(UNSUPPORTED),
            };
            let blob = Blob::new(mode, oid)?;
            let entry = index.entry(path.to_vec()).or_default();
            entry.gitlink |= blob.kind() == Kind::Gitlink;
            entry.bypasses_worktree |=
                flag == "S" || flag.as_bytes().first().is_some_and(u8::is_ascii_lowercase);
            match stage {
                "0" => entry.stage = Some(blob),
                "1" | "2" | "3" => entry.conflict = true,
                _ => return Err(UNSUPPORTED),
            }
            names += path.len();
            if index.len() > MAX_ROWS || names > MAX_NAMES {
                return Err(LIMIT);
            }
        }
        Ok(index)
    }

    fn others(&self, paths: &[&[u8]]) -> Result<BTreeSet<RawPath>> {
        let bytes = self.git(
            &["ls-files", "--others", "--exclude-standard", "-z"],
            paths,
            MAX_NAMES,
        )?;
        let mut others = BTreeSet::new();
        for raw in records(&bytes)? {
            // Git reports embedded repositories as one opaque directory.
            let path = raw.strip_suffix(b"/").unwrap_or(raw);
            validate_path(path)?;
            others.insert(path.to_vec());
            if others.len() > MAX_ROWS {
                return Err(LIMIT);
            }
        }
        Ok(others)
    }

    fn base_tree(&self, paths: &[&[u8]]) -> Result<BTreeMap<RawPath, Blob>> {
        let Some(base) = self
            .comparison
            .base
            .as_ref()
            .and_then(|base| base.oid.as_deref())
        else {
            return Ok(BTreeMap::new());
        };
        let bytes = self.git(&["ls-tree", "-r", "-z", base], paths, GIT_OUTPUT)?;
        let mut tree = BTreeMap::new();
        let mut names = 0;
        for row in records(&bytes)? {
            let tab = row
                .iter()
                .position(|byte| *byte == b'\t')
                .ok_or(UNSUPPORTED)?;
            let path = &row[tab + 1..];
            validate_path(path)?;
            let blob = match ascii_line(&row[..tab])?
                .split(' ')
                .collect::<Vec<_>>()
                .as_slice()
            {
                [mode, "blob" | "commit", oid] => Blob::new(mode, oid)?,
                _ => return Err(UNSUPPORTED),
            };
            tree.insert(path.to_vec(), blob);
            names += path.len();
            if tree.len() > MAX_ROWS || names > MAX_NAMES {
                return Err(LIMIT);
            }
        }
        Ok(tree)
    }

    fn changes(&self, scan: &Inventory, paths: &[&[u8]]) -> Result<Delta> {
        if !self.repository {
            return Ok(Delta::default());
        }
        let base = self
            .comparison
            .base
            .as_ref()
            .and_then(|base| base.oid.as_deref())
            .unwrap_or(EMPTY_TREE);
        let mut args = vec![
            "diff",
            "--raw",
            "-z",
            "--abbrev=40",
            "--no-ext-diff",
            "--no-textconv",
            "--ignore-submodules=all",
            "--find-renames=50%",
            "-l256",
            base,
        ];
        // End revision parsing even when the command compares the whole repository.
        if paths.is_empty() {
            args.push("--");
        }
        let bytes = self.git(&args, paths, GIT_OUTPUT)?;
        let mut changes = parse_diff(&bytes)?;
        let mut budget = RECONCILE_BYTES;
        let mut restored = BTreeSet::new();

        let tree = self.base_tree(paths)?;
        let mut recreated_sources = Vec::new();
        for (destination, row) in &changes {
            let Some(source) = &row.old_path else {
                continue;
            };
            if self
                .work_entry(source, scan.index.get(source))?
                .is_some_and(|entry| entry.kind != Kind::Directory)
            {
                recreated_sources.push((source.clone(), destination.clone(), row.old.clone()));
            }
        }
        for (source, destination, old) in recreated_sources {
            let target = changes.get_mut(&destination).ok_or(STALE)?;
            target.status = Status::A;
            target.old = None;
            target.old_path = None;
            target.detail = None;
            changes.entry(source).or_insert(Change {
                status: Status::D,
                detail: None,
                old_path: None,
                old,
                new_kind: None,
            });
        }

        // A staged deletion and an untracked recreation share one worktree path.
        // Compare that entry directly to the base, including executable and link mode.
        for (path, row) in &mut changes {
            if !matches!(row.status, Status::D | Status::M) {
                continue;
            }
            let Some(old) = row.old.as_ref() else {
                continue;
            };
            let Some(current) = self.work_entry(path, scan.index.get(path))? else {
                continue;
            };
            let kind = current.kind;
            if kind == Kind::Directory {
                continue;
            }
            if row.status == Status::D {
                if current.mode == old.mode
                    && self.hash_work(path, &current, &mut budget)? == Some(old.oid.clone())
                {
                    restored.insert(path.clone());
                    continue;
                }
                row.status = Status::M;
                row.new_kind = Some(kind);
            }
            if old.kind() != kind {
                row.detail = Some(Detail::Type);
            } else if current.mode != old.mode
                && self.hash_work(path, &current, &mut budget)?.as_deref() == Some(&old.oid)
            {
                row.detail = Some(Detail::Mode);
            }
        }
        for (path, index) in &scan.index {
            if !index.bypasses_worktree || index.gitlink || index.conflict {
                continue;
            }
            let old = tree.get(path);
            let current = self
                .work_entry(path, Some(index))?
                .filter(|entry| entry.kind != Kind::Directory);
            let (status, detail) = match (old, current.as_ref()) {
                (None, None) => (None, None),
                (None, Some(_)) => (Some(Status::A), None),
                (Some(_), None) => (Some(Status::D), None),
                (Some(old), Some(current)) if old.kind() != current.kind => {
                    (Some(Status::M), Some(Detail::Type))
                }
                (Some(old), Some(current)) => {
                    let matches = self.hash_work(path, current, &mut budget)?.as_deref()
                        == Some(old.oid.as_str());
                    match (matches, old.mode == current.mode) {
                        (true, true) => (None, None),
                        (true, false) => (Some(Status::M), Some(Detail::Mode)),
                        (false, _) => (Some(Status::M), None),
                    }
                }
            };
            if let Some(status) = status {
                changes.insert(
                    path.clone(),
                    Change {
                        status,
                        detail,
                        old_path: None,
                        old: old.cloned(),
                        new_kind: current.map(|entry| entry.kind),
                    },
                );
            } else {
                changes.remove(path);
            }
        }
        for path in &restored {
            changes.remove(path);
        }
        // Git ignores nested repositories during diff. Compare the recorded
        // gitlink independently, without opening the nested Git repository.
        let links = scan
            .index
            .iter()
            .filter(|(_, entry)| entry.gitlink)
            .map(|(path, _)| path.as_slice())
            .collect::<Vec<_>>();
        let gitlinks: BTreeSet<&[u8]> = links
            .into_iter()
            .chain(
                tree.iter()
                    .filter(|(_, blob)| blob.kind() == Kind::Gitlink)
                    .map(|(path, _)| path.as_slice()),
            )
            .collect();
        for path in gitlinks {
            let old = tree.get(path);
            let current = self.work_entry(path, scan.index.get(path))?;
            let staged = scan.index.get(path).and_then(|entry| entry.stage.as_ref());
            let current = current.filter(|entry| entry.kind != Kind::Directory);
            let status = match (&old, &current) {
                (None, Some(_)) => Some(Status::A),
                (Some(_), None) => Some(Status::D),
                (Some(old), Some(current))
                    if old.kind() != current.kind || staged.is_some_and(|stage| stage != *old) =>
                {
                    Some(Status::M)
                }
                _ => None,
            };
            if let Some(status) = status {
                changes.insert(
                    path.to_vec(),
                    Change {
                        status,
                        detail: current
                            .as_ref()
                            .zip(old)
                            .filter(|(current, old)| current.kind != old.kind())
                            .map(|_| Detail::Type),
                        old_path: None,
                        old: old.cloned(),
                        new_kind: current.map(|value| value.kind),
                    },
                );
            }
        }
        for (path, entry) in &scan.index {
            if entry.conflict {
                let current = self
                    .work_entry(path, Some(entry))?
                    .filter(|value| value.kind != Kind::Directory);
                changes.insert(
                    path.clone(),
                    Change {
                        status: Status::U,
                        detail: Some(Detail::Conflict),
                        old_path: None,
                        old: tree.get(path).cloned(),
                        new_kind: current.map(|value| value.kind),
                    },
                );
            }
        }

        for path in &scan.others {
            if restored.contains(path)
                || changes.contains_key(path)
                || scan.index.contains_key(path)
            {
                continue;
            }
            let Some(current) = self.work_entry(path, None)? else {
                continue;
            };
            if current.kind == Kind::Directory {
                continue;
            }
            changes.insert(
                path.clone(),
                Change {
                    status: Status::U,
                    detail: Some(Detail::Untracked),
                    old_path: None,
                    old: None,
                    new_kind: Some(current.kind),
                },
            );
        }
        if paths.is_empty() {
            self.infer_renames(&mut changes)?;
        }
        Ok(Delta { changes, restored })
    }

    fn infer_renames(&self, changes: &mut BTreeMap<RawPath, Change>) -> Result<()> {
        let deleted: Vec<_> = changes
            .iter()
            .filter(|(_, row)| row.status == Status::D)
            .filter_map(|(path, row)| row.old.as_ref().map(|old| (path, old)))
            .take(RENAME_LIMIT + 1)
            .collect();
        let untracked: Vec<_> = changes
            .iter()
            .filter(|(_, row)| row.detail == Some(Detail::Untracked))
            .take(RENAME_LIMIT + 1)
            .collect();
        if deleted.is_empty()
            || untracked.is_empty()
            || deleted.len() + untracked.len() > RENAME_LIMIT
        {
            return Ok(());
        }
        let mut old_by_identity = BTreeMap::<_, Vec<_>>::new();
        for (path, old) in deleted {
            old_by_identity
                .entry((old.kind(), old.oid.as_str()))
                .or_default()
                .push(path);
        }
        let mut added_by_identity = BTreeMap::<_, Vec<_>>::new();
        let mut budget = RENAME_BYTES;
        for (path, _) in untracked {
            let Some(current) = self.work_entry(path, None)? else {
                continue;
            };
            let oid = match self.hash_work(path, &current, &mut budget) {
                Ok(oid) => oid,
                Err(error) if error.code == LIMIT.code => return Ok(()),
                Err(error) => return Err(error),
            };
            if let Some(oid) = oid {
                added_by_identity
                    .entry((current.kind, oid))
                    .or_default()
                    .push((path, current.mode));
            }
        }
        let pairs: Vec<_> = added_by_identity
            .into_iter()
            .filter_map(|((kind, oid), added)| {
                let deleted = old_by_identity.get(&(kind, oid.as_str()))?;
                (deleted.len() == 1 && added.len() == 1)
                    .then(|| (deleted[0].clone(), added[0].0.clone(), added[0].1.clone()))
            })
            .collect();
        for (from, to, mode) in pairs {
            let old = changes.remove(&from).ok_or(STALE)?.old;
            let target = changes.get_mut(&to).ok_or(STALE)?;
            target.status = Status::R;
            target.detail = old
                .as_ref()
                .filter(|old| old.mode != mode)
                .map(|_| Detail::Mode);
            target.old_path = Some(from);
            target.old = old;
        }
        Ok(())
    }

    fn inventory(&self, paths: &[&[u8]]) -> Result<Inventory> {
        Ok(Inventory {
            index: self.index(paths)?,
            others: self.others(paths)?,
        })
    }

    pub(super) fn catalog(&self) -> Result<Catalog> {
        let scan = self.inventory(&[])?;
        let Delta {
            mut changes,
            restored,
        } = self.changes(&scan, &[])?;
        let mut rows = Rows::default();
        if self.view == View::All {
            let mut visible: BTreeSet<&[u8]> = scan
                .index
                .keys()
                .chain(scan.others.iter())
                .map(Vec::as_slice)
                .collect();
            visible.extend(changes.keys().chain(restored.iter()).map(Vec::as_slice));
            let mut leaves = Vec::new();
            for path in visible {
                self.check_budget()?;
                let current = self.work_entry(path, scan.index.get(path))?;
                if let Some(current) = current
                    && current.kind != Kind::Directory
                {
                    leaves.push((path.to_vec(), current.kind));
                }
            }
            let opaque = leaves
                .iter()
                .filter(|(_, kind)| *kind == Kind::Gitlink)
                .map(|(path, _)| path.clone())
                .collect();
            for (path, kind) in leaves {
                let change = changes.remove(&path);
                rows.add(path, kind, change)?;
            }
            self.add_directories(&mut rows, &opaque)?;
        } else {
            for (path, change) in changes {
                let kind = change
                    .new_kind
                    .or_else(|| change.old.as_ref().map(Blob::kind))
                    .unwrap_or(Kind::File);
                rows.add(path, kind, Some(change))?;
            }
        }
        Ok(rows.finish(self.view, self.comparison.clone()))
    }

    fn add_directories(&self, rows: &mut Rows, opaque: &BTreeSet<RawPath>) -> Result<()> {
        let ignored = self.git(
            &[
                "ls-files",
                "--others",
                "--ignored",
                "--directory",
                "--exclude-standard",
                "-z",
            ],
            &[],
            MAX_NAMES,
        )?;
        let mut ignored_entries = BTreeSet::new();
        for row in records(&ignored)? {
            ignored_entries.insert(row.strip_suffix(b"/").unwrap_or(row));
            if ignored_entries.len() > MAX_ROWS {
                return Err(LIMIT);
            }
        }
        let mut names = 0;
        let mut special = Vec::new();
        walk(self.root, &mut Vec::new(), &mut names, &mut |path, kind| {
            self.check_budget()?;
            let visible = rows.entries.get(path);
            if ignored_entries.contains(path) || opaque.contains(path) {
                return Ok(false);
            }
            if kind == Kind::Directory {
                if visible.is_none() {
                    rows.add(path.to_vec(), Kind::Directory, None)?;
                }
                return Ok(true);
            }
            if kind == Kind::Special && visible.is_none() {
                special.push(path.to_vec());
            }
            Ok(false)
        })?;
        let paths: Vec<_> = special.iter().map(Vec::as_slice).collect();
        let ignored = self.ignored(&paths)?;
        for path in special {
            if !ignored.contains(&path) {
                rows.add(path, Kind::Special, None)?;
            }
        }
        // A later ignore rule can hide a directory while tracked descendants
        // remain visible. Synthesize the required parents of those leaves.
        let mut parents = BTreeSet::new();
        for path in rows.entries.keys() {
            let mut prefix = path.as_slice();
            while let Some(i) = prefix.iter().rposition(|byte| *byte == b'/') {
                prefix = &prefix[..i];
                if rows.entries.contains_key(prefix) || !parents.insert(prefix) {
                    break;
                }
                if rows.entries.len() + parents.len() > MAX_ROWS {
                    return Err(LIMIT);
                }
            }
        }
        let parents: Vec<_> = parents.into_iter().map(<[u8]>::to_vec).collect();
        for path in parents {
            rows.add(path, Kind::Directory, None)?;
        }
        Ok(())
    }

    fn ignored(&self, paths: &[&[u8]]) -> Result<BTreeSet<RawPath>> {
        if paths.is_empty() {
            return Ok(BTreeSet::new());
        }
        let mut input = Vec::new();
        for path in paths {
            // check-ignore has a literal stdin interface but rejects the
            // global pathspec flag. The prefix also shields a leading colon.
            input.extend_from_slice(b"./");
            input.extend_from_slice(path);
            input.push(0);
            if input.len() > MAX_NAMES {
                return Err(LIMIT);
            }
        }
        let (bytes, status) = self.raw_git(
            &["check-ignore", "--no-index", "--stdin", "-z"],
            &[],
            Some(&input),
            MAX_NAMES,
        )?;
        if !matches!(status.code(), Some(0 | 1)) {
            return Err(UNSUPPORTED);
        }
        records(&bytes)?
            .map(|row| {
                row.strip_prefix(b"./")
                    .map(<[u8]>::to_vec)
                    .ok_or(UNSUPPORTED)
            })
            .collect()
    }

    pub(super) fn selected(
        &self,
        catalog: &Catalog,
        rows: &[&Row],
    ) -> Result<Vec<Option<WorkEntry>>> {
        if catalog.comparison != self.comparison {
            return Err(STALE);
        }
        // A rename can involve any source or destination. Ordinary edits and
        // conflicts can validate membership using literal selected pathspecs.
        let full = rows.iter().any(|row| {
            matches!(row.entry.status, Some(Status::A | Status::D | Status::R))
                || row.entry.detail == Some(Detail::Untracked)
        });
        let requested: Vec<_> = rows.iter().map(|row| row.path.as_slice()).collect();
        let paths = if full { &[][..] } else { &requested };
        let scan = self.inventory(paths)?;
        let Delta { changes, restored } = self.changes(&scan, paths)?;
        let mut selected = Vec::with_capacity(rows.len());
        for row in rows {
            let index = scan.index.get(&row.path);
            let mut current = self.work_entry(&row.path, index)?;
            let change = changes.get(&row.path);
            if current
                .as_ref()
                .is_some_and(|value| value.kind == Kind::Directory)
                && row.entry.kind != Kind::Directory
            {
                current = None;
            }
            if self.view == View::All {
                let present = current.as_ref().ok_or(STALE)?;
                let listed = scan.others.contains(&row.path)
                    || index.is_some()
                    || change.is_some()
                    || restored.contains(&row.path);
                let visible_special =
                    present.kind == Kind::Special && self.ignored(&[&row.path])?.is_empty();
                if !listed && !visible_special {
                    return Err(STALE);
                }
            }
            let kind = current
                .as_ref()
                .map(|entry| entry.kind)
                .or_else(|| change.and_then(|row| row.old.as_ref().map(Blob::kind)))
                .unwrap_or(Kind::File);
            if row.entry.kind != kind
                || row.entry.status != change.map(|row| row.status)
                || row.entry.detail != change.and_then(|row| row.detail)
                || row.before.as_ref() != change.and_then(|row| row.old.as_ref())
                || row.old_path.as_ref() != change.and_then(|row| row.old_path.as_ref())
            {
                return Err(STALE);
            }
            selected.push(current);
        }
        Ok(selected)
    }

    pub(super) fn blob_size(&self, blob: &Blob) -> Result<usize> {
        let bytes = self.git(&["cat-file", "-s", &blob.oid], &[], 128)?;
        ascii_line(&bytes)?.parse().map_err(|_| UNSUPPORTED)
    }

    pub(super) fn blob_bytes(&self, blob: &Blob, size: usize) -> Result<Vec<u8>> {
        let bytes = self.git(&["cat-file", "blob", &blob.oid], &[], size)?;
        if bytes.len() != size {
            return Err(STALE);
        }
        Ok(bytes)
    }

    fn work_entry(&self, path: &[u8], index: Option<&IndexEntry>) -> Result<Option<WorkEntry>> {
        let Some(meta) = path_metadata(self.root, path)? else {
            return Ok(None);
        };
        let file_type = meta.file_type();
        let (kind, mode) = if file_type.is_symlink() {
            (Kind::Symlink, "120000")
        } else if file_type.is_file() {
            (
                Kind::File,
                if meta.mode() & 0o100 == 0 {
                    "100644"
                } else {
                    "100755"
                },
            )
        } else if file_type.is_dir() {
            if index.is_some_and(|entry| entry.gitlink) {
                (Kind::Gitlink, "160000")
            } else {
                (Kind::Directory, "040000")
            }
        } else {
            (Kind::Special, "000000")
        };
        Ok(Some(WorkEntry {
            kind,
            mode: if kind == Kind::Special {
                format!("{:06o}", meta.mode())
            } else {
                mode.into()
            },
            meta,
            gitlink: index
                .and_then(|entry| entry.stage.as_ref())
                .filter(|blob| blob.kind() == Kind::Gitlink)
                .map(|blob| blob.oid.clone()),
        }))
    }

    fn hash_work(
        &self,
        path: &[u8],
        current: &WorkEntry,
        budget: &mut usize,
    ) -> Result<Option<String>> {
        let mut hash = openssl::sha::Sha1::new();
        let size = current.meta.len();
        hash.update(format!("blob {size}\0").as_bytes());
        match current.kind {
            Kind::File => {
                let size = usize::try_from(size).map_err(|_| LIMIT)?;
                *budget = budget.checked_sub(size).ok_or(LIMIT)?;
                let file = current.regular(self.root, path)?;
                let mut left = size;
                let mut file = file.take(size as u64 + 1);
                let mut buf = [0; 32 * 1024];
                loop {
                    self.check_budget()?;
                    let size = file.read(&mut buf).map_err(|_| UNSUPPORTED)?;
                    if size == 0 {
                        break;
                    }
                    left = left.checked_sub(size).ok_or(STALE)?;
                    hash.update(&buf[..size]);
                }
                if left != 0 {
                    return Err(STALE);
                }
                current.check(self.root, path)?;
            }
            Kind::Symlink => {
                hash.update(&current.link_target(self.root, path)?);
            }
            Kind::Gitlink => return Ok(current.gitlink.clone()),
            _ => return Ok(None),
        }
        Ok(Some(
            hash.finish()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        ))
    }
}

#[derive(Default)]
struct Delta {
    changes: BTreeMap<RawPath, Change>,
    restored: BTreeSet<RawPath>,
}

struct Inventory {
    index: BTreeMap<RawPath, IndexEntry>,
    others: BTreeSet<RawPath>,
}

#[derive(Default)]
struct Rows {
    entries: BTreeMap<RawPath, Row>,
    raw_bytes: usize,
    bytes: usize,
}

impl Rows {
    fn add(&mut self, path: RawPath, kind: Kind, change: Option<Change>) -> Result<()> {
        let (status, detail, old_path, before) = match change {
            Some(change) => (
                Some(change.status),
                change.detail,
                change.old_path,
                change.old,
            ),
            None => (None, None, None, None),
        };
        let display = display_path(&path);
        let old_display = old_path.as_deref().map(display_path);
        self.raw_bytes += path.len() + old_path.as_ref().map_or(0, Vec::len);
        self.bytes += path.len()
            + display.len()
            + old_path.as_ref().map_or(0, Vec::len)
            + old_display.as_ref().map_or(0, String::len)
            + 320;
        if self.entries.len() >= MAX_ROWS
            || self.raw_bytes > MAX_NAMES
            || self.bytes > MAX_CATALOG_BYTES
        {
            return Err(LIMIT);
        }
        self.entries.insert(
            path.clone(),
            Row {
                entry: Entry {
                    id: String::new(),
                    path: display,
                    old_path: old_display,
                    kind,
                    status,
                    detail,
                },
                path,
                before,
                old_path,
            },
        );
        Ok(())
    }

    fn finish(self, view: View, comparison: Comparison) -> Catalog {
        let generation = uuid::Uuid::new_v4().to_string();
        let mut ids = HashMap::with_capacity(self.entries.len());
        let mut rows = Vec::with_capacity(self.entries.len());
        for mut row in self.entries.into_values() {
            row.entry.id = uuid::Uuid::new_v4().to_string();
            ids.insert(row.entry.id.clone(), rows.len());
            rows.push(row);
        }
        Catalog {
            view,
            generation,
            comparison,
            cursor_key: uuid::Uuid::new_v4(),
            created: Instant::now(),
            bytes: self.bytes,
            rows,
            ids,
        }
    }
}

fn parse_diff(bytes: &[u8]) -> Result<BTreeMap<RawPath, Change>> {
    let mut output = BTreeMap::new();
    let mut rows = records(bytes)?;
    let mut names = 0;
    while let Some(header) = rows.next() {
        let header = ascii_line(header)?.strip_prefix(':').ok_or(UNSUPPORTED)?;
        let fields: Vec<_> = header.split(' ').collect();
        let [before, after, old_oid, _, flag] = fields.as_slice() else {
            return Err(UNSUPPORTED);
        };
        let first_path = rows.next().ok_or(UNSUPPORTED)?;
        validate_path(first_path)?;
        names += first_path.len();
        let (path, old_path, status, detail) = match flag.as_bytes().first() {
            Some(b'R') => {
                let path = rows.next().ok_or(UNSUPPORTED)?;
                validate_path(path)?;
                names += path.len();
                (
                    path,
                    Some(first_path.to_vec()),
                    Status::R,
                    (*flag == "R100" && before != after).then_some(Detail::Mode),
                )
            }
            Some(b'A') => (first_path, None, Status::A, None),
            Some(b'D') => (first_path, None, Status::D, None),
            Some(b'M') => (first_path, None, Status::M, None),
            Some(b'T') => (first_path, None, Status::M, Some(Detail::Type)),
            // Unmerged paths are provided by the stage records, with the true base.
            Some(b'U') => continue,
            _ => return Err(UNSUPPORTED),
        };
        let old = (*before != "000000")
            .then(|| Blob::new(before, old_oid))
            .transpose()?;
        let new_kind = match *after {
            "000000" => None,
            "100644" | "100755" => Some(Kind::File),
            "120000" => Some(Kind::Symlink),
            "160000" => Some(Kind::Gitlink),
            _ => return Err(UNSUPPORTED),
        };
        if output
            .insert(
                path.to_vec(),
                Change {
                    status,
                    detail,
                    old_path,
                    old,
                    new_kind,
                },
            )
            .is_some()
        {
            return Err(UNSUPPORTED);
        }
        if output.len() > MAX_ROWS || names > MAX_NAMES {
            return Err(LIMIT);
        }
    }
    Ok(output)
}

fn valid_oid(oid: &str) -> bool {
    oid.len() == 40 && oid.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_oid(bytes: &[u8]) -> Result<String> {
    let oid = ascii_line(bytes)?;
    valid_oid(oid).then(|| oid.to_string()).ok_or(UNSUPPORTED)
}

fn ascii_line(bytes: &[u8]) -> Result<&str> {
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    if bytes
        .iter()
        .any(|byte| !byte.is_ascii() || byte.is_ascii_control())
    {
        return Err(UNSUPPORTED);
    }
    std::str::from_utf8(bytes).map_err(|_| UNSUPPORTED)
}

fn records(bytes: &[u8]) -> Result<impl Iterator<Item = &[u8]>> {
    if !bytes.is_empty() && !bytes.ends_with(&[0]) {
        return Err(UNSUPPORTED);
    }
    Ok(bytes
        .split(|byte| *byte == 0)
        .take_while(|row| !row.is_empty()))
}

fn validate_path(path: &[u8]) -> Result<()> {
    if path.len() > 4096
        || path
            .split(|byte| *byte == b'/')
            .any(|part| matches!(part, b"" | b"." | b".." | b".git"))
    {
        return Err(UNSUPPORTED);
    }
    Ok(())
}

fn display_path(path: &[u8]) -> String {
    use std::fmt::Write;
    let mut display = String::new();
    for chunk in path.utf8_chunks() {
        for ch in chunk.valid().chars() {
            match ch {
                '\\' => display.push_str("\\\\"),
                ch if ch.is_control() => {
                    let _ = write!(display, "\\u{{{:x}}}", ch as u32);
                }
                ch => display.push(ch),
            }
        }
        for byte in chunk.invalid() {
            let _ = write!(display, "\\x{byte:02x}");
        }
    }
    display
}

pub(super) fn verify_absent(root: &File, path: &[u8]) -> Result<()> {
    if path_metadata(root, path)?.is_some_and(|meta| !meta.is_dir()) {
        return Err(STALE);
    }
    Ok(())
}

fn path_metadata(root: &File, path: &[u8]) -> Result<Option<Metadata>> {
    node(root, path)?
        .map(|file| file.metadata().map_err(|_| UNSUPPORTED))
        .transpose()
}

fn node(root: &File, path: &[u8]) -> Result<Option<File>> {
    validate_path(path)?;
    let mut parts = path.split(|byte| *byte == b'/').peekable();
    let mut parent = None;
    while let Some(part) = parts.next() {
        let name = CString::new(part).map_err(|_| UNSUPPORTED)?;
        let dir = parent.as_ref().unwrap_or(root);
        let flags = libc::O_PATH | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return match io::Error::last_os_error().raw_os_error() {
                Some(libc::ENOENT | libc::ENOTDIR) => Ok(None),
                _ => Err(UNSUPPORTED),
            };
        }
        let file = unsafe { File::from_raw_fd(fd) };
        if parts.peek().is_some() && !file.metadata().map_err(|_| UNSUPPORTED)?.is_dir() {
            return Ok(None);
        }
        parent = Some(file);
    }
    Ok(parent)
}

fn walk(
    dir: &File,
    prefix: &mut RawPath,
    visited: &mut usize,
    visitor: &mut impl FnMut(&[u8], Kind) -> Result<bool>,
) -> Result<()> {
    if prefix.iter().filter(|byte| **byte == b'/').count() > 63 {
        return Err(LIMIT);
    }
    for item in git_review::names(dir).map_err(Error::git)? {
        let item = item.map_err(|_| UNSUPPORTED)?;
        let name = item.file_name();
        let bytes = name.as_bytes();
        if bytes == b".git" {
            continue;
        }
        *visited += 1;
        if *visited > MAX_ROWS * 2 {
            return Err(LIMIT);
        }
        let original = prefix.len();
        if original > 0 {
            prefix.push(b'/');
        }
        prefix.extend(bytes);
        if prefix.len() > 4096 {
            return Err(LIMIT);
        }
        let ty = item.file_type().map_err(|_| STALE)?;
        if ty.is_dir() && visitor(prefix, Kind::Directory)? {
            let child = git_review::open(dir, FsPath::new(&name), true).map_err(|_| STALE)?;
            if git_review::is_missing(&child, FsPath::new(".git")) {
                walk(&child, prefix, visited, visitor)?;
            }
        } else if !ty.is_dir() && !ty.is_file() && !ty.is_symlink() {
            visitor(prefix, Kind::Special)?;
        }
        prefix.truncate(original);
    }
    Ok(())
}

pub(super) struct WorkEntry {
    pub kind: Kind,
    pub mode: String,
    pub meta: Metadata,
    pub gitlink: Option<String>,
}

impl WorkEntry {
    pub(super) fn change_stamp(&self) -> [u8; 48] {
        let parts = [
            self.meta.dev(),
            self.meta.ino(),
            self.meta.mtime() as u64,
            self.meta.mtime_nsec() as u64,
            self.meta.ctime() as u64,
            self.meta.ctime_nsec() as u64,
        ];
        let mut stamp = [0; 48];
        for (chunk, value) in stamp.chunks_exact_mut(8).zip(parts) {
            chunk.copy_from_slice(&value.to_le_bytes());
        }
        stamp
    }

    pub(super) fn check(&self, root: &File, path: &[u8]) -> Result<()> {
        let now = path_metadata(root, path)?.ok_or(STALE)?;
        if !self.matches(&now) {
            return Err(STALE);
        }
        Ok(())
    }

    fn matches(&self, now: &Metadata) -> bool {
        (
            self.meta.dev(),
            self.meta.ino(),
            self.meta.mode(),
            self.meta.len(),
            self.meta.mtime(),
            self.meta.mtime_nsec(),
            self.meta.ctime(),
            self.meta.ctime_nsec(),
        ) == (
            now.dev(),
            now.ino(),
            now.mode(),
            now.len(),
            now.mtime(),
            now.mtime_nsec(),
            now.ctime(),
            now.ctime_nsec(),
        )
    }

    pub(super) fn regular(&self, root: &File, path: &[u8]) -> Result<File> {
        let pinned = node(root, path)?.ok_or(STALE)?;
        let meta = pinned.metadata().map_err(|_| UNSUPPORTED)?;
        if !meta.is_file() || !self.matches(&meta) {
            return Err(STALE);
        }
        // Reopen the owned O_PATH descriptor. A path swapped to a device
        // between inspection and reading can never trigger a device open.
        let file =
            File::open(format!("/proc/self/fd/{}", pinned.as_raw_fd())).map_err(|_| UNSUPPORTED)?;
        if !self.matches(&file.metadata().map_err(|_| UNSUPPORTED)?) {
            return Err(STALE);
        }
        Ok(file)
    }

    pub(super) fn link_target(&self, root: &File, path: &[u8]) -> Result<Vec<u8>> {
        let file = node(root, path)?.ok_or(STALE)?;
        if !self.matches(&file.metadata().map_err(|_| UNSUPPORTED)?) {
            return Err(STALE);
        }
        let mut bytes = vec![0u8; 4096];
        let size = unsafe {
            libc::readlinkat(
                file.as_raw_fd(),
                c"".as_ptr(),
                bytes.as_mut_ptr().cast(),
                bytes.len(),
            )
        };
        if size < 0 || size as usize == bytes.len() {
            return Err(UNSUPPORTED);
        }
        bytes.truncate(size as usize);
        self.check(root, path)?;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_git_records_keep_raw_rename_paths_and_distinguish_display_escapes() {
        let header = b":100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100\0";
        let raw = [header.as_slice(), b"old\t\xff\0new\n\xff\0"].concat();
        let diff = parse_diff(&raw).unwrap();
        let row = &diff[b"new\n\xff".as_slice()];
        assert_eq!(row.status, Status::R);
        assert_eq!(row.old_path.as_deref(), Some(b"old\t\xff".as_slice()));
        assert!(parse_diff(&raw[..raw.len() - 1]).is_err());
        assert!(validate_path(b"normal/../hidden").is_err());
        assert!(validate_path(b"normal/.git/config").is_err());
        assert_ne!(display_path(b"raw-\xff"), display_path(b"raw-\\xff"));
    }
}

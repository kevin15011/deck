use std::{iter::Peekable, path::Path, str::Chars};

#[derive(Clone, Copy)]
enum Separator {
    End,
    Next,
    Chain,
    Open,
    Close,
}

enum Token {
    Word(String),
    Separator(Separator),
}

// Admit a bounded subset of Bash syntax. Every possible command head must
// be visible without evaluating the shell. Expansions, redirects other than
// literal heredocs, function bodies and dynamic dispatch require fresh consent.
pub(super) fn reusable(command: &str, root: &Path, cwd: &Path) -> bool {
    if command.trim().is_empty() || command.len() > 16_384 || command.contains('\0') {
        return false;
    }
    let Some(tokens) = tokenize(command) else {
        return false;
    };
    let mut words = Vec::new();
    let mut groups = 0;
    let mut complete = false;
    for token in tokens.into_iter().chain([Token::Separator(Separator::End)]) {
        let separator = match token {
            Token::Word(word) if !complete => {
                words.push(word);
                continue;
            }
            Token::Word(_) => return false,
            Token::Separator(separator) => separator,
        };
        if !words.is_empty() {
            let argv: Vec<_> = words.iter().map(String::as_str).collect();
            if !simple_command(&argv, root, cwd) {
                return false;
            }
            words.clear();
            complete = true;
        }
        match separator {
            Separator::Open if !complete => groups += 1,
            Separator::Close if complete && groups > 0 => groups -= 1,
            Separator::Chain if complete => complete = false,
            Separator::Next => complete = false,
            Separator::End if groups == 0 => return true,
            _ => return false,
        }
    }
    false
}

fn tokenize(command: &str) -> Option<Vec<Token>> {
    let mut chars = command.chars().peekable();
    let mut tokens = Vec::new();
    let mut heredocs: Vec<(String, bool)> = Vec::new();
    while let Some(ch) = chars.next() {
        let separator = match ch {
            ' ' | '\t' => continue,
            '\n' => {
                for (delimiter, literal) in heredocs.drain(..) {
                    skip_heredoc(&mut chars, &delimiter, literal)?;
                }
                Separator::Next
            }
            ';' => Separator::Next,
            '(' => Separator::Open,
            ')' => Separator::Close,
            '|' => {
                chars.next_if_eq(&'|');
                Separator::Chain
            }
            '&' if chars.next_if_eq(&'&').is_some() => Separator::Chain,
            '<' if chars.next_if_eq(&'<').is_some() => {
                while chars.next_if(|ch| matches!(ch, ' ' | '\t')).is_some() {}
                let mut delimiter = String::new();
                let literal = if let Some(quote) = chars.next_if(|ch| matches!(ch, '\'' | '"')) {
                    quoted(&mut chars, quote, &mut delimiter)?;
                    true
                } else {
                    while let Some(ch) = chars.next_if(|ch| delimiter_char(*ch)) {
                        delimiter.push(ch);
                    }
                    false
                };
                if delimiter.is_empty()
                    || !delimiter.chars().all(delimiter_char)
                    || chars.peek().is_some_and(|ch| !boundary(*ch))
                {
                    return None;
                }
                heredocs.push((delimiter, literal));
                continue;
            }
            _ => {
                let mut word = String::new();
                append(ch, &mut chars, &mut word)?;
                while let Some(ch) = chars.next_if(|ch| !boundary(*ch)) {
                    append(ch, &mut chars, &mut word)?;
                }
                tokens.push(Token::Word(word));
                continue;
            }
        };
        tokens.push(Token::Separator(separator));
    }
    heredocs.is_empty().then_some(tokens)
}

fn boundary(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\n' | ';' | '(' | ')' | '|' | '&' | '<')
}

fn append(ch: char, chars: &mut Peekable<Chars<'_>>, word: &mut String) -> Option<()> {
    if matches!(ch, '\'' | '"') {
        return quoted(chars, ch, word);
    }
    if ch.is_ascii_alphanumeric() || "_./:=+@%,-".contains(ch) {
        word.push(ch);
        return Some(());
    }
    None
}

fn quoted(chars: &mut Peekable<Chars<'_>>, quote: char, word: &mut String) -> Option<()> {
    for ch in chars.by_ref() {
        if ch == quote {
            return Some(());
        }
        if quote == '"' && matches!(ch, '$' | '`' | '\\') {
            return None;
        }
        word.push(ch);
    }
    None
}

fn delimiter_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn skip_heredoc(chars: &mut Peekable<Chars<'_>>, delimiter: &str, literal: bool) -> Option<()> {
    loop {
        let mut line = String::new();
        while let Some(ch) = chars.next_if(|ch| *ch != '\n') {
            line.push(ch);
        }
        let newline = chars.next_if_eq(&'\n').is_some();
        if line == delimiter {
            return Some(());
        }
        if !newline || !literal && line.contains(['$', '`', '\\']) {
            return None;
        }
    }
}

fn within(root: &Path, cwd: &Path, dir: &str) -> bool {
    std::fs::canonicalize(cwd.join(dir))
        .ok()
        .zip(std::fs::canonicalize(root).ok())
        .is_some_and(|(resolved, root)| resolved.is_dir() && resolved.starts_with(root))
}

/// Conservative text scan for Git that could discard or rewrite work anywhere
/// in a command, including inside quotes, substitutions and interpreter code.
/// False positives only cost a fresh prompt; hidden spellings remain a known gap.
pub(super) fn visible_protected_git(command: &str, root: &Path, cwd: &Path) -> bool {
    let words: Vec<_> = command
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .filter(|word| !word.is_empty())
        .collect();
    let protected = [
        "reset", "restore", "clean", "checkout", "switch", "rebase", "push", "stash", "branch",
        "tag", "amend", "--amend", "filter-branch", "filter-repo", "reflog", "update-ref",
        "worktree", "gc", "prune", "rm", "mv", "cherry-pick", "revert", "merge", "pull", "am",
        "apply", "replace",
    ];
    // `git-reset` style helper names count as Git with that verb.
    let helper = |word: &&str| word.strip_prefix("git-").is_some_and(|verb| protected.contains(&verb));
    if words.iter().any(helper) {
        return true;
    }
    if !words.contains(&"git") {
        return false;
    }
    let mut verbs = words.iter().copied().filter(|word| protected.contains(word));
    let Some(verb) = verbs.next() else { return false };
    if verbs.next().is_some() || !matches!(verb, "branch" | "tag" | "stash") {
        return true;
    }
    // A single literal Git listing is read-only. Leave compound commands and
    // protected Git in quoted arguments subject to the conservative scan.
    let listing = tokenize(command).and_then(|tokens| {
        let words: Option<Vec<_>> = tokens.iter().map(|token| match token {
            Token::Word(word) => Some(word.as_str()),
            Token::Separator(_) => None,
        }).collect();
        let words = words?;
        let head = words.iter().position(|word| *word != "rtk")?;
        let ["git", args @ ..] = &words[head..] else { return None };
        git_words(args, root, cwd).map(|args| args.first() == Some(&verb) && git_reusable(args))
    });
    listing != Some(true)
}

pub(super) fn git_words<'a>(args: &'a [&str], root: &Path, cwd: &Path) -> Option<&'a [&'a str]> {
    if let ["-C", dir, rest @ ..] = args {
        return within(root, cwd, dir).then_some(rest);
    }
    Some(args)
}

pub(super) fn simple_command(words: &[&str], root: &Path, cwd: &Path) -> bool {
    let [head, args @ ..] = words else {
        return false;
    };
    if *head == "git" {
        return git_words(args, root, cwd).is_some_and(git_reusable);
    }
    // RTK's Claude hook rewrites `git status` to `rtk git status`; RTK runs the
    // wrapped command, so classify that command itself.
    if *head == "rtk" && !args.is_empty() {
        return simple_command(args, root, cwd);
    }
    if *head == "printf" && args.first() == Some(&"-v") {
        return false;
    }
    // Changing into a project directory keeps later segments classifiable.
    if *head == "cd" {
        return matches!(args, [dir] if within(root, cwd, dir));
    }
    // Read-only forms of tools that can otherwise write files or run programs.
    if *head == "sed" {
        return matches!(args, ["-n", script, files @ ..]
            if print_range(script) && files.iter().all(|file| !file.starts_with('-')));
    }
    if *head == "find"
        && args.iter().any(|arg| {
            matches!(
                *arg,
                "-exec" | "-execdir" | "-ok" | "-okdir" | "-delete" | "-fprint" | "-fprint0"
                    | "-fprintf" | "-fls"
            )
        })
    {
        return false;
    }
    // Any argument naming Git, a shell, an interpreter or a deleting tool may be
    // launched by a wrapper this list does not know; such commands need review.
    let launched = [
        "git", "sh", "bash", "dash", "zsh", "ksh", "fish", "tcsh", "ash", "busybox", "env",
        "sudo", "su", "doas", "pkexec", "xargs", "nice", "nohup", "timeout", "exec", "eval",
        "command", "builtin", "rm", "rmdir", "shred", "truncate", "unlink", "python",
        "python3", "perl", "ruby", "node",
    ];
    if args.iter().any(|arg| {
        let name = Path::new(arg).file_name().and_then(|name| name.to_str()).unwrap_or(arg);
        launched.contains(&name) || name.starts_with("git-")
    }) {
        return false;
    }
    // These spellings can dispatch another program or change the environment
    // in which a subsequent segment runs. Paths and assignments are uncertain.
    let dispatches = [
        "alias",
        "ash",
        "awk",
        "bash",
        "builtin",
        "busybox",
        "cd",
        "command",
        "coproc",
        "dash",
        "declare",
        "do",
        "done",
        "else",
        "elif",
        "enable",
        "env",
        "eval",
        "exec",
        "export",
        "fi",
        "fish",
        "for",
        "function",
        "getopts",
        "hash",
        "if",
        "ksh",
        "let",
        "mapfile",
        "nice",
        "node",
        "nohup",
        "perl",
        "popd",
        "pushd",
        "python",
        "python3",
        "read",
        "readarray",
        "readonly",
        "rm",
        "rmdir",
        "ruby",
        "set",
        "shred",
        "sh",
        "shopt",
        "source",
        "su",
        "sudo",
        "tcsh",
        "then",
        "time",
        "timeout",
        "trap",
        "truncate",
        "typeset",
        "unalias",
        "unlink",
        "unset",
        "until",
        "while",
        "xargs",
        "zsh",
        "case",
        "esac",
        "select",
        "bwrap",
        "chroot",
        "chrt",
        "doas",
        "expect",
        "firejail",
        "flock",
        "ionice",
        "ltrace",
        "nsenter",
        "parallel",
        "pkexec",
        "runuser",
        "script",
        "setsid",
        "ssh",
        "stdbuf",
        "strace",
        "systemd-run",
        "taskset",
        "unbuffer",
        "unshare",
        "watch",
    ];
    !head.is_empty()
        && head
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || b"_-".contains(&ch))
        && !head.starts_with("git-")
        && !dispatches.contains(head)
}

// `N`, `N,M` or `$` ranges followed by `p`: prints lines and nothing else.
fn print_range(script: &str) -> bool {
    script.strip_suffix('p').is_some_and(|range| {
        let parts: Vec<_> = range.split(',').collect();
        parts.len() <= 2
            && parts
                .iter()
                .all(|part| *part == "$" || !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
    })
}

fn git_reusable(words: &[&str]) -> bool {
    let [sub, rest @ ..] = words else {
        return false;
    };
    if rest
        .iter()
        .take_while(|arg| **arg != "--")
        .any(|arg| arg.starts_with("--out"))
    {
        return false;
    }
    match *sub {
        "status" | "diff" | "log" | "show" | "add" | "blame" | "ls-files" | "rev-parse"
        | "describe" => true,
        "commit" => !rest
            .iter()
            .take_while(|arg| **arg != "--")
            .any(|arg| arg.starts_with("--am") || *arg == "-i" || arg.starts_with("--include")),
        "fetch" => !rest
            .iter()
            .any(|arg| arg.starts_with('-') || arg.starts_with('+') || arg.contains(':')),
        // Only listing forms qualify for branch/tag. Short options can be
        // grouped and Git accepts abbreviated long options.
        "branch" | "tag" => {
            rest.is_empty()
                || matches!(rest.first(), Some(&("--list" | "-l")))
                    && rest[1..].iter().all(|arg| !arg.starts_with('-'))
        }
        // Bare stash defaults to push and changes the working tree.
        "stash" => matches!(rest, ["list" | "show", ..]),
        _ => false,
    }
}

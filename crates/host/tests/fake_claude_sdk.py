#!/usr/bin/python3
"""Native wire fixture for the real TypeScript Agent SDK."""
import json
import os
import re
from pathlib import Path
import sys
import subprocess
import time
import traceback
from uuid import uuid4
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

args = sys.argv[1:]
home = Path(os.environ["HOME"])
def report_failure(kind, value, stack):
    with (home / "fixture-error").open("a") as error:
        traceback.print_exception(kind, value, stack, file=error)
sys.excepthook = report_failure
project = home / "project"
trusted = Path.cwd() == project
assert trusted or Path.cwd() == Path("/")
assert (project / "CLAUDE.md").is_file()
def value(flag):
    for i, arg in enumerate(args):
        if arg == flag:
            return args[i + 1]
        if arg.startswith(flag + "="):
            return arg.split("=", 1)[1]
    raise AssertionError(flag)


def option(flag):
    if any(arg == flag or arg.startswith(flag + "=") for arg in args):
        return value(flag)
    return None


assert "ANTHROPIC_API_KEY" not in os.environ


def emit(message):
    print(json.dumps(message), flush=True)


assert value("--setting-sources") == ("user,project,local" if trusted else "user")
for flag in ("--strict-mcp-config", "--safe-mode", "--disable-slash-commands", "--mcp-config"):
    assert not any(arg == flag or arg.startswith(flag + "=") for arg in args), flag
settings = json.loads(value("--settings"))
assert settings["attribution"] == {"commit": ""}
assert settings["forceLoginMethod"] == "claudeai"
assert not {"disableAllHooks", "disableClaudeAiConnectors", "autoMemoryEnabled", "hooks", "sandbox"} & settings.keys()

if args[-3:] == ["auth", "status", "--json"]:
    timed_out = home / "auth-timeout-once"
    if timed_out.is_file():
        timed_out.unlink()
        time.sleep(10)
    emit({"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty",
          "subscriptionType": "team"})
    sys.exit(0)

member = False
catalog = "--no-session-persistence" in args
resume_fixture = (home / "resume-fixture").exists() and trusted and not catalog
investigate_resume = resume_fixture and (home / "investigate-resume-fixture").exists()
apply_fixture = ((home / "apply-fixture").exists() or (resume_fixture and not investigate_resume)) and trusted and not catalog
resume = any(arg == "--resume" or arg.startswith("--resume=") for arg in args)
thread = option("--resume" if resume else "--session-id")
model, effort = option("--model"), option("--effort")
if resume_fixture:
    transcript = home / ".claude" / "projects" / re.sub(r"[^a-zA-Z0-9]", "-", str(project)) / f"{thread}.jsonl"
if catalog:
    assert thread is None and model is None and effort is None


def response(request_id, result):
    emit({"type": "control_response", "response": {
        "subtype": "success", "request_id": request_id, "response": result}})

def ask(number, tool="Read", input=None):
    emit({"type": "control_request", "request_id": f"permission-{number}", "request": {
        "subtype": "can_use_tool", "tool_name": tool,
        "input": {"file_path": str(project / "CLAUDE.md")} if input is None else input,
        "tool_use_id": f"toolu_fixture_{number}", "permission_suggestions": []}})

def bash(number, **input):
    ask(number, "Bash", input)

FLOW = [
    ("Read", {"file_path": str(project / "CLAUDE.md"), "offset": 1, "limit": 10}),
    ("Read", {"file_path": str(project / "search" / "a.txt"), "offset": 5, "limit": 50}),
    ("Glob", {"pattern": "*.md", "path": str(project)}),
    ("Grep", {"pattern": "One", "path": str(project / "search"), "output_mode": "content", "-B": 2}),
    ("Grep", {"pattern": "Two", "path": str(project / "CLAUDE.md"), "output_mode": "count", "head_limit": 5}),
    ("Bash", {"command": "cargo test -p one", "timeout": 5000}),
    ("Bash", {"command": "cargo test -p deck2"}),
    ("Bash", {"command": "git status"}),
    ("Bash", {"command": "printf ordinary", "timeout": 9000}),
    ("Bash", {"command": "git -C . status && (printf ready | cat); cat <<'EOF'\ntask-disk-image\nEOF"}),
    ("Bash", {"command": "git checkout -- f"}),
    ("Bash", {"command": "printf ready; git clean -fd"}),
    ("Bash", {"command": "(git status && git stash drop)"}),
    ("Bash", {"command": "git reset --hard HEAD"}),
    ("Bash", {"command": "setsid git reset --hard"}),
    ("Bash", {"command": "rm -rf x"}),
    ("Bash", {"command": "git-reset --hard"}),
    ("Read", {"file_path": str(home / "state.db")}),
    ("Grep", {"pattern": "Fixture", "path": str(home / "state.db")}),
]

def context_reply(message):
    """Native-shaped summary read: current-request occupancy, never billing totals."""
    request = message["request"]
    assert request.get("detail") == "summary" and not catalog
    marker = home / ("context-reads-" + thread)
    reads = int(marker.read_text()) + 1 if marker.exists() else 1
    marker.write_text(str(reads))
    if (home / "context-unsupported").exists():
        emit({"type": "control_response", "response": {
            "subtype": "error", "request_id": message["request_id"], "error": "unsupported"}})
        return
    used = 12000 + reads * 1000
    body = {
        "categories": [{"name": "Messages", "tokens": used, "color": "x", "kind": "used"}],
        "totalTokens": used, "maxTokens": 167000, "rawMaxTokens": 200000,
        "percentage": round(used / 2000), "gridRows": [], "model": "fixture-model",
        "memoryFiles": [], "mcpTools": [], "agents": [], "isAutoCompactEnabled": True,
        "apiUsage": {"input_tokens": 3, "output_tokens": 50,
                     "cache_creation_input_tokens": 500, "cache_read_input_tokens": used - 553}}
    if (home / "context-tokens-only").exists():
        del body["rawMaxTokens"]
    response(message["request_id"], body)


def serve_context(count):
    """Answer pending context reads while a turn is still running, like the real CLI."""
    for _ in range(count):
        message = json.loads(sys.stdin.readline())
        assert message["request"]["subtype"] == "get_context_usage", message
        context_reply(message)


def compact_boundary():
    emit({"type": "system", "subtype": "compact_boundary", "session_id": thread,
          "compact_metadata": {"trigger": "auto", "pre_tokens": 150000, "post_tokens": 9000}})


def assistant():
    emit({"type": "assistant", "session_id": thread, "parent_tool_use_id": None,
          "message": {"role": "assistant", "content": [{"type": "text", "text": "Partial"}]}})


def context_scenario(name):
    # init and the first assistant event already queued reads in the bridge.
    if name == "slow":
        pass  # telemetry never answers; the turn must still settle at once
    elif name == "tokens-only":
        (home / "context-tokens-only").write_text("")
        serve_context(2)
    elif name == "compact-stale":
        compact_boundary()
        serve_context(1)  # reply to a read that began before the boundary
    elif name == "compact-fresh":
        compact_boundary()
        serve_context(1)
        assistant()
        serve_context(1)
    elif name == "compact-clears":
        serve_context(2)
        compact_boundary()
    finish("Context " + name)


def flow_step(index):
    if index >= len(FLOW):
        emit({"type": "result", "subtype": "success", "is_error": False,
              "session_id": thread, "result": "Flow finished"})
    else:
        ask(f"flow-{index}", *FLOW[index])

def finish(text):
    emit({"type":"result", "subtype":"success", "is_error":False, "session_id":thread, "result":text})

def direct_edit(tool, path, **fields):
    ask("direct", tool, {"file_path": str(project / path), **fields})


def edit(number, path="edit.txt"):
    ask(number, "Edit", {"file_path": str(project / path), "old_string": "before", "new_string": "after"})

def grep(number, pattern="Fixture"):
    ask(number, "Grep", {"pattern": pattern, "path": str(project / "search"),
                         "output_mode": "content", "-B": 2})

def mcp(method, call_id, params=None, *, authorization=None, status=200, timeout=4):
    payload = {"jsonrpc": "2.0", "id": call_id, "method": method, "params": params or {}}
    headers = {"Content-Type": "application/json", **server["headers"]}
    if authorization is not None:
        headers["Authorization"] = authorization
    try:
        with urlopen(Request(server["url"], json.dumps(payload).encode(), headers), timeout=timeout) as res:
            assert res.status == status
            payload = json.load(res)
            return payload.get("result", payload)
    except HTTPError as error:
        assert error.code == status, (method, error.code, error.read())
    except ConnectionResetError:
        # The revoked bridge can close an already accepted socket during Stop.
        assert status == 403
    except URLError as error:
        assert status == 403 and isinstance(error.reason, (ConnectionRefusedError, ConnectionResetError)), error

def call(name, arguments, call_id, *, error=False):
    result = mcp("tools/call", call_id, {"name": name, "arguments": arguments})
    # The shared Git read gate is one permit; its documented contract is retry.
    for _ in range(300):
        if not (result["isError"] and "busy; retry" in result["content"][0]["text"]):
            break
        time.sleep(.02)
        result = mcp("tools/call", call_id, {"name": name, "arguments": arguments})
    assert result["isError"] == error, result
    return result["content"][0]["text"] if error else json.loads(result["content"][0]["text"])

def wait_for(name):
    end = time.monotonic() + 5
    while not (home / name).exists():
        assert time.monotonic() < end, name
        time.sleep(.01)

def gate(name):
    """Browser fixture only: hold until the driver releases this step."""
    if (home / "browser-fixture").exists():
        end = time.monotonic() + 90
        while not (home / name).exists():
            assert time.monotonic() < end, name
            time.sleep(.02)

server = None
inventory = []
stopping = False
received_user = False
instructions = ""
persistent_turns = 0


for line in sys.stdin:
    message = json.loads(line)
    if message.get("request", {}).get("subtype") == "mcp_set_servers":
        assert set(message["request"]["servers"]) == {"deck-session"}
        server = message["request"]["servers"]["deck-session"]
        assert server["type"] == "http"
        assert mcp("initialize", 1)["serverInfo"]["name"] == "deck-session"
        inventory = mcp("tools/list", 2)["tools"]
        allowed = set(value("--allowedTools").split(","))
        assert allowed == {
            "mcp__deck-session__" + tool["name"] for tool in inventory
        } | {"Skill", "mcp__plugin_context-mode_context-mode"}
        response(message["request_id"], {"added": ["deck-session"], "removed": [], "errors": {}})
        continue  # Credentials never go to the fixture's wire log.
    with (home / "wire").open("a") as wire:
        wire.write(json.dumps({"thread": thread, "resume": resume, "catalog": catalog,
                               "model": model, "effort": effort, "message": message}) + "\n")
    if message["type"] == "control_request":
        request = message["request"]
        if request["subtype"] == "initialize":
            assert catalog or request.get("appendSystemPrompt")
            assert not request.get("systemPrompt")
            instructions = request.get("appendSystemPrompt", "")
            member = "Deck live guidance from Lead" in instructions
            workspace_tools = []
            if trusted and not catalog:
                workspace_tools.extend(["Read", "Glob", "Grep"])
                if not member or apply_fixture:
                    workspace_tools.extend(["Edit", "Write", "Bash"])
            tools = [] if catalog else workspace_tools + ["Skill"]
            assert set(value("--tools").replace(",", " ").split()) == set(tools)
            assert value("--permission-mode") == ("dontAsk" if catalog else "default")
            if not catalog:
                assert set(settings["permissions"]["ask"]) == set(workspace_tools)
                assert "--replay-user-messages" in args
            account = {"subscriptionType": "Claude Team"}
            if (home / "reject-billing").exists():
                account["apiKeySource"] = "ANTHROPIC_API_KEY"
            models = [
                {"value": "default", "displayName": "Native default"},
                {"value": "sonnet", "displayName": "Fixture Sonnet", "resolvedModel": "fixture-model",
                 "supportsEffort": True, "supportedEffortLevels": ["low", "high"]},
                {"value": "haiku", "displayName": "Fixture Haiku"},
            ]
            if (home / "remove-effort").exists():
                models[1]["supportedEffortLevels"] = ["low"]
            response(message["request_id"], {
                "commands": [], "models": models, "agents": [], "account": account,
                "output_style": "default", "available_output_styles": [],
                "claude_code_version": "2.1.328"})
        elif request["subtype"] == "get_usage":
            assert not catalog or not trusted
            assert request["skip_behaviors"]
            response(message["request_id"], {
                "subscription_type": "team", "rate_limits_available": True,
                "rate_limits": {
                    "five_hour": {"utilization": 90, "resets_at": "2030-03-17T17:46:40Z"},
                    "seven_day": {"utilization": 95, "resets_at": None},
                    "seven_day_sonnet": {"utilization": None, "resets_at": None},
                    "extra_usage": {"is_enabled": (home / "credits-enabled").exists(), "used_credits": 15},
                }})
        elif request["subtype"] == "get_context_usage":
            context_reply(message)
        elif request["subtype"] == "mcp_status":
            if (home / "hold-startup").exists():
                wait_for("release-startup")
            if (home / "fail-startup-always").exists():
                sys.exit(1)
            if (home / "fail-startup-once").exists():
                (home / "fail-startup-once").unlink()
                sys.exit(1)
            statuses = [{
                "name": "deck-session", "status": "connected", "source": "dynamic",
                "tools": [{"name": tool["name"]} for tool in inventory],
            }]
            if (home / "pending-foreign-mcp").exists():
                statuses.append({"name": "unrelated", "status": "pending", "source": "user"})
            if (home / "unexpected-mcp").exists():
                statuses.append({"name": "foreign", "status": "connected", "source": "user",
                                 "tools": [{"name": "lookup"}, {"name": "lookup_other"}]})
            if (home / "duplicate-deck-status").exists():
                statuses.append({"name": "deck-session", "status": "failed", "source": "user"})
            response(message["request_id"], {"mcpServers": statuses})
        elif request["subtype"] == "interrupt":
            if stopping or (member and member_action == "stop"):
                mcp("tools/list", 30, status=403)
                if member:
                    mcp("tools/call", 31, {"name": "deck_git_inspect", "arguments": {}}, status=403)
                (home / "grant-revoked").touch()
            response(message["request_id"], {"still_queued": []})
            emit({"type": "result", "subtype": "error_during_execution", "is_error": True,
                  "session_id": thread, "errors": []})
            break
    if message["type"] == "control_response":
        reply = message["response"]
        if reply["request_id"] == "permission-user-mcp-first":
            assert reply["response"]["behavior"] == "allow", "Native MCP ask was denied without user consent"
            assert reply["response"]["updatedInput"] == {"value": "one"}
            ask("user-mcp-reuse", "mcp__foreign__secret_status", {"value": "two"})
            continue
        elif reply["request_id"] == "permission-user-mcp-reuse":
            assert reply["response"]["behavior"] == "allow"
            assert reply["response"]["updatedInput"] == {"value": "two"}
            ask("user-mcp-other", "mcp__foreign__lookup_other", {"value": "two"})
            continue
        elif reply["request_id"] == "permission-user-mcp-other":
            assert reply["response"]["behavior"] == "deny"
            if member:
                ask("member-outside", input={"file_path": str(home / "state.db")})
                continue
            finish("User MCP review completed")
            break
        elif reply["request_id"] == "permission-continuity-edit":
            assert reply["response"]["behavior"] == "allow"
            edited = reply["response"]["updatedInput"]
            Path(edited["file_path"]).write_text(edited["content"])
            transcript.parent.mkdir(parents=True, exist_ok=True)
            with transcript.open("a") as f:
                f.write(json.dumps({"type":"user", "sessionId":thread, "cwd":str(project),
                                    "message":{"role":"user","content":"Fixture transcript"},
                                    "context":"context-from-transcript"}) + "\n")
            finish("Edited fixture")
            break
        if reply["request_id"] == "permission-apply-edit":
            assert reply["response"]["behavior"] == "allow"
            edited = reply["response"]["updatedInput"]
            Path(edited["file_path"]).write_text(edited["content"])
            bash("apply-unsafe", command="touch unsafe", dangerouslyDisableSandbox=True)
        elif reply["request_id"] == "permission-apply-unsafe":
            assert reply["response"]["behavior"] == "deny"
            bash("apply-denied", command="rm -rf should-not-exist")
        elif reply["request_id"] == "permission-apply-denied":
            assert reply["response"]["behavior"] == "deny"
            bash("apply-make", command="make test")
        elif reply["request_id"] in ("permission-apply-make", "permission-lead-make"):
            permit = reply["response"]
            assert permit["behavior"] == "allow" and permit["updatedInput"] == {"command": "make test"}
            run = subprocess.run(permit["updatedInput"]["command"], shell=True, cwd=project,
                                 env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True)
            assert run.returncode == 0 and run.stdout.strip() == "test-passed", run
            if reply["request_id"] == "permission-apply-make":
                bash("apply-cargo-1", command="cargo test -p one", timeout=5000)
                continue
            finish("make test exited 0: test-passed")
            break
        elif reply["request_id"] == "permission-apply-cargo-1":
            assert reply["response"]["behavior"] == "allow"
            bash("apply-cargo-2", command="cargo test -p two --lib", timeout=9000)
        elif reply["request_id"] == "permission-apply-cargo-2":
            assert reply["response"]["behavior"] == "allow"
            finish("make test exited 0: test-passed")
            break
        elif reply["request_id"] == "permission-lead-child":
            assert reply["response"]["behavior"] == "allow"
            child = subprocess.Popen(reply["response"]["updatedInput"]["command"], shell=True, cwd=project)
            wait_for("bash-descendant")
        elif reply["request_id"] == "permission-member-read":
            assert reply["response"]["behavior"] == "allow"
            assert reply["response"]["updatedInput"] == {"file_path": str(project / "CLAUDE.md")}
            if (home / "review-user-mcp").exists() and member_action == "complete":
                ask("user-mcp-first", "mcp__foreign__secret_status", {"value": "one"})
                continue
            ask("member-outside", input={"file_path": str(home / "state.db")})
        elif reply["request_id"] == "permission-member-outside":
            assert reply["response"]["behavior"] == "deny"
            ask("member-write", "Write", {"file_path": str(project / "escaped"), "content": "escaped"})
        elif reply["request_id"] == "permission-member-write":
            assert reply["response"]["behavior"] == "deny"
            bash("member-bash", command="touch read-only-bash")
        elif reply["request_id"] == "permission-member-bash":
            assert reply["response"]["behavior"] == "deny"
            git = call("deck_git_inspect", {}, 91)
            status = git["status"].splitlines()
            assert " M tracked.txt" in status and "?? untracked.txt" in status, git
            assert "A  staged.txt" in status and "?? primary-only.txt" not in status, git
            assert "tracked.txt" in git["unstagedDiffStat"] and "staged.txt" in git["stagedDiffStat"], git
            assert not (home / "unexpected-git-helper").exists()
            assert "linked-only commit" in git["recentCommits"] and "main-only commit" not in git["recentCommits"], git
            call("deck_git_inspect", {"path": str(home)}, 92, error=True)
            (home / "member-scoped").write_text(thread)
            (home / f"member-running-{thread}").write_text(str(os.getpid()))
            if member_action in ("guidance", "withheld", "delayed"):
                continue  # Held open: only Lead guidance can finish this member.
            if member_action == "stop":
                continue
            if (home / "member-crash").exists():
                wait_for("release-member-after-restart")
                break
            wait_for("release-member")
            git = call("deck_git_inspect", {}, 93)
            assert (home / "browser-fixture").exists() or ("after-start.txt" in git["status"] and "after-start commit" in git["recentCommits"]), git
            emit({"type":"result", "subtype":"success", "is_error":False, "session_id":thread,
                  "result":"Claude member report"})
            break
        elif reply["request_id"] == "permission-direct":
            result = reply["response"]
            assert result["behavior"] == "allow", result
            update = result["updatedInput"]
            path = Path(update["file_path"])
            if "content" in update:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(update["content"])
                direct_edit("Edit", "nested/direct.txt", old_string="before",
                            new_string="after", replace_all=True)
            else:
                assert update["replace_all"] is True
                path.write_text(path.read_text().replace(update["old_string"], update["new_string"]))
                ask("outside-write", "Write", {"file_path": str(home / "escape.txt"), "content": "escaped"})
        elif reply["request_id"] in ("permission-outside-write", "permission-untrusted-write"):
            assert reply["response"]["behavior"] == "deny"
            emit({"type": "result", "subtype": "success", "is_error": False,
                  "session_id": thread, "result": "Direct edits finished"})
            break
        elif reply["request_id"].startswith("permission-flow-"):
            index = int(reply["request_id"].rsplit("-", 1)[1])
            # rm -rf x (15) is covered by the user's Any Bash grant; protected Git is denied.
            assert reply["response"]["behavior"] == ("allow" if index < 10 or index == 15 else "deny")
            flow_step(index + 1)
        elif reply["request_id"] == "permission-yolo-protected":
            assert reply["response"]["behavior"] == "deny"
            finish("Protected Git reviewed")
            break
        elif reply["request_id"] == "permission-1":
            assert reply["response"]["behavior"] == "allow"
            assert reply["response"]["updatedInput"] == {"file_path": str(project / "CLAUDE.md")}
            ask(2, "Glob", {"pattern": "*.md", "path": str(project)})
        elif reply["request_id"] == "permission-2":
            assert reply["response"]["behavior"] == "deny"
            ask("outside", input={"file_path": str(home / "state.db")})
        elif reply["request_id"] == "permission-outside":
            assert reply["response"]["behavior"] == "deny"
            ask("shell", "Bash", {"command": "true", "run_in_background": True})
        elif reply["request_id"] == "permission-shell":
            assert reply["response"]["behavior"] == "deny"
            grep(3)
        elif reply["request_id"] == "permission-3":
            assert reply["response"]["behavior"] == "allow"
            assert reply["response"]["updatedInput"]["path"] == str(project / "search")
            edit("git", ".git/config")
        elif reply["request_id"] in ("permission-grant-reused", "permission-grant-denied"):
            expected = "allow" if reply["request_id"] == "permission-grant-reused" else "deny"
            assert reply["response"]["behavior"] == expected, reply
            emit({"type": "result", "subtype": "success", "is_error": False,
                  "session_id": thread,
                  "result": "Follow-up finished" if expected == "allow" else "Search denied"})
            break
        elif reply["request_id"] == "permission-git":
            assert reply["response"]["behavior"] == "deny"
            edit("symlink", "link.txt")
        elif reply["request_id"] == "permission-symlink":
            assert reply["response"]["behavior"] == "deny"
            ask("symlink-dir", "Write", {"file_path": str(project / "outside-dir/new.txt"), "content": "escaped"})
        elif reply["request_id"] == "permission-symlink-dir":
            assert reply["response"]["behavior"] == "deny"
            edit("hardlink", "hardlink.txt")
        elif reply["request_id"] == "permission-hardlink":
            assert reply["response"]["behavior"] == "deny"
            edit("missing", "missing.txt")
        elif reply["request_id"] == "permission-missing":
            assert reply["response"]["behavior"] == "deny"
            ask("hold")
        elif reply["request_id"] == "permission-hold":
            assert reply["response"]["behavior"] == "deny"
        else:
            raise AssertionError("Unexpected permission release")
    if message["type"] == "user":
        assert not catalog
        received_user = True
        content = message["message"]["content"]
        if message.get("priority") == "next":
            # A live message folded into the running turn. The CLI echoes the
            # stored user message by uuid only when started with the replay flag.
            assert "--replay-user-messages" in args and message.get("uuid")
            blocks = content if isinstance(content, list) else [{"type": "text", "text": content}]
            text = "".join(b.get("text", "") for b in blocks if b["type"] == "text")
            (home / f"steer-{message['uuid']}").write_text(json.dumps(blocks))
            if member and member_action == "delayed":
                # A foreign receipt must never settle this input. The real one
                # arrives only after the host's confirmation window has passed.
                emit({"type": "user", "message": message["message"], "session_id": thread,
                      "parent_tool_use_id": None, "uuid": "00000000-0000-4000-8000-0000000000aa", "isReplay": True})
                end = time.monotonic() + 60
                while not (home / "release-delayed-echo").exists():
                    assert time.monotonic() < end, "release-delayed-echo"
                    time.sleep(.01)
            if "echo-withheld" not in text:
                emit({"type": "user", "message": message["message"], "session_id": thread,
                      "parent_tool_use_id": None, "uuid": message["uuid"], "isReplay": True})
            if member:
                assert text.startswith("Deck live guidance from Lead"), text
                if member_action == "guidance":
                    correction = json.loads(text.split("): ", 1)[1])["text"]
                    finish("Claude member report corrected: " + correction)
                elif member and member_action == "delayed":
                    finish("Claude member report delayed: " + json.loads(text.split("): ", 1)[1])["text"])
                else:
                    assert member_action == "withheld"
                    finish("Claude member report uncorrected")
                break
            if text.startswith("finish"):
                result = {"type": "result", "subtype": "success", "is_error": False,
                          "session_id": thread, "result": "Steered: " + text}
                if "consumed-only" in text:
                    result["user_message_uuids"] = [message["uuid"]]
                elif "next-turn-consumed" in text:
                    result["user_message_uuids"] = [initial_uuid]
                emit(result)
                if "next-turn-consumed" in text:
                    emit({"type": "user", "message": message["message"], "session_id": thread,
                          "parent_tool_use_id": None, "uuid": message["uuid"], "isReplay": True})
                    emit({**result, "user_message_uuids": [message["uuid"]]})
                break
            continue
        initial_uuid = message.get("uuid")
        if isinstance(content, list):
            (home / "initial-blocks").write_text(json.dumps(content))
            content = "".join(b.get("text", "") for b in content if b["type"] == "text")
        if content.startswith("persistent-batch:"):
            persistent_turns += 1
            if persistent_turns == 1:
                emit({"type": "system", "subtype": "init", "session_id": thread,
                      "model": "fixture-model",
                      "tools": tools + ["mcp__deck-session__" + tool["name"] for tool in inventory],
                      "mcp_servers": [{"name": "deck-session", "status": "connected"}] if server else []})
                (home / "mcp-proxy-endpoint.json").write_text(json.dumps(server))
                (home / "persistent-cli-pid").write_text(str(os.getpid()))
                parts = ["A"] + [f"x{i} " for i in range(120)]
                for chunk in parts:
                    emit({"type": "stream_event", "session_id": thread, "parent_tool_use_id": None,
                          "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": chunk}}})
                full = "".join(parts)
                emit({"type": "assistant", "session_id": thread, "parent_tool_use_id": None,
                      "message": {"role": "assistant", "content": [{"type": "text", "text": full}]}})
                finish(full)
                continue
            # Subsequent turns on the same persistent CLI process do not re-emit system/init;
            # they echo the user message via --replay-user-messages and reuse deck-session MCP.
            emit({"type": "user", "message": message["message"], "session_id": thread,
                  "parent_tool_use_id": None, "uuid": initial_uuid, "isReplay": True})
            call("deck_session_history", {}, 500 + persistent_turns)
            if content.startswith("persistent-batch:progressive"):
                parts = []
                for wave in range(4):
                    wave_chunks = [f"w{wave}c{i}-" for i in range(10)]
                    for chunk in wave_chunks:
                        parts.append(chunk)
                        emit({"type": "stream_event", "session_id": thread, "parent_tool_use_id": None,
                              "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": chunk}}})
                    if wave < 3:
                        time.sleep(0.24)
                finish(f"Reused turn {persistent_turns} pid={os.getpid()} " + "".join(parts))
                continue
            parts = [f"r{i}-" for i in range(40)]
            for chunk in parts:
                emit({"type": "stream_event", "session_id": thread, "parent_tool_use_id": None,
                      "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": chunk}}})
            finish(f"Reused turn {persistent_turns} pid={os.getpid()} " + "".join(parts))
            continue
        if resume_fixture and member and content.endswith("continuity-foreign"):
            assert resume
            emit({"type":"result", "subtype":"success", "is_error":False,
                  "session_id":"00000000-0000-4000-8000-000000000001", "result":"Wrong session"})
            break
        extra_mcp = (home / "unexpected-mcp").exists()
        emit({"type": "system", "subtype": "init", "session_id": thread,
              "model": "fixture-model",
              "tools": tools + ["mcp__deck-session__" + tool["name"] for tool in inventory]
                       + (["ToolSearch"] if content == "Check configured roles" and extra_mcp else [])
                       + (["mcp__foreign__secret_status", "mcp__foreign__lookup_other"] if extra_mcp else []),
              "mcp_servers": ([{"name":"deck-session", "status":"connected"}] if server else [])
                             + ([{"name":"deck-session", "status":"failed"}]
                                if (home / "duplicate-deck-init").exists() else [])
                             + ([{"name":"foreign", "status":"connected"}] if extra_mcp else [])})
        emit({"type": "stream_event", "session_id": thread, "parent_tool_use_id": None,
              "event": {"type": "content_block_delta", "delta": {"type": "text_delta",
                                                                 "text": "Partial"}}})
        # A completed top-level model response: the bridge refreshes context from it.
        emit({"type": "assistant", "session_id": thread, "parent_tool_use_id": None,
              "message": {"role": "assistant", "content": [{"type": "text", "text": "Partial"}]}})
        if member and not resume:
            def stream(event, parent=None):
                emit({"type": "stream_event", "session_id": thread, "parent_tool_use_id": parent, "event": event})
            stream({"type": "message_start", "message": {"id": "msg_fixture"}})
            stream({"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}})
            stream({"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "fixture-private-reasoning"}})
            gate("step-thinking-stop")
            stream({"type": "content_block_stop", "index": 0})
            gate("step-read")
            # A sibling's nested call must never become this member's step.
            emit({"type": "assistant", "session_id": thread, "parent_tool_use_id": "toolu_parent",
                  "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_nested", "name": "Bash", "input": {"command": "nested-sibling"}}]}})
            emit({"type": "assistant", "session_id": thread, "parent_tool_use_id": None,
                  "message": {"role": "assistant", "content": [
                      {"type": "tool_use", "id": "toolu_auto_read", "name": "Read", "input": {"file_path": "CLAUDE.md", "content": "fixture-private-payload"}}]}})
            gate("step-bash")
            emit({"type": "assistant", "session_id": thread, "parent_tool_use_id": None,
                  "message": {"role": "assistant", "content": [
                      {"type": "tool_use", "id": "toolu_auto_bash", "name": "Bash", "input": {"command": "git status --porcelain API_TOKEN=fixture-secret-value\npython3 -c 'fixture-script-secret'"}}]}})
            gate("step-read-result")
            emit({"type": "user", "session_id": thread, "parent_tool_use_id": None,
                  "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_auto_read", "content": "fixture-private-output"}]}})
            gate("step-bash-result")
            if (home / "browser-fixture").exists():
                emit({"type": "user", "session_id": thread, "parent_tool_use_id": None,
                      "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_auto_bash", "content": "fixture-private-output"}]}})
            gate("step-finish")
        if member:
            assert (resume_fixture or not resume) and model == "sonnet" and effort == "high"
            assert "ACTIVE TASK ASSIGNMENT" in content
            assert "Configured member role IDs:" not in instructions
            names = {tool["name"] for tool in inventory}
            assert {"deck_session_history", "deck_task_result", "deck_skill_load"} <= names
            for name in ("deck_delegate", "deck_task_list", "deck_task_cancel", "deck_task_integrate", "deck_task_guide"):
                assert name not in names
                assert "error" in mcp("tools/call", 88, {"name": name, "arguments": {}})
            call("deck_task_result", {"taskId": "outside-admitted-sources", "attempt": 1}, 89, error=True)
            call("deck_session_history", {}, 90)
            if investigate_resume:
                step = content.strip().splitlines()[-1].removeprefix("continuity-")
                if step == "seed":
                    assert not resume
                    transcript.parent.mkdir(parents=True, exist_ok=True)
                    transcript.write_text(json.dumps({
                        "type":"user", "sessionId":thread, "cwd":str(project),
                        "message":{"role":"user","content":"Fixture transcript"},
                        "context":str(uuid4()),
                    }) + "\n")
                    finish("Initial investigation complete")
                else:
                    assert step in ("correct", "native") and resume, "Investigation correction must exercise SDK --resume"
                    secret = json.loads(transcript.read_text())["context"]
                    assert secret not in content and secret not in instructions
                    finish(secret)
                break
            if resume_fixture:
                step = content.strip().splitlines()[-1].removeprefix("continuity-")
                if step == "correct":
                    assert resume, "Correction must exercise SDK --resume"
                    assert "continuity-seed" not in content
                    value = json.loads(transcript.read_text().splitlines()[0])["context"]
                else:
                    assert not resume
                    value = "first" if step == "seed" else step
                ask("continuity-edit", "Write", {"file_path": str(project / "continuity.txt"), "content": value})
                continue
            if apply_fixture:
                ask("apply-edit", "Write", {"file_path": str(project / "expected.txt"), "content": "edited\n"})
                continue
            assert "Deck live guidance from Lead" in instructions
            member_action = ("delayed" if "Hold Claude member for delayed guidance" in content else
                             "withheld" if "Hold Claude member for withheld guidance" in content else
                             "guidance" if "Hold Claude member for guidance" in content else
                             "stop" if content.rstrip().endswith("Hold Claude member for Stop") else "complete")
            ask("member-read", input={"file_path": "CLAUDE.md"})
            continue
        if resume_fixture and content.startswith("member-resume-"):
            step = content.removeprefix("member-resume-")
            wait_for(f"resume-lead-{step}")
            (home / f"resume-lead-{step}").unlink()
            args = {"agent":"investigate" if investigate_resume else "apply-fast", "task":"continuity-" + step}
            if step != "seed":
                args["continueTaskId"] = (home / "resume-task").read_text()
            if step == "fresh":
                args["continuity"] = "fresh"
            if step == "native":
                args.update(continuity="native", continuityJustification="Use the completed investigation transcript")
            task = call("deck_delegate", args, 91)
            (home / "resume-task").write_text(task["taskId"])
            finish("Delegated continuation fixture")
            break
        if resume_fixture and content.startswith("Host task outcome"):
            task_id, number, phase = re.search(r"Task ([^,]+), attempt (\d+), is (\w+)", content).groups()
            wait_for(f"resume-outcome-{number}")
            report = call("deck_task_result", {"taskId":task_id,"attempt":int(number)}, 92)
            assert report["finalReport"] == (phase == "Completed"), report
            if investigate_resume and number == "1":
                receipt = call("deck_task_integrate", {
                    "taskId":task_id, "attempt":1, "state":"integrated", "note":"Reviewed the investigation",
                    "commandId":"adopt-investigation", "evidenceSeqs":report["evidenceSeqs"],
                }, 93)
                assert receipt["state"] == "integrated"
            if investigate_resume and phase == "Failed":
                assert report["result"] is None
                treatment = {
                    "taskId":task_id, "attempt":int(number), "note":"The transcript is missing",
                    "evidenceSeqs":report["evidenceSeqs"],
                }
                call("deck_task_integrate", {
                    **treatment, "state":"integrated", "commandId":"reject-failed-adoption",
                }, 94, error=True)
                call("deck_task_integrate", {
                    **treatment, "state":"blocked", "commandId":"reject-foreign-evidence",
                    "evidenceSeqs":[report["evidenceSeqs"][0] + 1],
                }, 95, error=True)
                receipt = call("deck_task_integrate", {
                    **treatment, "state":"blocked", "commandId":"record-missing-transcript",
                }, 96)
                assert receipt["state"] == "blocked"
            finish("Observed continuation fixture")
            break
        if apply_fixture and content == "delegate-claude-apply":
            wait_for("claude-apply-lead-running")
            task = call("deck_delegate", {"agent": "apply-fast", "task": "Edit the expected output and run make test"}, 91)
            (home / "apply-task").write_text(task["taskId"])
            finish("Delegated Apply Fast")
            break
        if apply_fixture and content.startswith("Host task outcome"):
            task = (home / "apply-task").read_text()
            assert resume and task in content
            wait_for(f"claude-member-outcome-{task}")
            report = call("deck_task_result", {"taskId":task,"attempt":1}, 92)
            assert report["finalReport"] and report["result"]["text"] == "make test exited 0: test-passed"
            finish("Observed Apply Fast result")
            break
        if apply_fixture and content == "lead-make":
            bash("lead-make", command="make test")
            continue
        if apply_fixture and content == "lead-bash-hold":
            stopping = True
            bash("lead-child", command=f'/bin/sh -c \'echo $$ > "{home / "bash-descendant"}"; exec /bin/sleep 60\' & wait')
            continue
        if content == "Drive Lead tools":
            # Executes the Lead tool calls a test writes as drive-N.json.
            (home / "drive-lead").touch()
            count, end = 0, time.monotonic() + 90
            while not (home / "drive-stop").exists():
                assert time.monotonic() < end, "drive-stop"
                request = home / f"drive-{count}.json"
                if request.exists():
                    wanted = json.loads(request.read_text())
                    reply = mcp("tools/call", 2000 + count, wanted, timeout=30)
                    (home / f"drive-{count}.tmp").write_text(json.dumps(reply))
                    (home / f"drive-{count}.tmp").rename(home / f"drive-{count}.out")
                    count += 1
                time.sleep(.01)
            finish("Drove Lead tools")
            break
        if content.startswith("Host task outcome") and (home / "drive-lead").exists():
            finish("Observed driven members")
            break
        if content in ("delegate-claude-member", "delegate-claude-member-stop"):
            action = "stop" if content.endswith("-stop") else "complete"
            wait_for(f"claude-member-lead-{action}")
            instruction = "Hold Claude member for Stop" if action == "stop" else "Return a Claude member report"
            assignment = {"agent": "investigate", "task": instruction}
            task = call("deck_delegate", assignment, 91)
            assert call("deck_delegate", assignment, 91) == task
            (home / ("claude-member-" + action)).write_text(task["taskId"])
            emit({"type":"result", "subtype":"success", "is_error":False, "session_id":thread,
                  "result":"Delegated to Claude member"})
            break
        if content.startswith("Host task outcome") and (home / "claude-member-complete").exists():
            assert resume
            stopped_task = home / "claude-member-stop"
            task = stopped_task.read_text() if stopped_task.exists() and stopped_task.read_text() in content else (home / "claude-member-complete").read_text()
            assert task in content and "attempt 1" in content
            wait_for(f"claude-member-outcome-{task}")
            report = call("deck_task_result", {"taskId":task,"attempt":1}, 92)
            if stopped_task.exists() and task == stopped_task.read_text():
                assert report["phase"] == "cancelled" and report["result"] is None
                final = "Observed stopped Claude member"
            elif (home / "member-crash").exists():
                assert report["phase"] == "failed" and report["result"] is None
                final = "Observed interrupted Claude member"
            else:
                assert report["finalReport"] and report["result"]["text"] == "Claude member report"
                receipt = call("deck_task_integrate", {
                    "taskId":task,"attempt":1,"state":"integrated","note":"Reviewed the exact Claude report",
                    "commandId":"claude-member-fixture-integration","evidenceSeqs":report["evidenceSeqs"],
                }, 93)
                assert receipt["state"] == "integrated"
                final = "Integrated Claude member report"
            emit({"type":"result", "subtype":"success", "is_error":False, "session_id":thread, "result":final})
            break
        if content in ("Check configured roles", "delegate-and-yield", "delegate-and-stop") or content.startswith("Host task outcome"):
            role_line = next(line for line in instructions.splitlines()
                             if line.startswith("Configured member role IDs: "))
            role_ids = json.loads(role_line.split(": ", 1)[1])
            assert role_ids == ["investigate"], role_ids
            delegate = next(tool for tool in inventory if tool["name"] == "deck_delegate")
            schema = delegate["inputSchema"]
            assert schema["properties"]["agent"]["examples"] == role_ids, schema
            choices = schema["allOf"][0]["then"]["properties"]["agent"]["enum"]
            assert choices == role_ids, schema
            assert set(schema["required"]) == {"agent", "task"}, schema
            assert schema["dependentRequired"]["commandId"] == ["replan"], schema
            assert "commandId" in schema["dependentRequired"]["replan"], schema
        if content == "user-mcp-permission":
            ask("user-mcp-first", "mcp__foreign__secret_status", {"value": "one"})
            continue
        if content == "Check configured roles":
            assert not resume
            emit({"type": "result", "subtype": "success", "is_error": False,
                  "session_id": thread, "result": "Configured roles received"})
            break
        if content in ("delegate-and-yield", "delegate-and-stop"):
            key = "complete" if content == "delegate-and-yield" else "stop"
            wait_for(f"lead-running-{key}")
            assert "deck_delegate" in {tool["name"] for tool in inventory}
            assert "--mcp-config" not in args
            old_grant = home / "previous-fixture-grant"
            mcp("tools/list", 20, authorization=old_grant.read_text() if old_grant.exists()
                else "Bearer foreign-receipt", status=401)
            if key == "complete":
                # The isolated fixture exchanges the original grant only to
                # prove that it cannot authenticate to the next attempt.
                with open(old_grant, "w", opener=lambda p, f: os.open(p, f, 0o600)) as grant:
                    grant.write(server["headers"]["Authorization"])
            assignment = {"agent": choices[0], "task": f"Waiting-policy hold {key}"}
            task = call("deck_delegate", assignment, 22)
            assert call("deck_delegate", assignment, 22) == task
            call("deck_delegate", {**assignment, "task": "Changed replay"}, 22, error=True)
            for invalid in ("quality", "explorer", "codex"):
                error = call("deck_delegate", {"agent": invalid, "task": "Invalid member"}, 21, error=True)
                assert choices[0] in error and invalid not in error, error
            error = call("deck_delegate", {**assignment, "commandId": "unneeded"}, 29, error=True)
            assert "replan" in error, error
            assert any(row["id"] == task["taskId"] for row in call("deck_task_list", {}, 23)["tasks"])
            (home / f"task-{key}").write_text(task["taskId"])
            wait_for(f"lead-release-{key}")
            if key == "stop":
                stopping = True
                continue
            emit({"type": "result", "subtype": "success", "is_error": False,
                  "session_id": thread, "result": "Delegated to configured member"})
            break
        if content.startswith("Host task outcome"):
            assert resume
            task = (home / "task-complete").read_text()
            assert task in content and "attempt 1" in content
            wait_for("continuation-running")
            mcp("tools/list", 20, authorization=(home / "previous-fixture-grant").read_text(), status=401)
            report = call("deck_task_result", {"taskId": task, "attempt": 1}, 21)
            assert report["finalReport"] and report["result"]["text"] == "Connected reply", report
            integrated = call("deck_task_integrate", {
                "taskId": task, "attempt": 1, "state": "integrated", "note": "Reviewed the exact fixture report",
                "commandId": "fixture-integration", "evidenceSeqs": report["evidenceSeqs"],
            }, 22)
            assert integrated["state"] == "integrated"
            emit({"type": "result", "subtype": "success", "is_error": False,
                  "session_id": thread, "result": "Integrated member report"})
            break
        if content in ("Readiness fixture", "Readiness after restart", "finish echo-withheld next-turn-consumed", "finish echo-withheld", "Never yielded follow-up"):
            finish("Fixture completed")
            break
        if content == "Lead activity fixture":
            def stream_lead(event):
                emit({"type": "stream_event", "session_id": thread, "parent_tool_use_id": None, "event": event})
            stream_lead({"type": "message_start", "message": {"id": "msg_lead"}})
            stream_lead({"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}})
            stream_lead({"type": "content_block_delta", "index": 0,
                         "delta": {"type": "thinking_delta", "thinking": "fixture-private-reasoning"}})
            wait_for("lead-tool")
            stream_lead({"type": "content_block_stop", "index": 0})
            emit({"type": "assistant", "session_id": thread, "parent_tool_use_id": None,
                  "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_lead",
                      "name": "Bash", "input": {"command": "git status", "unused": "fixture-private-payload"}}]}})
            wait_for("lead-finish")
            finish("Lead activity complete")
            break
        if content == "Exit before live steer yield":
            wait_for("exit-before-yield")
            break
        if content.startswith("Hold for live steering"):
            continue
        if content.startswith("Context scenario "):
            context_scenario(content.split()[-1])
            continue
        if content == "Ordinary flow":
            (project / "search").mkdir(exist_ok=True)
            (project / "search" / "a.txt").write_text("One\nTwo\n")
            flow_step(0)
            continue
        if content == "Protected Git in yolo":
            bash("yolo-protected", command="git reset --hard")
            continue
        if content == "Follow up":
            grep("grant-reused")
            continue
        if content == "Choose Any":
            grep("grant-reused", "Select a workspace grant")
            continue
        if content == "Search a different workspace file":
            ask("grant-reused", "Grep", {"pattern": "Different pattern", "path": str(project / "CLAUDE.md"),
                                       "output_mode": "content", "-B": 2})
            continue
        if content == "Search outside the workspace":
            ask("grant-denied", "Grep", {"pattern": "Different pattern", "path": str(home / "state.db"),
                                       "output_mode": "content", "-B": 2})
            continue
        if content in ("Changed search", "Repeat search"):
            grep("grant-denied", "Different pattern" if content == "Changed search" else "Fixture")
            continue
        if message["message"]["content"] == "Direct workspace edits":
            assert trusted
            direct_edit("Write", "nested/direct.txt", content="before\n" * 11000)
        elif message["message"]["content"] == "Untrusted workspace edit":
            assert not trusted
            ask("untrusted-write", "Write", {"file_path": str(project / "untrusted.txt"), "content": "escaped"})
        else:
            assert trusted
            ask(1)

# Hold the live native group briefly after its broker dies. The restored
# scheduler must wait through this interval, then ignore unreaped zombies.
until = time.monotonic() + 10
while received_user and (home / "hold-group").exists() and time.monotonic() < until:
    time.sleep(0.02)

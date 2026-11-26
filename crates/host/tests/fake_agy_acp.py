#!/usr/bin/python3
"""Hermetic Antigravity 1.5.16 wire fixture. No model requests."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import os
import re
import sys
import time
import traceback
import urllib.request
import urllib.error

root = Path(__file__).parent
session = "native-agy-fixture"
model = "gemini-3.8-flash"
options = [
    {"id": "model", "currentValue": model, "options": [
        {"value": model, "name": "Gemini Flash"},
        {"value": "orchestrator", "name": "Orchestrator"},
    ]},
    {"id": "thought_level", "currentValue": "high"},
    {"id": "mode", "currentValue": "auto"},
]


def send(**message):
    print(json.dumps({"jsonrpc": "2.0", **message}), flush=True)


def log(kind, value):
    logfile = member_profile / "member-wire" if member else root / "agy-wire"
    with logfile.open("a", encoding="utf-8") as f:
        f.write(json.dumps([kind, value]) + "\n")


def update(kind, **params):
    send(method="session/update", params={"sessionId": session,
         "update": {"sessionUpdate": kind, **params}})


def text(value):
    update("agent_message_chunk", content={"type": "text", "text": value})


def request_permission(key, tool, options=None):
    send(id=key, method="session/request_permission", params={
        "sessionId": session, "toolCall": {"toolCallId": "tool-" + key, **tool},
        "options": options if options is not None else [
            {"optionId": "fixture-yes", "kind": "allow_once"},
            {"optionId": "fixture-no", "kind": "reject_once"}],
    })


def permission_outcome(key):
    reply = json.loads(sys.stdin.readline())
    assert reply["id"] == key, reply
    outcome = reply["result"]["outcome"]
    log("permission-outcome", [key, outcome.get("optionId") == "fixture-yes"])
    return outcome


def allow(key, tool, expected):
    request_permission(key, tool)
    outcome = permission_outcome(key)
    if expected is not None:
        assert outcome == {
            "outcome": "selected", "optionId": "fixture-yes" if expected else "fixture-no"}, outcome


def schema_patterns(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "pattern" and isinstance(child, str):
                yield child
            yield from schema_patterns(child)
    elif isinstance(value, list):
        for child in value:
            yield from schema_patterns(child)


def mcp(method, params=None):
    global mcp_request
    mcp_request += 1
    server = servers[0]
    request = urllib.request.Request(server["url"], data=json.dumps({
        "jsonrpc": "2.0", "id": mcp_request, "method": method, "params": params or {},
    }).encode(), headers={"content-type": "application/json",
                         **{header["name"]: header["value"] for header in server["headers"]}})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)["result"]


member = os.environ.get("HOME") == "/deck-member"
member_profile = Path(os.environ["HOME"]) / ".gemini/antigravity-cli"
mcp_request = 0

def report_error(kind, error, tb):
    path = member_profile / "member-errors" if member else root / "fixture-errors"
    with path.open("a", encoding="utf-8") as f:
        traceback.print_exception(kind, error, tb, file=f)

sys.excepthook = report_error

if sys.argv[1:] == ["--version"]:
    print("agy 1.5.16")
    sys.exit(0)
if sys.argv[1:] == ["update", "--help"]:
    print("Usage of update:", file=sys.stderr)
    sys.exit(2)

if sys.argv[1:2] == ["--settings"]:
    assert os.isatty(0) and os.isatty(1), "quota requires a TTY"
    log("quota", None)
    while (root / "hold-quota").exists():
        time.sleep(0.01)
    settings = json.loads(Path(sys.argv[2]).read_text())
    payload = {"quota": {"gemini-5h": {"remaining_fraction": 0.92},
                         "gemini-weekly": {"remaining_fraction": 0.81}}}
    subprocess.run(["/bin/sh", "-c", settings["statusLine"]["command"]],
                   input=json.dumps(payload).encode(), check=True)
    time.sleep(30)

assert sys.argv[1:4] == ["acp", "--stdio", "--disable-telemetry"]
servers = []
set_options = {}
resumed = False
prompt_count = 0
waiting = None
for line in sys.stdin:
    request = json.loads(line)
    method, params = request.get("method"), request.get("params", {})
    request_id = request.get("id")
    if method == "initialize":
        assert params["protocolVersion"] == 1 and params["clientCapabilities"]["terminal"] is False
        if (root / "hold-probe").exists():
            child = subprocess.Popen(["/bin/sleep", "30"], stdin=subprocess.DEVNULL,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            log("probe-group", [os.getpid(), child.pid])
            continue
        send(id=request_id, result={"protocolVersion": 1, "agentInfo": {"version": "1.5.16"},
             "agentCapabilities": {"sessionCapabilities": {"close": {}},
                                   "promptCapabilities": {"image": True}}})
    elif method in {"session/new", "session/resume"}:
        servers = params["mcpServers"]
        if not servers:
            assert method == "session/new" and "_meta" not in params
            log("probe", None)
            if (root / "signed-out").exists():
                send(id=request_id, error={"code": -32000, "message": "auth required PRIVATE_TEST_ID"})
                continue
        else:
            assert "--dangerously-skip-permissions" not in sys.argv
            assert params["cwd"] in (str(root / "project"), "/")
            assert servers[0]["type"] == "http"
            for external in servers[1:]:
                assert Path(external["command"]).is_file()
                assert isinstance(external["args"], list) and isinstance(external["env"], list)
                if external["name"].startswith("deckcodebasememory"):
                    env = {var["name"]: var["value"] for var in external["env"]}
                    assert env["CBM_ALLOWED_ROOT"] == str(root / "project")
                    assert Path(env["CBM_RUNTIME_DIR"]).is_dir()
            log("external-servers", [spec["name"] for spec in servers[1:]])
            assert re.fullmatch(r"deck[0-9a-f]{32}", servers[0]["name"])
            log("deck-server", servers[0]["name"])
            resumed = method == "session/resume"
            if resumed and (root / "forget-session").exists():
                log("resume-rejected", params["sessionId"])
                resumed = False
                send(id=request_id, error={"code": -32602, "message": "session not found"})
                continue
            if resumed:
                assert params["sessionId"] == session and "_meta" not in params
            else:
                instructions = params["_meta"]["antigravity"]["systemPrompt"]["append"]
                if member:
                    assert "Member" in instructions or "member" in instructions
                else:
                    assert "deck_delegate" in instructions
            log(method, session)
        send(id=request_id, result={"sessionId": session, "configOptions": options,
             "models": {"availableModels": [{"modelId": model + "-low"},
                       {"modelId": model + "-high"}, {"modelId": "orchestrator"}]},
             "_meta": {"antigravity": {"tier": {"id": "PRIVATE_TEST_TIER"}}}})
    elif method == "session/close":
        assert not servers
        log("close", params["sessionId"])
        send(id=request_id, result={})
    elif method == "session/set_config_option":
        assert params["sessionId"] == session
        set_options[params["configId"]] = params["value"]
        for option in options:
            if option["id"] == params["configId"]:
                option["currentValue"] = params["value"]
        send(id=request_id, result={"configOptions": options})
    elif method == "session/prompt":
        assert set_options == {"mode": "default", "model": model, "thought_level": "low"}
        prompt_count += 1
        assert params["sessionId"] == session
        prompt = params["prompt"][0]["text"]
        log("prompt", prompt)
        yolo = prompt in {"yolo", "replay-yolo", "revision-yolo", "phase2-delegate", "phase2-continue"}
        if not prompt.startswith("Host task outcome"):
            assert ("--sandbox" not in sys.argv) == yolo, sys.argv
        if prompt.startswith("replay-"):
            write = {"name": "write_file", "kind": "edit", "rawInput": {"Path": "ordinary.txt"}}
            allow("first", write, True)
            allow("first", {**write, "toolCallId": "new-item"}, None)
            allow("second", write, True)
            # A reused tool-call ID on a fresh wire is ambiguous: never select an option.
            request_permission("new-wire", {**write, "toolCallId": "tool-second"})
            assert permission_outcome("new-wire") == {"outcome": "cancelled"}
            if prompt == "replay-relay":
                command = {"name": "run_command", "kind": "execute", "rawInput": {"CommandLine": "printf fixture"}}
                request_permission("pending-item", command)
                request_permission("reuse-item", {**command, "toolCallId": "tool-pending-item"})
                # Reusing a pending review's tool-call ID withdraws that review.
                assert permission_outcome("pending-item") == {"outcome": "cancelled"}
                assert permission_outcome("reuse-item") == {"outcome": "cancelled"}
                request_permission("ambiguous", {
                    "name": "run_command", "kind": "execute", "rawInput": {"CommandLine": "printf fixture"},
                })
                request_permission("ambiguous", {**write, "toolCallId": "new-ambiguous-item"}, [
                    {"optionId": "fixture-yes", "kind": "reject_once"},
                ])
                # The duplicate labels the first request's allow option as a denial.
                assert permission_outcome("ambiguous") == {"outcome": "cancelled"}
        if prompt.startswith("revision-"):
            command = {"name": "run_command", "kind": "execute", "rawInput": {"CommandLine": "printf fixture"}}
            text("Waiting for reassignment")
            if prompt == "revision-relay":
                allow("pending-review", command, None)
            deadline = time.monotonic() + 5
            while not (root / "member-reassigned").exists():
                assert time.monotonic() < deadline, "member reassignment timed out"
                time.sleep(0.01)
            allow("after-reassignment", {
                "name": "write_file", "kind": "edit", "rawInput": {"Path": "ordinary.txt"},
            }, None)
        if prompt == "token-review":
            bearer = servers[0]["headers"][0]["value"].removeprefix("Bearer ")
            (root / "fixture-bearer").write_text(bearer, encoding="utf-8")
            for key, query in [
                ("opaque-hex", bearer),
                ("opaque-jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.K8Avp1Dsj9f1"),
                ("ordinary", "find (café|文字)"),
            ]:
                allow(key, {"name": "grep_search", "kind": "search", "rawInput": {"Query": query}}, True)
        if prompt == "untrusted-yolo":
            allow("untrusted-shell", {"name": "run_command", "kind": "execute",
                                      "rawInput": {"CommandLine": "touch untrusted.txt"}}, False)
        if prompt in {"hold", "crash"}:
            if prompt == "crash":
                marker = root / "hold-group"
                marker.touch()
                subprocess.Popen([sys.executable, "-c",
                    "from pathlib import Path; import sys,time; p=Path(sys.argv[1]); "
                    "exec('while p.exists(): time.sleep(0.02)')", str(marker)],
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            text("Partial")
            if prompt == "crash":
                allow("unreleased", {"name": "run_command", "kind": "execute",
                    "rawInput": {"CommandLine": "printf pending"}}, False)
            waiting = request_id
            continue
        if prompt == "quota-first":
            text("Quota fixture ready")
            while (root / "hold-turn").exists():
                time.sleep(0.01)
        if prompt in {"queued", "resumed"}:
            assert resumed or prompt_count > 1, "Native context was not resumed"
        if prompt in {"permission", "review", "yolo"}:
            text("Starting ")
            send(id="unknown-request", method="fs/read_text_file", params={})
            reply = json.loads(sys.stdin.readline())
            assert reply["id"] == "unknown-request" and reply["error"]["code"] == -32601
            assert mcp("server/discover") == {}
            assert mcp("initialize", {"protocolVersion": "2025-11-25"})["protocolVersion"] == "2025-11-25"
            inventory = mcp("tools/list")["tools"]
            assert any(tool["name"] == "deck_task_list" for tool in inventory)
            # ACP refuses to build its toolbox if an advertised regexp uses
            # lookaround. Test the schema received from the live Bridge.
            delegate = next(t["inputSchema"] for t in inventory if t["name"] == "deck_delegate")
            pattern = delegate["properties"]["action"]["pattern"]
            for advertised in schema_patterns(inventory):
                assert not any(op in advertised for op in ("(?!", "(?=", "(?<!", "(?<=")), advertised
            assert re.fullmatch(pattern, "approve-ready")
            assert not re.fullmatch(pattern, " \t")
            assert not re.fullmatch(pattern, "action\x01")
            # Protects the advertised Decision contract. Fails if Unicode-only
            # whitespace or a forbidden control passes the portable regexp.
            decision = next(t["inputSchema"] for t in inventory if t["name"] == "deck_decision_open")
            question_pattern = decision["properties"]["question"]["pattern"]
            assert not re.fullmatch(question_pattern, "\u0085")
            assert not re.fullmatch(question_pattern, "\u0080")
            assert not re.fullmatch(question_pattern, "\ufeff")
            assert not re.fullmatch(question_pattern, "\u00a0")
            assert not re.fullmatch(question_pattern, "\t\ufeff\u3000\n")
            assert not re.fullmatch(question_pattern, "Question\r")
            assert re.fullmatch(question_pattern, "\ufeff¿Revisión?\u00a0\n確認してください 🔍")
            activity = "tool-deck"
            name = f"mcp_{servers[0]['name']}_deck_task_list"
            update("tool_call", toolCallId=activity, name=name, status="in_progress")
            allow("deck", {"name": name, "kind": "other", "rawInput": {}}, True)
            assert not mcp("tools/call", {"name": "deck_task_list", "arguments": {}}).get("isError")
            update("tool_call_update", toolCallId=activity, status="completed")
            if prompt in {"review", "yolo"}:
                allow("foreign-mcp", {"name": "mcp_deck_deck_task_list", "kind": "other",
                                      "rawInput": {}}, False)
                allow("unknown-mcp", {"name": f"mcp_{servers[0]['name']}_deck_unknown",
                                      "kind": "other", "rawInput": {}}, False)
            if prompt == "review":
                allow("secret-fetch", {"name": "read_url_content", "kind": "fetch", "rawInput": {
                    "Url": "https://example.invalid/page", "Headers": {
                        "X-Custom": "AGY_FIXTURE_PLANTED_VALUE"},
                }}, False)
                for key, name, kind, args in [
                    ("url-path", "view_file", "read", {
                        "Path": "https%3A%2F%2Fexample.invalid%2Ffixture-private-read-path"}),
                    ("url-query", "grep_search", "search", {
                        "Query": "prefix HtTpS://example.invalid/hooks/fixture-private-query"}),
                    ("url-include", "grep_search", "search", {
                        "SearchPath": str(root / "project") + "/src//./lib.rs",
                        "Query": "needle (café|文字)", "Includes": [
                            "*.txt", "src//lib.rs", "//example.invalid/fixture-private-include",
                            "data:text/plain,fixture-private-data",
                            "https://user:fixture-private-userinfo@example.invalid/hook"]}),
                    ("project-path", "view_file", "read", {"Path": "src//lib.rs"}),
                ]:
                    allow(key, {"name": name, "kind": kind, "rawInput": args, "args": args}, True)
                    log("read-search-target", args)
                fetch = {
                    "Url": "https://example.invalid/hooks/6fa29b375c048da71bf34e8f",
                }
                allow("capability-fetch", {"name": "read_url_content", "kind": "fetch",
                                           "rawInput": fetch}, True)
                # Capture the fixture's fetch target after the allow response.
                log("fetch-target", urllib.request.Request(fetch["Url"]).full_url)
            for name, path, expected in [
                ("inside", "ordinary.txt", True),
                ("outside", str(root / "outside-write.txt"), prompt == "yolo"),
                ("linked", "outside-link/escaped.txt", prompt == "yolo"),
            ]:
                allow(name, {"name": "write_file", "kind": "edit",
                             "rawInput": {"Path": path, "Content": "fixture"},
                             "locations": [{"path": path}]}, expected)
            if prompt == "permission":
                allow("shell", {"name": "run_command", "kind": "execute",
                                "rawInput": {"CommandLine": "printf fixture",
                                             "Cwd": str(root / "project")}}, True)
            else:
                target = root / "outside.txt"
                command = ["/usr/bin/touch", str(target)]
                allow("outside-shell", {"name": "run_command", "kind": "execute",
                                        "rawInput": {"CommandLine": " ".join(command)}}, prompt == "yolo")
                if prompt == "yolo":
                    subprocess.run(command, check=True)
                else:
                    allow("linked-shell", {"name": "run_command", "kind": "execute",
                                           "rawInput": {"CommandLine": "printf fixture > outside-link/escaped.txt"}}, False)
        if prompt == "delegate":
            args = {"agent": "investigate", "task": "Return a bounded fixture member report."}
            assert "deck_delegate" in [tool["name"] for tool in mcp("tools/list")["tools"]]
            invalid = mcp("tools/call", {"name": "deck_delegate", "arguments": {**args, "action": " "}})
            assert invalid.get("isError"), invalid
            allow("delegate", {"name": f"mcp_{servers[0]['name']}_deck_delegate", "kind": "other", "rawInput": args}, True)
            result = mcp("tools/call", {"name": "deck_delegate", "arguments": args})
            assert not result.get("isError"), result
            task = json.loads(result["content"][0]["text"])["taskId"]
            (root / "agy-delegated-task").write_text(task, encoding="utf-8")
        if prompt.startswith("Host task outcome") and (root / "agy-delegated-task").exists():
            task = (root / "agy-delegated-task").read_text(encoding="utf-8")
            assert (resumed or prompt_count > 1) and task in prompt
            args = {"taskId": task, "attempt": 1}
            allow("outcome", {"name": f"mcp_{servers[0]['name']}_deck_task_result", "kind": "other", "rawInput": args}, True)
            result = mcp("tools/call", {"name": "deck_task_result", "arguments": args})
            assert not result.get("isError"), result
            report = json.loads(result["content"][0]["text"])
            assert report["phase"] == "completed" and report["finalReport"], report
        if prompt in {"phase2-media", "parity-message"}:
            update("usage_update", used=42000, size=105000)
            update("usage_update", used=1, size=0)
            send(method="session/update", params={"sessionId": "foreign-session",
                 "update": {"sessionUpdate": "usage_update", "used": 100, "size": 200}})
            assert not mcp("tools/call", {"name": "deck_task_list", "arguments": {}}).get("isError")
        if prompt == "parity-message":
            credential_file = root / "previous-parity-credential"
            if credential_file.exists():
                prior = json.loads(credential_file.read_text())["headers"][0]["value"]
                stale = urllib.request.Request(servers[0]["url"], data=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
                    headers={"content-type": "application/json", "Authorization": prior})
                try:
                    urllib.request.urlopen(stale, timeout=5).close()
                except urllib.error.HTTPError as error:
                    assert error.code == 401, error.code
                else:
                    raise AssertionError("previous turn's MCP credential still works")
                assert resumed, "the next process must resume the saved session"
            else:
                credential_file.write_text(json.dumps(servers[0]))
        if prompt == "phase2-media":
            image, = params["prompt"][1:]
            assert image["type"] == "image" and image["mimeType"] == "image/png"
            log("image", hashlib.sha256(base64.b64decode(image["data"], validate=True)).hexdigest())
            cbm, docs = sorted(servers[1:], key=lambda spec: spec["name"])
            allow("read-cbm", {"name": f"mcp_{cbm['name']}_search_graph", "kind": "other"}, True)
            allow("read-docs", {"name": f"mcp_{docs['name']}_query-docs", "kind": "other"}, True)
            allow("spoof-cbm", {"name": "mcp_deckcodebasememory_search_graph", "kind": "other"}, False)
        if prompt.startswith("phase2-delegate"):
            roles = {
                "phase2-delegate-readonly": ("investigate", "quality"),
                "phase2-delegate-untrusted": ("apply-fast",),
                "phase2-delegate": ("investigate", "apply-fast", "quality"),
            }[prompt]
            for role in roles:
                args = {"agent": role, "task": f"Phase 2 fixture work for {role}."}
                result = mcp("tools/call", {"name": "deck_delegate", "arguments": args})
                assert not result.get("isError"), result
                if role == "investigate":
                    task = json.loads(result["content"][0]["text"])["taskId"]
                    (root / "phase2-investigate-task").write_text(task, encoding="utf-8")
        if prompt == "phase2-continue":
            task = (root / "phase2-investigate-task").read_text(encoding="utf-8")
            args = {"agent": "investigate", "continueTaskId": task, "task": "Phase 2 fixture work for investigate.",
                    "continuity": "native", "continuityJustification": "Correct the fixture member report"}
            result = mcp("tools/call", {"name": "deck_delegate", "arguments": args})
            assert not result.get("isError"), result
        if member:
            role = next(role for role in ("investigate", "apply-fast", "quality") if f"Phase 2 fixture work for {role}." in prompt)
            untrusted = Path.cwd() == Path("/")
            write = role == "apply-fast" and not untrusted
            log("member-role", role)
            sandbox_target = root / "project" / f"{role}-direct.txt"
            try:
                sandbox_target.write_text("fixture", encoding="utf-8")
                assert write, "sandbox allowed an unreviewed project write by a read-only member"
            except OSError as error:
                assert error.errno in (1, 2, 13, 30) and not write, error
            boundary_failures = []

            def must_deny(label, operation):
                try:
                    operation()
                except OSError as error:
                    assert error.errno in (1, 2, 13, 30), error
                else:
                    boundary_failures.append(label)

            if not write:
                target = root / "project/member-input.txt"
                must_deny("chmod", lambda: target.chmod(0o666))
                must_deny("utime", lambda: os.utime(target, (1, 1)))
                must_deny("out-of-scope read", lambda: (root / "outside.txt").read_text())
                must_deny("out-of-scope symlink read", lambda: (root / "project/outside-link/outside.txt").read_text())
            must_deny("shared-profile read", lambda: (root / ".gemini/antigravity-cli/settings.json").read_text())
            must_deny("shared-profile write", lambda: (root / ".gemini/antigravity-cli/settings.json").write_text("tampered"))
            auth = member_profile / "antigravity-oauth-token"
            assert auth.read_text() == "fixture account"
            must_deny("account write", lambda: auth.write_text("tampered"))
            state = member_profile / "continuation-fixture"
            if resumed:
                assert state.read_text() == role
            else:
                assert not state.exists(), "new task inherited private state"
                state.write_text(role)
            assert not boundary_failures, boundary_failures
            if not untrusted:
                direct = {"name": "write_file", "kind": "edit", "rawInput": {"Path": "ordinary.txt"}}
                allow(f"{role}-inside", direct, write)
                allow(f"{role}-outside", {**direct, "rawInput": {"Path": str(root / "outside.txt")}}, False)
                allow(f"{role}-read", {"name": "view_file", "kind": "read", "rawInput": {"Path": "member-input.txt"}}, True)
                allow(f"{role}-unsafe-read", {"name": "view_file", "kind": "read", "rawInput": {"Path": "outside-link/agy"}}, False)
                allow(f"{role}-foreign", {"name": "mcp_deck_deck_git_inspect", "kind": "other"}, False)
                names = [tool["name"] for tool in mcp("tools/list")["tools"]]
                assert "deck_git_inspect" in names and "deck_delegate" not in names
                allow(f"{role}-git", {"name": f"mcp_{servers[0]['name']}_deck_git_inspect", "kind": "other"}, True)
                allow(f"{role}-shell", {"name": "run_command", "kind": "execute",
                                       "rawInput": {"CommandLine": "printf fixture", "Cwd": str(root / "project")}}, write)
                cbm = next(spec for spec in servers[1:] if spec["name"].startswith("deckcodebasememory"))
                allow(f"{role}-cbm-read", {"name": f"mcp_{cbm['name']}_search_graph", "kind": "other"}, True)
                allow(f"{role}-cbm-mutation", {"name": f"mcp_{cbm['name']}_delete_project", "kind": "other"}, write)
            update("usage_update", used=123, size=456)
        text("finished")
        send(id=request_id, result={"stopReason": "end_turn"})
        if prompt == "parity-message":
            try:
                text("late frame from completed turn")
            except BrokenPipeError:
                pass
    elif method == "session/cancel":
        assert params["sessionId"] == session
        log("cancel", session)
        if waiting is not None:
            send(id=waiting, result={"stopReason": "cancelled"})
    else:
        raise AssertionError(method)

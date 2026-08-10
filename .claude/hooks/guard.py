#!/usr/bin/env python3
"""
PreToolUse 훅 — 파괴적인 Bash 명령을 차단한다.

--dangerously-skip-permissions(bypassPermissions) 로 실행해도 PreToolUse 훅은
도구 실행 전에 항상 돌기 때문에, 여기서 permissionDecision: "deny" 를 내면
권한 설정과 무관하게 막힌다. 그게 이 스크립트의 존재 이유다.

핵심은 "명령 문자열 전체를 정규식으로 훑기"가 아니라 **실제로 실행될 각 명령의
첫 토큰을 찾아내는 것**이다. 앞쪽만 보면 `cd foo && rm -rf bar` 처럼 뒤에 숨긴
명령을 놓치고, 전체를 훑으면 `grep -n "rm" file` 같은 무해한 명령을 오탐한다.

그래서 이렇게 동작한다:

  1. 히어독 본문을 먼저 걷어낸다. 커밋 메시지에 "git push" 같은 문자열이
     들어있다고 차단하면 안 되므로.
  2. 따옴표 상태를 추적하며 ; && || | & 개행 ( ) { } 로 세그먼트를 쪼갠다.
  3. $(...) 와 백틱 안쪽은 재귀적으로 같은 처리를 한다.
     작은따옴표 안은 치환이 일어나지 않으므로 건너뛴다.
  4. 각 세그먼트에서 sudo / env VAR=1 / nohup 같은 접두어와 /bin/rm 같은
     경로를 벗겨내고 남은 첫 토큰으로 판단한다.

출력은 훅 프로토콜을 따른다. 해당 없으면 아무것도 출력하지 않고 종료(=통과).
"""

import json
import os
import re
import sys

# ---------------------------------------------------------------------------
# 규칙

DELETE_CMDS = {"rm", "rmdir", "unlink", "shred"}

# 명령 앞에 붙어서 실제 명령을 가리는 것들.
# 값을 받는 옵션은 따로 적어둬야 `sudo -u root rm` 에서 root 를 명령으로 오인하지 않는다.
PREFIX_CMDS = {
    "sudo": {"-u", "-g", "-p", "-C", "-h", "-r", "-t", "--user", "--group"},
    "doas": {"-u", "-C"},
    "env": set(),
    "nohup": set(),
    "setsid": set(),
    "time": set(),
    "command": set(),
    "builtin": set(),
    "exec": set(),
    "nice": {"-n", "--adjustment"},
    "ionice": {"-c", "-n", "-p"},
    "stdbuf": {"-i", "-o", "-e"},
    "xargs": {"-I", "-n", "-P", "-d", "-a", "-s", "-E", "-L"},
    "busybox": set(),
    "timeout": set(),  # 첫 위치인자(지속시간)는 아래에서 따로 건너뛴다
}

# git 전역 옵션 중 값을 받는 것들 — `git -C /path push` 를 놓치지 않으려면 필요하다.
GIT_VALUE_OPTS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}

# 남의 커밋을 지울 수 있는 push 옵션들. 일반 push 는 ask 지만 이건 deny.
# --force-with-lease 도 포함한다 — --force 보다 안전할 뿐 히스토리를 다시 쓰는 건 같다.
GIT_PUSH_FORCE = {
    "--force",
    "-f",
    "--force-with-lease",
    "--force-if-includes",
    "--delete",
    "-d",
    "--mirror",
    "--prune",
}

# gh 에서 막을 하위명령 (생성 · 병합 · 삭제)
GH_TARGETS = {"pr", "issue", "release"}
GH_ACTIONS = {"create", "merge", "delete", "delete-asset"}

DENY = "deny"
ASK = "ask"


# ---------------------------------------------------------------------------
# 파싱

HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def strip_heredocs(cmd: str) -> str:
    """
    히어독 본문을 제거한다.

    `git commit -F - <<'EOF' ... EOF` 의 본문은 셸이 실행하는 명령이 아니라
    그냥 데이터다. 커밋 메시지 안에 "git push" 가 들어있다고 막으면 오탐이다.
    """
    lines = cmd.split("\n")
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        delims = [m.group(2) for m in HEREDOC_RE.finditer(line)]
        i += 1
        for d in delims:
            while i < len(lines) and lines[i].strip() != d:
                i += 1
            if i < len(lines):
                i += 1  # 종료 구분자 줄 자체도 건너뛴다
    return "\n".join(out)


def _match_paren(s: str, start: int) -> int:
    """s[start] == '(' 일 때 짝이 되는 ')' 의 인덱스. 없으면 len(s)."""
    depth = 0
    i = start
    while i < len(s):
        if s[i] == "(":
            depth += 1
        elif s[i] == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(s)


def split_segments(cmd: str) -> list:
    """실행될 각 명령을 토큰 리스트로 쪼갠다. 치환 안쪽도 재귀적으로 포함한다."""
    segments = []

    def flush(buf):
        text = "".join(buf).strip()
        if text:
            segments.append(text.split())
        buf.clear()

    def scan(s: str):
        buf = []
        i = 0
        n = len(s)
        quote = None
        while i < n:
            c = s[i]

            if quote == "'":
                # 작은따옴표 안에서는 치환이 일어나지 않는다 — 그대로 문자 취급
                if c == "'":
                    quote = None
                else:
                    buf.append(c)
                i += 1
                continue

            if quote == '"':
                if c == '"':
                    quote = None
                    i += 1
                    continue
                if c == "\\" and i + 1 < n:
                    buf.append(s[i + 1])
                    i += 2
                    continue
                # 큰따옴표 안에서도 $( ) 와 백틱은 실행된다
                if c == "$" and i + 1 < n and s[i + 1] == "(":
                    j = _match_paren(s, i + 1)
                    scan(s[i + 2 : j])
                    i = j + 1
                    continue
                if c == "`":
                    j = s.find("`", i + 1)
                    j = n if j == -1 else j
                    scan(s[i + 1 : j])
                    i = j + 1
                    continue
                buf.append(c)
                i += 1
                continue

            # 따옴표 밖
            if c == "'":
                quote = "'"
                i += 1
                continue
            if c == '"':
                quote = '"'
                i += 1
                continue
            if c == "\\" and i + 1 < n:
                buf.append(s[i + 1])
                i += 2
                continue
            if c == "$" and i + 1 < n and s[i + 1] == "(":
                j = _match_paren(s, i + 1)
                scan(s[i + 2 : j])
                i = j + 1
                continue
            if c == "`":
                j = s.find("`", i + 1)
                j = n if j == -1 else j
                scan(s[i + 1 : j])
                i = j + 1
                continue

            # 명령 구분자
            if c in ";\n":
                flush(buf)
                i += 1
                continue
            if c == "&":
                flush(buf)
                i += 2 if s[i : i + 2] == "&&" else 1
                continue
            if c == "|":
                flush(buf)
                i += 2 if s[i : i + 2] == "||" else 1
                continue
            # 서브셸 · 그룹 경계도 구분자로 취급 → (cd x && rm -rf y) 를 놓치지 않는다
            if c in "(){}":
                flush(buf)
                i += 1
                continue

            buf.append(c)
            i += 1

        flush(buf)

    scan(strip_heredocs(cmd))
    return segments


ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
DURATION_RE = re.compile(r"^\d+(\.\d+)?[smhd]?$")


def strip_prefixes(tokens: list) -> list:
    """sudo / env VAR=1 / nohup / timeout 30 같은 접두어를 벗겨 실제 명령을 남긴다."""
    i = 0
    seen_prefix = False
    while i < len(tokens):
        tok = tokens[i]

        if ASSIGN_RE.match(tok):  # VAR=1 cmd
            i += 1
            continue

        name = os.path.basename(tok)
        if name in PREFIX_CMDS:
            seen_prefix = True
            value_opts = PREFIX_CMDS[name]
            i += 1
            # 접두어가 먹는 옵션들을 건너뛴다
            while i < len(tokens) and tokens[i].startswith("-"):
                opt = tokens[i].split("=", 1)[0]
                i += 2 if (opt in value_opts and "=" not in tokens[i]) else 1
            # timeout 의 지속시간처럼 값 하나를 더 먹는 경우
            if name == "timeout" and i < len(tokens) and DURATION_RE.match(tokens[i]):
                i += 1
            continue

        break

    return tokens[i:], seen_prefix


def _git_subcommand(rest: list):
    """git 전역 옵션을 건너뛰고 하위명령과 그 뒤 인자를 돌려준다."""
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok in GIT_VALUE_OPTS:
            i += 2
            continue
        if tok.startswith("-"):
            i += 1
            continue
        return tok, rest[i + 1 :]
    return None, []


SHORT_CLUSTER_RE = re.compile(r"^-[a-zA-Z]+$")


def _push_force_flag(args: list):
    """git push 인자에서 히스토리를 다시 쓰는 옵션을 찾는다. 없으면 None."""
    for tok in args:
        if tok in GIT_PUSH_FORCE:
            return tok
        if tok.startswith("--force-with-lease=") or tok.startswith("--force-if-includes="):
            return tok
        # -fu 처럼 짧은 플래그를 묶어 쓴 경우
        if SHORT_CLUSTER_RE.match(tok) and ("f" in tok[1:] or "d" in tok[1:]):
            return tok
        # +main:main 은 강제 푸시 refspec 문법이다
        if tok.startswith("+") and ":" in tok:
            return tok
    return None


def _first_positional(rest: list):
    for tok in rest:
        if not tok.startswith("-"):
            return tok
    return None


def classify(tokens: list):
    """(결정, 사유) 또는 None."""
    if not tokens:
        return None

    argv, had_prefix = strip_prefixes(tokens)
    if not argv:
        return None

    cmd = os.path.basename(argv[0])
    rest = argv[1:]

    if cmd in DELETE_CMDS:
        return DENY, f"파일 삭제 명령({cmd})은 차단돼 있습니다"

    # sudo -u root rm -rf / 처럼 옵션 파싱을 빠져나간 경우를 잡는 안전망.
    # 접두어가 실제로 있었을 때만 보므로 `grep -n "rm" file` 같은 건 오탐하지 않는다.
    if had_prefix:
        for tok in argv:
            if os.path.basename(tok) in DELETE_CMDS:
                return DENY, f"파일 삭제 명령({os.path.basename(tok)})은 차단돼 있습니다"

    if cmd == "find":
        if "-delete" in rest:
            return DENY, "find -delete 는 차단돼 있습니다"
        for i, tok in enumerate(rest):
            if tok in ("-exec", "-execdir", "-ok", "-okdir"):
                if i + 1 < len(rest) and os.path.basename(rest[i + 1]) in DELETE_CMDS:
                    return DENY, f"find {tok} {rest[i + 1]} 는 차단돼 있습니다"
        return None

    if cmd == "git":
        sub, args = _git_subcommand(rest)
        if sub == "push":
            forced = _push_force_flag(args)
            if forced:
                return DENY, f"강제 push({forced})는 남의 커밋을 지울 수 있어 차단돼 있습니다"
            return ASK, "원격 저장소에 푸시하려고 합니다"
        if sub == "reset" and "--hard" in args:
            return DENY, "git reset --hard 는 작업 내용을 지웁니다"
        if sub == "clean":
            return DENY, "git clean 은 추적되지 않는 파일을 지웁니다"
        if sub == "commit":
            return ASK, "커밋을 만들려고 합니다"
        return None

    if cmd == "gh":
        sub = _first_positional(rest)
        if sub in GH_TARGETS:
            idx = rest.index(sub)
            action = _first_positional(rest[idx + 1 :])
            if action in GH_ACTIONS:
                return DENY, f"gh {sub} {action} 는 외부에 영향을 주므로 차단돼 있습니다"
        return None

    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0  # 입력을 못 읽으면 통과시킨다 — 훅 오류로 작업을 막지 않는다

    if payload.get("tool_name") != "Bash":
        return 0

    command = (payload.get("tool_input") or {}).get("command")
    if not isinstance(command, str) or not command.strip():
        return 0

    verdict = None
    for tokens in split_segments(command):
        result = classify(tokens)
        if result is None:
            continue
        if result[0] == DENY:
            verdict = result
            break
        if verdict is None:
            verdict = result

    if verdict is None:
        return 0  # 해당 없음 → 아무것도 출력하지 않고 통과

    decision, reason = verdict
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": decision,
                    "permissionDecisionReason": reason,
                }
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

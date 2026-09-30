"""Exercise the real password-reset command using an isolated POSIX terminal."""

import json
import os
from pathlib import Path
import pty
import select
import subprocess
import tempfile
import time

ROOT = str(Path(__file__).resolve().parent.parent)


def run_node(source, env):
    result = subprocess.run(
        ["node", "--conditions=react-server", "--import", "tsx", "-e", source],
        cwd=ROOT, env=env, text=True, capture_output=True, check=True,
    )
    return result.stdout.strip()


def reset_password(second_input, env):
    master, slave = pty.openpty()
    process = subprocess.Popen(
        ["pnpm", "reset:passwd"], cwd=ROOT, env=env,
        stdin=slave, stdout=slave, stderr=slave, close_fds=True,
    )
    os.close(slave)
    output = b""
    stage = 0
    deadline = time.monotonic() + 15
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(master, 8192)
                except OSError:
                    break
                if not chunk:
                    break
                output += chunk
            text = output.decode(errors="replace")
            if stage == 0 and "输入不可见" in text:
                os.write(master, b"87654321\r")
                stage = 1
            elif stage == 1 and "再次输入新密码" in text:
                os.write(master, second_input)
                stage = 2
            if process.poll() is not None:
                break
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=3)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
    text = output.decode(errors="replace")
    assert "87654321" not in text, "Password was echoed"
    return process.returncode, text


def main():
    with tempfile.TemporaryDirectory(prefix="claimlist-cli-") as folder:
        env = os.environ.copy()
        env["DATABASE_PATH"] = folder + "/list.sqlite"
        prelude = "const {Store}=require('./src/server/store.ts');const s=new Store(process.env.DATABASE_PATH);"
        session = run_node(
            prelude + "const token=s.initialize(s.prepareSetup(),'old-cli-test-password');"
            "s.addBatch('CLI 保留任务');console.log(token);s.close();", env,
        )
        participant = run_node(
            prelude + "const a=s.participants.authenticate({email:'cli@example.com',name:'参与者',password:'12345678',confirm:'12345678'},'a0000000-0000-4000-8000-000000000001',true);console.log(a.token);s.close();", env,
        )
        code, output = reset_password(b"wrong-confirm-password\r", env)
        assert code != 0 and "两次密码不一致" in output
        assert run_node(
            prelude + f"console.log(s.authenticated({json.dumps(session)}));"
            "s.login('old-cli-test-password');s.close();", env,
        ) == "true"
        code, output = reset_password(b"87654321\r", env)
        assert code == 0 and "密码已重置" in output
        result = run_node(
            prelude + "s.login('87654321');"
            f"console.log(JSON.stringify({{oldSession:s.authenticated({json.dumps(session)}),"
            "count:s.list({ip:'',uuid:''}).items.length,initialized:s.initialized()}));s.close();", env,
        )
        assert json.loads(result) == {"oldSession": False, "count": 1, "initialized": True}
        assert run_node(
            prelude + f"console.log(!!s.participants.current({json.dumps(participant)}));"
            "s.participants.authenticate({email:'cli@example.com',password:'12345678'},'a0000000-0000-4000-8000-000000000001',false);s.close();", env,
        ) == "true"
        print("PASS: real password-reset PTY; no echo; failed confirmation preserves credentials; "
              "successful reset invalidates admin sessions and preserves participant credentials, sessions and data.")


if __name__ == "__main__":
    main()

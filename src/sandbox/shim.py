import os
import sys
import socket
import json
import base64


def main():
    socket_path = os.environ.get("BRIDGE_SOCK", "./workspace/bridge.sock")
    command = os.environ.get("SHIM_COMMAND", "gh")
    args = sys.argv[1:]
    cwd = os.getcwd()

    req = {
        "command": command,
        "args": args,
        "cwd": cwd,
        "env": {"GH_TOKEN": os.environ.get("GH_TOKEN", "")},
    }

    try:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.connect(socket_path)
        client.sendall(json.dumps(req).encode("utf-8"))

        # Read response
        buffer = ""
        while True:
            data = client.recv(4096)
            if not data:
                break
            buffer += data.decode("utf-8")

            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line)
                    if msg["type"] == "stdout":
                        sys.stdout.buffer.write(base64.b64decode(msg["data"]))
                        sys.stdout.buffer.flush()
                    elif msg["type"] == "stderr":
                        sys.stderr.buffer.write(base64.b64decode(msg["data"]))
                        sys.stderr.buffer.flush()
                    elif msg["type"] == "exit":
                        sys.exit(msg["code"])
                    elif msg["type"] == "error":
                        print(f"[Shim Error] {msg['message']}", file=sys.stderr)
                        sys.exit(1)
                except Exception as e:
                    # Partial JSON or other error
                    pass
    except Exception as e:
        print(f"[Shim] Failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

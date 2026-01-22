import os
import sys
import socket
import threading
import time

# Reliable Threaded TCP-to-Unix Socket Bridge for OpenCode Sandbox
# Optimized for streaming (SSE) and robust cleanup

PROXY_SOCK = os.environ.get("PROXY_SOCK")


def pipe(source, target, label):
    try:
        while True:
            data = source.recv(8192)
            if not data:
                break
            target.sendall(data)
    except:
        pass
    finally:
        try:
            source.close()
        except:
            pass
        try:
            target.close()
        except:
            pass


def bridge_handler(tcp_conn, unix_sock_path):
    try:
        unix_conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        unix_conn.connect(unix_sock_path)

        # Start bidirectional piping
        t1 = threading.Thread(
            target=pipe, args=(tcp_conn, unix_conn, "T->U"), daemon=True
        )
        t2 = threading.Thread(
            target=pipe, args=(unix_conn, tcp_conn, "U->T"), daemon=True
        )

        t1.start()
        t2.start()
    except Exception:
        tcp_conn.close()


def main():
    if len(sys.argv) < 2:
        sys.exit(1)

    start_port = int(sys.argv[1])

    # Robust Port Binding Logic
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    port = start_port
    max_retries = 20
    bound = False

    for i in range(max_retries):
        try:
            server.bind(("127.0.0.1", port))
            bound = True
            break
        except OSError:
            port += 1

    if not bound:
        sys.exit(1)

    server.listen(100)
    # Output the final port so entrypoint can read it if needed
    print(f"PORT:{port}", flush=True)

    while True:
        try:
            client_conn, _ = server.accept()
            bridge_handler(client_conn, PROXY_SOCK)
        except KeyboardInterrupt:
            break
        except:
            pass


if __name__ == "__main__":
    main()

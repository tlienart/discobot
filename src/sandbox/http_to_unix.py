import os
import sys
import socket
import threading
import time

# Ultra-Reliable TCP-to-Unix Bridge for macOS
# With internal logging for debugging

PROXY_SOCK = os.environ.get("PROXY_SOCK")
LOG_FILE = "/tmp/python_bridge.log"


def log(msg):
    with open(LOG_FILE, "a") as f:
        f.write(f"[{time.time()}] {msg}\n")


def pipe(source, target, label):
    try:
        while True:
            data = source.recv(8192)
            if not data:
                log(f"EOF on {label}")
                break
            log(f"Data on {label}: {len(data)} bytes")
            target.sendall(data)
    except Exception as e:
        log(f"Error on {label}: {e}")
    finally:
        try:
            source.close()
        except:
            pass
        try:
            target.close()
        except:
            pass


def bridge(tcp_conn, unix_sock_path):
    try:
        log(f"Connecting to Unix socket: {unix_sock_path}")
        unix_conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        unix_conn.connect(unix_sock_path)
        log("Connected to Host Bridge.")

        t1 = threading.Thread(
            target=pipe, args=(tcp_conn, unix_conn, "TCP->Unix"), daemon=True
        )
        t2 = threading.Thread(
            target=pipe, args=(unix_conn, tcp_conn, "Unix->TCP"), daemon=True
        )

        t1.start()
        t2.start()
    except Exception as e:
        log(f"Bridge setup failed: {e}")
        tcp_conn.close()


def main():
    if len(sys.argv) < 2:
        sys.exit(1)

    port = int(sys.argv[1])
    log(f"Starting bridge on port {port} -> {PROXY_SOCK}")

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", port))
    server.listen(100)

    while True:
        try:
            client_conn, addr = server.accept()
            log(f"Accepted connection from {addr}")
            bridge(client_conn, PROXY_SOCK)
        except Exception as e:
            log(f"Server error: {e}")
            time.sleep(0.1)


if __name__ == "__main__":
    main()

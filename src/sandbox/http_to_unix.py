import os
import sys
import socket
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler

# This script runs inside the sandbox
# It bridges TCP HTTP requests to a Unix Domain Socket (The Host Bridge)

PROXY_SOCK = os.environ.get("PROXY_SOCK")
LOG_FILE = "/tmp/bridge.log"


def log(msg):
    with open(LOG_FILE, "a") as f:
        f.write(f"{msg}\n")


class ProxyHandler(BaseHTTPRequestHandler):
    def do_ANY(self):
        log(f"Request: {self.command} {self.path}")
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else None

            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.connect(PROXY_SOCK)

            # Reconstruct the request to the unix socket
            request_line = f"{self.command} {self.path} {self.request_version}\r\n"
            client.sendall(request_line.encode("utf-8"))

            # Send headers
            for k, v in self.headers.items():
                client.sendall(f"{k}: {v}\r\n".encode("utf-8"))
            client.sendall(b"\r\n")

            # Send body
            if body:
                client.sendall(body)

            # Receive response and pipe back to self.wfile
            while True:
                data = client.recv(4096)
                if not data:
                    break
                self.wfile.write(data)

            client.close()
            log("Request forwarded successfully")
        except Exception as e:
            log(f"Bridge Error: {e}")
            log(traceback.format_exc())
            self.send_error(502, f"Bridge Error: {e}")

    do_GET = do_ANY
    do_POST = do_ANY
    do_PUT = do_ANY
    do_DELETE = do_ANY

    def log_message(self, format, *args):
        log(format % args)


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 http_to_unix.py <port>")
        sys.exit(1)

    port = int(sys.argv[1])
    server = HTTPServer(("127.0.0.1", port), ProxyHandler)
    log(f"HTTP-to-Unix Bridge listening on 127.0.0.1:{port} -> {PROXY_SOCK}")
    server.serve_forever()


if __name__ == "__main__":
    main()

import os
import sys
import socket
import json
import base64
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler

BRIDGE_SOCK = os.environ.get("BRIDGE_SOCK")
LOG_FILE = os.path.join(os.getcwd(), "proxy.log")


def log(msg):
    with open(LOG_FILE, "a") as f:
        f.write(f"{msg}\n")
    print(msg)


class ProxyHandler(BaseHTTPRequestHandler):
    def do_ANY(self):
        log(f"Received {self.command} {self.path}")
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else None

            # Construct URL
            host = self.headers.get("Host", "localhost")
            path = self.path
            url = path if path.startswith("http") else f"https://{host}{path}"

            req = {
                "type": "proxy_fetch",
                "url": url,
                "method": self.command,
                "headers": dict(self.headers),
                "body": base64.b64encode(body).decode("utf-8") if body else None,
            }

            log(f"Connecting to bridge socket: {BRIDGE_SOCK}")
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.connect(BRIDGE_SOCK)
            client.sendall((json.dumps(req) + "\n").encode("utf-8"))

            # Read response
            buffer = ""
            while True:
                data = client.recv(4096)
                if not data:
                    break
                buffer += data.decode("utf-8")
                if "\n" in buffer:
                    break

            res = json.loads(buffer.strip())
            if res["type"] == "response":
                log(f"Success response: {res['status']}")
                self.send_response(res["status"])
                for k, v in res["headers"].items():
                    if k.lower() not in [
                        "content-encoding",
                        "transfer-encoding",
                        "content-length",
                    ]:
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(base64.b64decode(res["body"]))
            else:
                log(f"Error response: {res.get('message')}")
                self.send_error(502, res.get("message", "Proxy Error"))
        except Exception as e:
            log(f"Proxy Exception: {e}")
            log(traceback.format_exc())
            self.send_error(502, str(e))

    do_GET = do_ANY
    do_POST = do_ANY
    do_PUT = do_ANY
    do_DELETE = do_ANY

    def log_message(self, format, *args):
        log(format % args)


def main():
    if len(sys.argv) < 2:
        log("Usage: python3 http_proxy.py <port>")
        sys.exit(1)
    port = int(sys.argv[1])
    server = HTTPServer(("127.0.0.1", port), ProxyHandler)
    log(f"Starting proxy on 127.0.0.1:{port} -> {BRIDGE_SOCK}")
    server.serve_forever()


if __name__ == "__main__":
    main()

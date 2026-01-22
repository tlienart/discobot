import os
import sys
import http.server
import urllib.request

# Host keys from environment
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


class SecureProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_ANY(self):
        try:
            path = self.path
            method = self.command
            headers = dict(self.headers)

            content_length = int(headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else None

            target_url = ""
            auth_header = ""
            auth_value = ""

            if path.startswith("/google"):
                target_url = "https://generativelanguage.googleapis.com" + path[7:]
                auth_header = "x-goog-api-key"
                auth_value = GOOGLE_API_KEY
            elif path.startswith("/openai"):
                target_url = "https://api.openai.com" + path[7:]
                auth_header = "Authorization"
                auth_value = "Bearer " + OPENAI_API_KEY
            elif path.startswith("/anthropic"):
                target_url = "https://api.anthropic.com" + path[10:]
                auth_header = "x-api-key"
                auth_value = ANTHROPIC_API_KEY

            if not target_url:
                self.send_error(404, "Provider Not Found")
                return

            # Injection
            headers[auth_header] = auth_value
            if "Host" in headers:
                del headers["Host"]

            req = urllib.request.Request(
                target_url, data=body, headers=headers, method=method
            )
            with urllib.request.urlopen(req) as res:
                self.send_response(res.status)
                for k, v in res.getheaders():
                    if k.lower() not in [
                        "content-encoding",
                        "transfer-encoding",
                        "content-length",
                    ]:
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(res.read())

        except Exception as e:
            print(f"Proxy Error: {e}")
            self.send_error(502, str(e))

    do_GET = do_ANY
    do_POST = do_ANY
    do_PUT = do_ANY


def main():
    port = int(sys.argv[1])
    server = http.server.HTTPServer(("127.0.0.1", port), SecureProxyHandler)
    print(f"Secure Host Proxy listening on 127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()

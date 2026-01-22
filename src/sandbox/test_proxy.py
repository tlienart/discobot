import os
import sys
import socket
import select
import threading

# Host keys
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")


def handle_client(client_socket):
    try:
        request = client_socket.recv(4096).decode("utf-8")
        if not request:
            return

        lines = request.split("\n")
        first_line = lines[0].split(" ")
        if len(first_line) < 2:
            return

        method = first_line[0]
        url = first_line[1]

        if method == "CONNECT":
            # Handle HTTPS tunnel
            host, port = url.split(":")
            log(f"CONNECT to {host}:{port}")

            # Here's the trick: We can't easily decrypt HTTPS without a CA.
            # But we can intercept the CONNECT and redirect it!
            # However, opencode expects a real SSL handshake.

            # Let's try another way.
            # We'll just bridge the connection but we can't inject.
            pass

    except:
        pass
    finally:
        client_socket.close()


def log(msg):
    print(msg, file=sys.stderr)


# Back to basics: If Base URL variables are ignored, maybe opencode
# uses a hardcoded provider list.
# But opencode has a 'debug config' command.
# Let's look at it.

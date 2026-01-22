import os
import sys
import socket
import threading
import select


def bridge_tcp_to_unix(tcp_port, unix_socket_path):
    # TCP server
    tcp_server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    tcp_server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    tcp_server.bind(("127.0.0.1", tcp_port))
    tcp_server.listen(10)
    print(f"[TCP Bridge] Listening on 127.0.0.1:{tcp_port} -> {unix_socket_path}")

    while True:
        try:
            client_conn, addr = tcp_server.accept()
            # print(f"[TCP Bridge] Accepted connection from {addr}")

            # Connect to Unix socket
            unix_conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            unix_conn.connect(unix_socket_path)

            def pipe(src, dst):
                try:
                    while True:
                        data = src.recv(4096)
                        if not data:
                            break
                        dst.sendall(data)
                except:
                    pass
                finally:
                    try:
                        src.close()
                    except:
                        pass
                    try:
                        dst.close()
                    except:
                        pass

            threading.Thread(
                target=pipe, args=(client_conn, unix_conn), daemon=True
            ).start()
            threading.Thread(
                target=pipe, args=(unix_conn, client_conn), daemon=True
            ).start()
        except Exception as e:
            print(f"[TCP Bridge] Error: {e}")
            break


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 proxy_bridge.py <port> <unix_socket_path>")
        sys.exit(1)

    port = int(sys.argv[1])
    path = sys.argv[2]
    bridge_tcp_to_unix(port, path)

import socket
import sys


def main():
    path = sys.argv[1]
    print(f"Connecting to {path}")
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(path)
    print("Connected!")
    s.close()


if __name__ == "__main__":
    main()

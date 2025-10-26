import signal

import psutil
import uvicorn

from app.core.config import settings


def kill_process_on_port(port: int) -> None:
    """Kill any process using the specified port."""
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            connections = proc.connections()
            for conn in connections:
                if conn.laddr.port == port:
                    print(
                        f"Found process {proc.info['name']} (PID: {proc.info['pid']}) using port {port}"
                    )
                    print("Killing process...")
                    proc.send_signal(signal.SIGTERM)
                    proc.wait(timeout=3)
                    print("Process killed successfully")
                    return
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.TimeoutExpired):
            continue


if __name__ == "__main__":
    # Check if port is in use and kill the process if needed
    kill_process_on_port(settings.PORT)

    uvicorn.run(
        "app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.RELOAD
    )

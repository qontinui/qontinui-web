import time

import psutil
import uvicorn

from app.core.config import settings


def kill_process_on_port(port: int) -> None:
    """Kill any process using the specified port."""
    killed_pids = set()

    # Find and kill all processes using the port
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            connections = proc.net_connections()
            for conn in connections:
                if hasattr(conn.laddr, "port") and conn.laddr.port == port:
                    pid = proc.info["pid"]
                    if pid in killed_pids:
                        continue

                    print(
                        f"Found process {proc.info['name']} (PID: {pid}) using port {port}"
                    )

                    # Kill child processes first (for uvicorn --reload)
                    try:
                        parent = psutil.Process(pid)
                        children = parent.children(recursive=True)
                        for child in children:
                            print(f"  Killing child process (PID: {child.pid})...")
                            child.kill()
                            killed_pids.add(child.pid)
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass

                    # Kill the main process with SIGKILL for immediate termination
                    print(f"Killing main process (PID: {pid})...")
                    try:
                        proc.kill()  # SIGKILL instead of SIGTERM
                        proc.wait(timeout=5)
                        killed_pids.add(pid)
                        print(f"Process {pid} killed successfully")
                    except psutil.TimeoutExpired:
                        print(f"Process {pid} did not terminate, forcing...")
                        proc.kill()

        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.TimeoutExpired):
            continue

    if killed_pids:
        # Wait for the port to be freed
        print("Waiting for port to be freed...")
        time.sleep(1)


if __name__ == "__main__":
    # Check if port is in use and kill the process if needed
    kill_process_on_port(settings.PORT)

    reload_excludes = [
        "backup_migrations",
        ".venv",
        "htmlcov",
        "logs",
        "test-results",
        "uploads",
        "user_projects",
        "data",
        "terraform",
        "docs",
        "*.log",
        "*.pyc",
    ]

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.RELOAD,
        reload_excludes=reload_excludes if settings.RELOAD else None,
    )

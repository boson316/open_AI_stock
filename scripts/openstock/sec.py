import hashlib
import os
from pathlib import Path
import time
import threading
import httpx

_request_lock = threading.Lock()
_last_request = 0.0


class SECClient:
    """Sequential HTTPS client: 2 req/s, bounded retry, 24h verified cache."""
    def __init__(self, cache=Path(".cache/sec"), user_agent=None):
        self.user_agent = user_agent or os.environ.get("SEC_USER_AGENT", "")
        if "@" not in self.user_agent or "example.com" in self.user_agent:
            raise ValueError("Set SEC_USER_AGENT to application name and real contact email")
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)

    def get_bytes(self, url):
        global _last_request
        if not url.startswith(("https://data.sec.gov/", "https://www.sec.gov/")):
            raise ValueError("Only official SEC HTTPS sources are accepted")
        path = self.cache / (hashlib.sha256(url.encode()).hexdigest() + ".cache")
        if path.exists() and time.time() - path.stat().st_mtime < 86400:
            return path.read_bytes()
        with httpx.Client(headers={"User-Agent": self.user_agent, "Accept-Encoding": "gzip, deflate"}, timeout=40) as client:
            for attempt in range(4):
                try:
                    with _request_lock:
                        time.sleep(max(0, 0.5 - (time.monotonic() - _last_request)))
                        _last_request = time.monotonic()
                        response = client.get(url)
                except httpx.TimeoutException:
                    if attempt == 3:
                        raise
                    time.sleep(2 ** attempt)
                    continue
                if response.status_code in {429, 500, 502, 503, 504}:
                    time.sleep(2 ** attempt)
                    continue
                response.raise_for_status()
                tmp = path.with_suffix(".tmp")
                tmp.write_bytes(response.content)
                tmp.replace(path)
                return response.content
        raise RuntimeError(f"SEC retries exhausted: {url}")

    def get_json(self, url):
        import json
        return json.loads(self.get_bytes(url))

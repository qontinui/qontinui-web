import threading
from datetime import datetime


class TokenBlacklistService:
    def __init__(self):
        self._blacklist: set[str] = set()
        self._lock = threading.Lock()
        self._token_expiry: dict[str, datetime] = {}

    def blacklist_token(self, token_jti: str, expiry: datetime | None = None) -> bool:
        with self._lock:
            self._blacklist.add(token_jti)
            if expiry:
                self._token_expiry[token_jti] = expiry
            return True

    def is_blacklisted(self, token_jti: str) -> bool:
        with self._lock:
            return token_jti in self._blacklist

    def clean_expired_tokens(self) -> int:
        with self._lock:
            now = datetime.utcnow()
            expired_tokens = [
                jti
                for jti, expiry in self._token_expiry.items()
                if expiry and expiry < now
            ]

            for jti in expired_tokens:
                self._blacklist.discard(jti)
                del self._token_expiry[jti]

            return len(expired_tokens)

    def get_blacklist_size(self) -> int:
        with self._lock:
            return len(self._blacklist)

    def clear_all(self) -> None:
        with self._lock:
            self._blacklist.clear()
            self._token_expiry.clear()


token_blacklist_service = TokenBlacklistService()

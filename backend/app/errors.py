class KostatsError(Exception):
    """Base exception for expected application errors."""


class ImportError(KostatsError):
    """Raised when a database snapshot cannot be imported."""


class UnsupportedSchemaError(KostatsError):
    """Raised when a SQLite database is not a supported KOReader stats DB."""


class BackupError(KostatsError):
    """Raised when a recovery backup cannot be created or restored."""

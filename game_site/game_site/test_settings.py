"""
Test settings for the Set Game Project.
These settings extend the main settings but disable HTTPS redirects for tests.
"""

from .settings import *  # noqa

# Disable SSL/HTTPS settings for tests
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Print information about the test environment
print("Using TEST settings - SSL redirects disabled")

# Use in-memory SQLite database for tests
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# Enable debug for tests
DEBUG = True

import pytest
import os
import sys
from importlib import reload
import asyncio
from typing import cast
import uvloop

# Docker-specific source code workaround
if os.getenv("RUNNING_IN_DOCKER"):

    @pytest.fixture(autouse=True, scope="session")
    def reload_modules():
        """Reload modules to ensure fresh state in Docker"""
        for module in list(sys.modules.values()):
            if module and getattr(module, "__file__", None):
                try:
                    reload(module)
                except (ImportError, AttributeError, TypeError):
                    pass


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test case."""
    try:
        loop = cast(asyncio.AbstractEventLoop, uvloop.new_event_loop())
    except (ImportError, AttributeError):
        loop = cast(asyncio.AbstractEventLoop, asyncio.new_event_loop())
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
def event_loop_policy() -> None:
    """Set the event loop policy for the test session."""
    try:
        asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
    except (ImportError, RuntimeError):
        pass

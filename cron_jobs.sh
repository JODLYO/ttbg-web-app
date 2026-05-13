#!/bin/bash
export DJANGO_SETTINGS_MODULE=game_site.settings
export DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY}"

/usr/local/bin/python /app/game_site/manage.py cleanup_lobbies
/usr/local/bin/python /app/game_site/manage.py cleanup_players
/usr/local/bin/python /app/game_site/manage.py cleanup_sessions
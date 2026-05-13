#!/bin/bash

export DJANGO_SETTINGS_MODULE=game_site.settings

python manage.py migrate

python manage.py collectstatic --noinput

# Seed game data
python manage.py seed_set_cards
python manage.py seed_ditf_cards
python manage.py seed_hive_pieces

# Start Daphne server with logging
exec daphne -b 0.0.0.0 -p 8000 game_site.asgi:application > daphne.log 2>&1
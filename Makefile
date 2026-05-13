.PHONY: test lint format

test:
	cd game_site && poetry run pytest . && poetry run ruff check

lint:
	cd game_site && poetry run mypy .

format:
	poetry run ruff format

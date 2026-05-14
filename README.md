
# Board Game Site

A web application built with Django for playing online multiplayer board games.

## Getting Started

### Prerequisites

- Docker (recommended for easy setup)
- Python 3.10
- Poetry

### Environment Variables

Create a `.env` file in the project root with the following variables:

```
DJANGO_SECRET_KEY=your-secret-key
DB_NAME=board_game_db
DB_USER=board_game_user
DB_PASSWORD=your-db-password
```

### Running with Docker

1. Create the `.env` file as described above.

2. Build and start the containers:
    ```bash
    docker compose up --build
    ```

3. The app will be available at [http://127.0.0.1:8000](http://127.0.0.1:8000).

### Running Locally (without Docker)

1. Install and start PostgreSQL 16 (via your system's package manager or [postgresql.org](https://www.postgresql.org/download/)).

2. Create the database and user:
    ```bash
    psql postgres
    ```
    ```sql
    CREATE DATABASE board_game_db;
    CREATE USER board_game_user WITH PASSWORD 'your-db-password';
    ALTER DATABASE board_game_db OWNER TO board_game_user;
    \q
    ```

3. Install dependencies:
    ```bash
    poetry install
    ```

4. Update `settings.py` for local development:
    ```python
    DEBUG = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = False
    SESSION_COOKIE_SECURE = False
    CSRF_COOKIE_SECURE = False
    ```

5. Run migrations and start the server from `board_game_site/game_site`:
    ```bash
    python manage.py migrate
    python manage.py runserver
    ```

6. Visit [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.

### Running Tests

From `board_game_site/game_site` run:
```bash
pytest .
```
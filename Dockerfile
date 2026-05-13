FROM python:3.10-slim
ARG INSTALL_TYPE

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

ENV SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/v0.2.45/supercronic-linux-amd64 \
    SUPERCRONIC_SHA1SUM=e894b193bea75a5ee644e700c59e30eedc804cf7 \
    SUPERCRONIC=supercronic-linux-amd64

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/* && \
    curl -fsSLO "$SUPERCRONIC_URL" && \
    echo "${SUPERCRONIC_SHA1SUM}  ${SUPERCRONIC}" | sha1sum -c - && \
    chmod +x "$SUPERCRONIC" && \
    mv "$SUPERCRONIC" "/usr/local/bin/${SUPERCRONIC}" && \
    ln -s "/usr/local/bin/${SUPERCRONIC}" /usr/local/bin/supercronic

RUN pip3 install --no-cache-dir poetry && \
    poetry config virtualenvs.create false

COPY pyproject.toml poetry.lock* ./

RUN if [ "$INSTALL_TYPE" = "main" ]; then \
      poetry install --only main --no-interaction; \
    else \
      poetry install --no-interaction; \
    fi

COPY . .

RUN useradd --no-create-home --shell /bin/false appuser && \
    chown -R appuser /app && \
    chmod +x /app/cron_jobs.sh && \
    chmod +x /app/game_site/start_daphne.sh

USER appuser

EXPOSE 8000

WORKDIR /app/game_site

CMD ["./start_daphne.sh"]
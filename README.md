# Steam Web Dashboard (Demo)

Demo dashboard that fetches Steam game data (Steam Store + SteamSpy + Steam Web API current players) using:

- Python fetcher module
- Apache Airflow DAG (hourly)
- FastAPI backend API
- TailwindCSS + Chart.js frontend

## Important

This is a **demo** project. The Steam API key is embedded in code because you requested it. Do not do this in production.

## What it collects

- Game name
- Price (original + final/discount)
- Genre
- Header image
- Current online players
- Discount status

## Project structure

- `backend/steam_fetcher.py` Fetch/normalize + cache write
- `backend/main.py` FastAPI API + serves frontend
- `dags/steam_dashboard_dag.py` Airflow DAG (hourly)
- `frontend/` Static UI
- `data/steam_cache.json` Cache output (created at runtime)

## Local run (quick)

### 1) Install

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### 2) Run the API server

```bash
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Open:
- http://127.0.0.1:8000

### 3) Run one manual fetch (optional)

```bash
python -m backend.steam_fetcher
```

### 4) Airflow (optional)

Airflow is heavy; for demo you can skip it and use the manual fetch above.

If you want Airflow scheduling:

```bash
set AIRFLOW_HOME=%CD%\airflow
airflow db init
airflow users create --username admin --password admin --firstname admin --lastname admin --role Admin --email admin@example.com
set AIRFLOW__CORE__LOAD_EXAMPLES=False
set AIRFLOW__CORE__DAGS_FOLDER=%CD%\dags
airflow standalone
```

Then open the Airflow UI, enable `steam_game_dashboard_hourly`.

## Notes

- Cache file is written to `data/steam_cache.json`.
- The frontend calls the FastAPI endpoints under `/api/*`.

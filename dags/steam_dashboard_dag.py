from __future__ import annotations

from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.python import PythonOperator


def _run_fetch() -> None:
    from backend.steam_fetcher import fetch_and_write

    fetch_and_write(top_n=10000)


default_args = {
    "owner": "steam-dashboard",
    "depends_on_past": False,
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
}

with DAG(
    dag_id="steam_game_dashboard_hourly",
    default_args=default_args,
    description="Fetch Steam Store + SteamSpy + current players hourly and write JSON cache",
    schedule="@hourly",
    start_date=datetime(2025, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["steam", "demo"],
) as dag:
    fetch_task = PythonOperator(
        task_id="fetch_and_cache",
        python_callable=_run_fetch,
    )

    fetch_task

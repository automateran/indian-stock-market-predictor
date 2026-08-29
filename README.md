# India Trading Analyst

Flask website for an Indian stock market dashboard with Yahoo Finance data, transparent 20-session consensus signals, search/filter controls, stock detail charts, and a methodology page.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000

## Production

```bash
gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 60 app:app
```

## Routes

- `/` — Market overview
- `/stocks` — Stock screener
- `/learn` — Consensus methodology
- `/api/market` — Market JSON data
- `/api/market/<symbol>` — Single stock JSON data
- `/api/healthz` — Health check

Yahoo Finance may temporarily rate-limit requests. When that happens, the UI clearly marks its demo fallback data.

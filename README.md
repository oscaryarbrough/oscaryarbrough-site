# oscaryarbrough.com

Personal site: economics, music, teaching, travel, and one secret page.

Static HTML/CSS/JS in `site/`, served by a minimal Flask app (`app.py`) so the
existing Render web service keeps working unchanged. No build step, no trackers,
no external requests at runtime. All images are stripped of EXIF/GPS metadata.

Old URLs (`/lessons`, `/housecat`, `/altitude-sickness`) redirect into the new
Music page.

Design: a constrained editorial column ("variation 11" of the 2026 redesign).
World-map outline on the Travel page: amCharts.

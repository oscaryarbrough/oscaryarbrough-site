# oscaryarbrough.com

Personal site: economics, music, drum lessons — and a hidden video game.

**The visible site.** A constrained editorial column: About (a portrait with a
pixelation slider and a live age counter), Experience, Studies, and Music
(current and past bands, lesson booking, and a summer of West African drumming
in Ghana).

**The hidden part.** Clicking the head in the masthead does not go where the
nav goes. Behind it is **GRAND THEFT GROOVE** — a three-act browser game about
a villain named Ozzy Shizzle who stole the world's groove and locked every
song on earth to 60 bpm of objectively terrible country music: an 8-bit
dungeon, a fake operating system with a password problem, and a galaga-style
final boss in deep space. All of it is hand-rolled canvas and Web Audio — no
engines, no libraries. No further spoilers here; go click the head.

**Stack.** Static HTML/CSS/JS in `site/`, served by a minimal Flask app
(`app.py`) so the existing Render web service keeps working unchanged. Clean
URLs (`/music` is canonical; old `.html` addresses 301), legacy redirects
(`/lessons`, `/housecat`, `/altitude-sickness` land on Music), and shared
assets under `/_shared/` with week-long cache headers. No build step, no
trackers, no analytics, no external requests at runtime. Images are stripped
of EXIF/GPS metadata.

Run it locally:

```
pip install -r requirements.txt
python app.py        # http://127.0.0.1:5000
```

World-map outline on the old room page: amCharts.

import os

from flask import Flask, redirect, send_from_directory

app = Flask(__name__, static_folder=None)

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")

PAGES = {"index", "experience", "studies", "music", "other"}

# Old-site URLs that may still be linked or bookmarked elsewhere.
LEGACY = {
    "lessons": "/music.html#lessons",
    "travel": "/other.html",
    "housecat": "/music.html",
    "altitude-sickness": "/music.html",
}


@app.route("/")
def home():
    return send_from_directory(SITE, "index.html")


@app.route("/<name>.html")
def page(name):
    if name == "travel":
        return redirect("/other.html", code=301)
    if name not in PAGES:
        return send_from_directory(SITE, "index.html"), 404
    return send_from_directory(SITE, f"{name}.html")


@app.route("/<name>")
def bare(name):
    if name in LEGACY:
        return redirect(LEGACY[name], code=301)
    if name in PAGES:
        return redirect(f"/{name}.html", code=301)
    if name in {"style.css", "script.js", "game.js", "game.css"}:
        return send_from_directory(SITE, name)
    return send_from_directory(SITE, "index.html"), 404


@app.route("/_shared/<path:asset>")
def shared(asset):
    return send_from_directory(os.path.join(SITE, "_shared"), asset)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)))

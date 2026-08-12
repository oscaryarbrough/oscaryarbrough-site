import os

from flask import Flask, redirect, send_from_directory

app = Flask(__name__, static_folder=None)

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")

PAGES = {"experience", "studies", "music", "other",
         "secret", "secret-2", "secret-4"}

FILES = {"style.css", "script.js", "game.js", "game.css", "portal.js"}

# Old-site URLs that may still be linked or bookmarked elsewhere.
LEGACY = {
    "lessons": "/music#lessons",
    "travel": "/other",
    "housecat": "/music",
    "altitude-sickness": "/music",
}


@app.route("/")
def home():
    return send_from_directory(SITE, "index.html")


@app.route("/<name>.html")
def html_page(name):
    # The extensionless addresses are canonical now; .html permanently
    # redirects so old links and bookmarks keep working.
    if name == "index":
        return redirect("/", code=301)
    if name == "travel":
        return redirect("/other", code=301)
    if name in PAGES:
        return redirect(f"/{name}", code=301)
    return send_from_directory(SITE, "index.html"), 404


@app.route("/<name>")
def bare(name):
    if name == "index":
        return redirect("/", code=301)
    if name in LEGACY:
        return redirect(LEGACY[name], code=301)
    if name in PAGES:
        return send_from_directory(SITE, f"{name}.html")
    if name in FILES:
        return send_from_directory(SITE, name)
    return send_from_directory(SITE, "index.html"), 404


@app.route("/_shared/<path:asset>")
def shared(asset):
    # A week of caching lets browsers and Cloudflare's edge hold the photos,
    # posters, and clips instead of re-pulling them from this dyno each visit.
    return send_from_directory(
        os.path.join(SITE, "_shared"), asset, max_age=604800)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)))

from flask import Flask, render_template

app = Flask(__name__)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/lessons")
def lessons():
    return render_template("lessons.html")

@app.route("/housecat")
def housecat():
    return render_template("housecat.html")

@app.route("/altitude-sickness")
def altitude_sickness():
    return render_template("altitudesickness.html")
"""Crop Match app (NASA Space Apps, "Field Shift"). Start with:  streamlit run app.py

The interface is the team's design (ui/index.html + ui/ui.css + ui/ui.js), shown full screen.
Every number comes from the model: export_ui_data.py runs scoring.py and saves data/ui_data.json.
"""
import base64
import json
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

from config import DATA_DIR

HERE = Path(__file__).parent
UI = HERE / "ui"
PHOTOS = HERE / "assets" / "photos"

LOGO = HERE / "assets" / "logo.png"
st.set_page_config(page_title="Crop Match - Field Shift", page_icon=str(HERE / "assets" / "logo_64.png"), layout="wide",
                   initial_sidebar_state="collapsed")

# Hide Streamlit's own chrome and let the designed page fill the whole window.
st.markdown("""<style>
#MainMenu, footer, header, [data-testid="stHeader"], [data-testid="stToolbar"], [data-testid="stDecoration"],
[data-testid="stStatusWidget"], [data-testid="stSidebar"], .stDeployButton, .stAppDeployButton { display: none !important; }
html, body, .stApp { background: #ece4d2; overflow: hidden; }
.block-container, [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: 100% !important; }
[data-testid="stVerticalBlock"] { gap: 0 !important; }
iframe { display: block; width: 100vw !important; height: 100vh !important; height: 100dvh !important; border: 0; }
</style>""", unsafe_allow_html=True)


def load_photos():
    """Crop photos (assets/photos/<crop>.jpg) as data URIs + their licence credits."""
    credits_file = PHOTOS / "credits.json"
    if not credits_file.exists():
        return {}
    photos = {}
    for c in json.loads(credits_file.read_text()):
        path = PHOTOS / c["file"]
        if path.exists():
            photos[c["crop"]] = {
                "src": "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode(),
                "credit": f'Photo: {c["creator"]}, {c["license"]}',
                "short": c["license"], "source": c["source"]}
    return photos


@st.cache_data
def build_page(version):   # `version` (file times) is part of the cache key
    """Fill the HTML template with the CSS, JS, model results and photos."""
    data_file = DATA_DIR / "ui_data.json"
    if not data_file.exists():          # first run: export the model results
        import export_ui_data
        export_ui_data.main()
    safe = lambda text: text.replace("</", "<\\/")   # keep JSON from closing the <script> tag
    html = (UI / "index.html").read_text()
    html = html.replace("/*CSS*/", (UI / "ui.css").read_text())
    html = html.replace("{{DATA}}", safe(data_file.read_text()))
    html = html.replace("{{PHOTOS}}", safe(json.dumps(load_photos())))
    html = html.replace("{{LOGO}}", "data:image/png;base64," + base64.b64encode(LOGO.read_bytes()).decode())
    html = html.replace("/*JS*/", (UI / "ui.js").read_text())
    return html


# Rebuild the page whenever one of the files changes (their modification times are the cache key).
files = [UI / "index.html", UI / "ui.css", UI / "ui.js", DATA_DIR / "ui_data.json", PHOTOS / "credits.json", LOGO]
version = tuple(f.stat().st_mtime for f in files if f.exists())
components.html(build_page(version), height=820, scrolling=False)

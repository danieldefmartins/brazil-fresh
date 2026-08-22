#!/usr/bin/env python3
"""Build single-file index.html from index.src.html.
- <!--INLINE_JS path--> becomes an inline <script> with the file's contents.
- {{A:name}} becomes a data:image/webp;base64 URI for assets/name.webp
"""
import base64, pathlib, re

root = pathlib.Path(__file__).parent
src = (root / "index.src.html").read_text()

# The source keeps the previous scene implementation as a readable reference,
# but production ships only the continuous master-film version. Strip legacy
# markup before asset inlining so duplicate video/image data is never emitted.
src = re.sub(r"<!--LEGACY_HTML_START-->.*?<!--LEGACY_HTML_END-->", "", src, flags=re.S)
src = re.sub(r"/\*LEGACY_JS_START\*/.*?/\*LEGACY_JS_END\*/", "", src, flags=re.S)

def inline_js(m):
    p = root / m.group(1)
    return "<script>\n" + p.read_text() + "\n</script>"

src = re.sub(r"<!--INLINE_JS ([\w./-]+)-->", inline_js, src)

def inline_asset(m):
    p = root / "assets" / (m.group(1) + ".webp")
    b64 = base64.b64encode(p.read_bytes()).decode()
    return "data:image/webp;base64," + b64

src = re.sub(r"\{\{A:([\w-]+)\}\}", inline_asset, src)

def inline_video(m):
    p = root / "assets" / (m.group(1) + ".mp4")
    b64 = base64.b64encode(p.read_bytes()).decode()
    return "data:video/mp4;base64," + b64

src = re.sub(r"\{\{V:([\w-]+)\}\}", inline_video, src)

land = (root / "assets" / "landbits.txt").read_text().strip()
src = src.replace("{{LAND}}", land)

def inline_frames(m):
    d = root / "assets" / "seq" / m.group(1)
    if not d.is_dir():
        return "[]"
    uris = []
    for f in sorted(d.glob("*.webp")):
        uris.append('"data:image/webp;base64,' + base64.b64encode(f.read_bytes()).decode() + '"')
    return "[" + ",".join(uris) + "]"

src = re.sub(r"\{\{FRAMES:([\w-]+)\}\}", inline_frames, src)

out = root / "index.html"
out.write_text(src)
print(f"built index.html: {out.stat().st_size/1024:.0f} KB")

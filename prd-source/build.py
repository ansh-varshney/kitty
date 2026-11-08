"""Build the Kitty PRD PDF from Kitty-PRD.md (Markdown + Mermaid) with headless Chrome.

Usage:  python prd-source/build.py [output_dir]
Two passes: the first finds each section's page, the second fills the table of contents.
"""
import html
import re
import sys
from pathlib import Path

import pypdfium2 as pdfium
from markdown_it import MarkdownIt
from playwright.sync_api import sync_playwright

BASE = Path(__file__).parent
SRC = BASE / "Kitty-PRD.md"
VERSION = "1.15"
DATE = "8 Nov 2026"
OUT_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE.parent
OUT = OUT_DIR / f"Kitty-PRD-v{VERSION}.pdf"

PART_LABEL = {"0": "Start here", "A": "Big picture", "B": "Feature", "C": "Platform", "D": "Delivery", "E": "Appendix"}
PART_TITLE = {"A": "The big picture", "B": "Features", "C": "Platform mapping", "D": "Delivery", "E": "Appendix"}
PART_BLURB = {
    "A": "The problem, the hackathon fit, the solution on one page, users, goals, core concepts, the engine, the architecture and the trust model.",
    "B": "One section per feature. Each has plain words, why it exists, the flow, edge cases and numbered requirements.",
    "C": "How Kitty lands on PayPal and Gemini: every API call, the agent design, the data model, the stack and the repo.",
    "D": "The build plan, how each judging criterion is met, risks, locked decisions, open questions and acceptance tests.",
    "E": "The cat dictionary, references and the change log.",
}

FOOTER = (
    '<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5px;color:#7A76A8;'
    'padding:0 16mm;display:flex;justify-content:space-between;">'
    f'<span>Kitty · Product Requirements Document · v{VERSION} · {DATE}</span>'
    '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
)

# ---------------------------------------------------------------- markdown
md = MarkdownIt("commonmark", {"html": True}).enable("table").enable("strikethrough")


def render_fence(self, tokens, idx, options, env):
    tok = tokens[idx]
    code = html.escape(tok.content)
    if tok.info.strip() == "mermaid":
        return f'<div class="diagram"><pre class="mermaid">{code}</pre></div>\n'
    return f'<pre class="code">{code}</pre>\n'


md.add_render_rule("fence", render_fence)


def parse_structure(text: str):
    body = text[text.index("## §0"):]
    parts = [{"key": "0", "title": "Start here", "sections": []}]
    cur_part, cur_sec, in_fence = parts[0], None, False
    for line in body.splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
        if not in_fence and line.startswith("# "):
            m = re.match(r"^# (?:Part ([A-E]):.*|Appendix ([A-E]))\s*$", line)
            key = m.group(1) or m.group(2)
            cur_part = {"key": key, "title": PART_TITLE[key], "sections": []}
            parts.append(cur_part)
            cur_sec = None
            continue
        if not in_fence and line.startswith("## "):
            m = re.match(r"^(§0|[A-E]\d+)\s+(.*)$", line[3:].strip())
            cur_sec = {"id": m.group(1).lstrip("§"), "title": m.group(2), "md": []}
            cur_part["sections"].append(cur_sec)
            continue
        if not in_fence and line.strip() == "---":
            continue
        if cur_sec is not None:
            cur_sec["md"].append(line)
    return parts


def kw(s: str) -> str:
    """Highlight MUST / SHOULD / MAY in text nodes only."""
    out = []
    for piece in re.split(r"(<[^>]+>)", s):
        if piece.startswith("<"):
            out.append(piece)
            continue
        out.append(re.sub(
            r"\b(MUST NOT|MUST|SHOULD|MAY)\b",
            lambda m: f'<span class="kw k-{m.group(1).split()[0].lower()}">{m.group(1)}</span>',
            piece,
        ))
    return "".join(out)


BOX = {"in plain words": "plain", "why it exists": "why", "requirements": "reqs", "under the hood": "tech"}


def boxify(h: str) -> str:
    out = []
    for piece in re.split(r"(?=<h3>)", h):
        m = re.match(r"<h3>(.*?)</h3>", piece, re.S)
        if not m:
            out.append(piece)
            continue
        title, rest = m.group(1), piece[m.end():]
        key = re.sub(r"<[^>]+>", "", title).strip().lower()
        cls = next((c for k, c in BOX.items() if key.startswith(k)), None)
        if cls:
            out.append(f'<div class="box {cls}"><h4>{title}</h4>{rest}</div>')
        else:
            out.append(piece)
    return "".join(out)


def section_html(part_key: str, sec: dict) -> str:
    body = md.render("\n".join(sec["md"]))
    body = boxify(body)
    body = re.sub(r"<li><strong>(N?FR-[A-Z]+-\d+|NFR-\d+)</strong>",
                  r'<li class="req"><strong class="rid">\1</strong>', body)
    body = re.sub(r'<li class="req">.*?</li>', lambda m: kw(m.group(0)), body, flags=re.S)
    body = re.sub(r"<td>((?:AT|FR|NFR)-[A-Z0-9-]+|R\d+)</td>", r'<td class="nw">\1</td>', body)
    label = PART_LABEL["0" if sec["id"] == "0" else part_key]
    return (f'<section class="sec page-start" id="s-{sec["id"]}">'
            f'<div class="kicker">§{sec["id"]} · {label}</div>'
            f'<h2>{html.escape(sec["title"])}</h2>{body}</section>\n')


def part_html(part: dict) -> str:
    if part["key"] == "0":
        return ""
    items = "".join(f'<li><span>{s["id"]}</span>{html.escape(s["title"])}</li>' for s in part["sections"])
    num = "APPENDIX" if part["key"] == "E" else f"PART {part['key']}"
    return (f'<section class="part page-start"><div class="num">{num}</div>'
            f'<h1>{part["title"]}</h1><p>{PART_BLURB[part["key"]]}</p><ol>{items}</ol></section>\n')


def toc_html(parts, pages) -> str:
    rows = []
    for part in parts:
        grp = "Start here" if part["key"] == "0" else (
            "Appendix" if part["key"] == "E" else f"Part {part['key']} · {part['title']}")
        rows.append(f'<div class="grp">{grp}</div>')
        for s in part["sections"]:
            pg = pages.get(s["id"], "00")
            rows.append(f'<div class="row"><span class="id">{s["id"]}</span>'
                        f'<span class="t">{html.escape(s["title"])}</span>'
                        f'<span class="dots"></span><span class="pg">{pg}</span></div>')
    return f'<section class="toc page-start"><h2>What\'s inside</h2>{"".join(rows)}</section>\n'


# ---------------------------------------------------------------- page chrome
HEAD = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Kitty PRD</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{
  --night:#1E1B4B; --ink:#232046; --ink-2:#4A4580; --muted:#7A76A8; --line:#E4E1F2;
  --accent:#5B4FD6; --accent-soft:#EFEDFD; --amber:#A8650F; --amber-soft:#FFF4E0;
  --mint:#23794F; --mint-soft:#E3F5EA; --coral:#B4452A; --coral-soft:#FDE8E2;
  --code-bg:#F4F2FB; --cream:#FFFBF4;
  --display:"Fraunces",Georgia,serif; --body:"Inter","Segoe UI",Arial,sans-serif; --mono:"JetBrains Mono",Consolas,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:var(--ink)}
body{font-family:var(--body);font-size:9.4pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4{font-family:var(--display);color:var(--ink);margin:0;line-height:1.15}
h2{font-size:21pt;font-weight:700;margin:1mm 0 4mm}
h3{font-size:12pt;font-weight:650;margin:5mm 0 2mm;color:var(--ink)}
h4{font-family:var(--mono);font-size:7.8pt;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-bottom:1.6mm}
p{margin:0 0 2.2mm} ul,ol{margin:0 0 3mm;padding-left:5.5mm} li{margin-bottom:.8mm}
li,td,p{overflow-wrap:anywhere}
strong,b{font-weight:650;color:var(--ink)}
a{color:var(--accent);text-decoration:none}
blockquote{margin:0 0 4mm;padding:3mm 4.5mm;border-left:1.2mm solid var(--amber);background:var(--amber-soft);border-radius:0 2mm 2mm 0;font-size:10pt;color:var(--ink)}
blockquote p:last-child{margin:0}
code{font-family:var(--mono);font-size:8.2pt;background:var(--code-bg);color:var(--ink-2);padding:.2mm 1.1mm;border-radius:1mm}
pre.code{font-family:var(--mono);font-size:7.8pt;line-height:1.5;background:var(--code-bg);color:var(--ink-2);border-radius:2mm;padding:3.5mm 4mm;margin:0 0 3.5mm;white-space:pre-wrap;break-inside:avoid}
pre.code code{background:none;padding:0}
.page-start{break-before:page}
.kicker{font-family:var(--mono);font-size:8pt;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.08em}
table{border-collapse:collapse;width:100%;font-size:8.4pt;margin:0 0 3.5mm}
th,td{text-align:left;vertical-align:top;padding:1.3mm 2mm;border-bottom:.3mm solid var(--line)}
th{font-family:var(--mono);font-size:7.2pt;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;background:var(--accent-soft)}
tr{break-inside:avoid}
.box{border-radius:2.5mm;padding:3.5mm 4.5mm 1.5mm;margin:0 0 4mm}
.box > *:last-child{margin-bottom:2mm}
.plain{background:var(--accent-soft);break-inside:avoid} .plain h4{color:var(--accent)}
.why{background:var(--amber-soft);break-inside:avoid} .why h4{color:var(--amber)}
.tech{background:var(--mint-soft);box-decoration-break:clone;-webkit-box-decoration-break:clone} .tech h4{color:var(--mint)}
.reqs{border:.35mm solid var(--line);background:#fff} .reqs h4{color:var(--ink-2)}
.reqs ul,ul:has(> li.req){list-style:none;padding-left:0}
li.req{padding:1mm 0;border-bottom:.25mm dashed var(--line);break-inside:avoid;margin:0}
li.req:last-child{border-bottom:none}
.rid{font-family:var(--mono);font-size:7.8pt;color:var(--accent);margin-right:1.5mm;font-weight:600}
.kw{font-family:var(--mono);font-size:7pt;font-weight:600;padding:0 .9mm;border-radius:.8mm}
.k-must{background:var(--coral-soft);color:var(--coral)} .k-should{background:var(--amber-soft);color:var(--amber)} .k-may{background:var(--mint-soft);color:var(--mint)}
.diagram{border:.35mm solid var(--line);border-radius:2.5mm;padding:3mm;margin:0 0 4mm;break-inside:avoid;text-align:center;background:#FCFBFF}
.diagram pre.mermaid{margin:0;font-family:var(--body);background:transparent}
.diagram svg{max-width:100%!important;height:auto;max-height:190mm}
/* cover */
.cover{height:258mm;display:flex;flex-direction:column;justify-content:space-between}
.cover .night{border-radius:4mm;overflow:hidden;background:var(--night)}
.cover .night svg{display:block;width:100%;height:auto}
.cover .eyebrow{font-family:var(--mono);font-size:8.6pt;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;font-weight:600;margin-top:8mm}
.cover h1{font-size:64pt;font-weight:800;letter-spacing:-.01em;margin-top:2mm}
.cover .sub{font-family:var(--display);font-size:17pt;font-weight:600;color:var(--ink-2);margin-top:1mm}
.cover .tag{font-size:11.5pt;color:var(--ink-2);max-width:160mm;margin-top:5mm;line-height:1.5}
.pillars{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-top:8mm}
.pillars div{border-top:1mm solid var(--accent);padding-top:2.5mm}
.pillars div:nth-child(2){border-color:var(--amber)} .pillars div:nth-child(3){border-color:var(--mint)} .pillars div:nth-child(4){border-color:var(--coral)}
.pillars b{font-family:var(--display);font-size:11.5pt;display:block;margin-bottom:.8mm}
.pillars span{font-size:8.6pt;color:var(--ink-2)}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm 6mm;border-top:.35mm solid var(--line);padding-top:5mm;margin-top:8mm}
.meta div span{display:block;font-family:var(--mono);font-size:7.2pt;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.meta div b{font-size:9.6pt;font-weight:600}
/* part divider */
.part{height:250mm;display:flex;flex-direction:column;justify-content:center}
.part .num{font-family:var(--mono);font-size:10.5pt;color:var(--accent);letter-spacing:.12em;font-weight:600}
.part h1{font-size:42pt;font-weight:800;margin:4mm 0 5mm}
.part p{font-size:12pt;color:var(--ink-2);max-width:145mm}
.part ol{list-style:none;padding:0;margin-top:7mm;columns:2;column-gap:10mm;font-size:10pt;color:var(--ink-2)}
.part ol li{break-inside:avoid;margin-bottom:1.6mm;display:flex;gap:2mm}
.part ol li span{font-family:var(--mono);font-size:8.6pt;color:var(--accent);width:9mm;flex:none;padding-top:.4mm}
td.nw{white-space:nowrap;font-family:var(--mono);font-size:7.8pt;color:var(--accent)}
/* toc */
.toc h2{margin-bottom:3mm}
.toc .grp{font-family:var(--mono);font-size:7.6pt;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.07em;margin:2.4mm 0 .6mm}
.toc .row{display:flex;align-items:baseline;gap:2mm;font-size:8.6pt;line-height:1.3;padding:.15mm 0}
.toc .row .id{font-family:var(--mono);font-size:8pt;color:var(--muted);width:9mm;flex:none}
.toc .row .t{flex:none;max-width:150mm}
.toc .row .dots{flex:1;border-bottom:.3mm dotted var(--line);transform:translateY(-1mm)}
.toc .row .pg{font-family:var(--mono);font-size:8.4pt;color:var(--ink-2);width:8mm;text-align:right;flex:none}
</style></head><body>
"""

COVER_SVG = r"""<svg viewBox="0 0 640 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Two kittens on a rooftop at night with a kitty jar between them">
  <defs><radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFE7A8" stop-opacity=".55"/><stop offset="100%" stop-color="#FFE7A8" stop-opacity="0"/></radialGradient></defs>
  <rect width="640" height="230" fill="#1E1B4B"/>
  <circle cx="120" cy="62" r="60" fill="url(#glow)"/><circle cx="120" cy="62" r="24" fill="#FFE7A8"/><circle cx="131" cy="55" r="21" fill="#1E1B4B" opacity=".9"/>
  <g fill="#FFFFFF" opacity=".75"><circle cx="40" cy="30" r="1.4"/><circle cx="210" cy="24" r="1.2"/><circle cx="260" cy="70" r="1"/><circle cx="330" cy="30" r="1.5"/><circle cx="560" cy="40" r="1.3"/><circle cx="600" cy="90" r="1"/><circle cx="470" cy="22" r="1.1"/><circle cx="20" cy="110" r="1"/></g>
  <path d="M0 230 V168 L45 140 L90 168 V230 Z" fill="#2B2766"/>
  <path d="M80 230 V150 H200 V230 Z" fill="#26225C"/>
  <path d="M190 230 V176 L250 132 L310 176 V230 Z" fill="#2B2766"/>
  <path d="M300 230 V152 H560 V230 Z" fill="#221E55"/>
  <path d="M550 230 V170 L595 138 L640 170 V230 Z" fill="#2B2766"/>
  <g fill="#FFC861" opacity=".85"><rect x="100" y="168" width="10" height="13" rx="1"/><rect x="160" y="190" width="10" height="13" rx="1"/><rect x="238" y="182" width="9" height="12" rx="1"/><rect x="330" y="176" width="11" height="14" rx="1"/><rect x="520" y="184" width="11" height="14" rx="1"/><rect x="590" y="186" width="9" height="12" rx="1"/></g>
  <rect x="300" y="149" width="260" height="5" fill="#2F2A73"/>
  <g fill="#0F0D2E">
    <g transform="translate(392,127)"><ellipse cx="0" cy="0" rx="15" ry="21"/><circle cx="7" cy="-23" r="11"/><polygon points="0,-29 2,-42 8,-32"/><polygon points="9,-32 15,-42 17,-28"/><path d="M-11,16 C-32,18 -36,-4 -24,-12" stroke="#0F0D2E" stroke-width="5" fill="none" stroke-linecap="round"/></g>
    <g transform="translate(488,127) scale(-1,1)"><ellipse cx="0" cy="0" rx="15" ry="21"/><circle cx="7" cy="-23" r="11"/><polygon points="0,-29 2,-42 8,-32"/><polygon points="9,-32 15,-42 17,-28"/><path d="M-11,16 C-32,18 -36,-4 -24,-12" stroke="#0F0D2E" stroke-width="5" fill="none" stroke-linecap="round"/></g>
  </g>
  <circle cx="440" cy="136" r="22" fill="url(#glow)"/>
  <rect x="430" y="125" width="20" height="24" rx="4" fill="none" stroke="#FFE7A8" stroke-width="1.6"/>
  <rect x="428" y="121" width="24" height="5" rx="1.5" fill="#FFE7A8"/>
  <g fill="#FFC861"><circle cx="436" cy="144" r="3.2"/><circle cx="444" cy="144" r="3.2"/><circle cx="440" cy="138" r="3.2"/></g>
  <g fill="#FFE7A8" opacity=".9"><circle cx="428" cy="88" r="2.4"/><circle cx="440" cy="84" r="2.4"/><circle cx="452" cy="88" r="2.4"/></g>
</svg>"""

COVER = f"""<section class="cover"><div>
  <div class="night">{COVER_SVG}</div>
  <div class="eyebrow">Product Requirements Document · v{VERSION}</div>
  <h1>Kitty</h1>
  <div class="sub">Friends talk. Kittens handle the money.</div>
  <p class="tag">Kitty helps friends plan, pay and save together without fronting money, chasing debts or overspending. Every user adopts a kitten: a personal AI agent that speaks for them in their friend groups, keeps their budget private, and moves money on PayPal only within the rules they set.</p>
  <div class="pillars">
    <div><b>Commit first</b><span>Friends paw in; nobody is charged until enough are in</span></div>
    <div><b>Nobody fronts</b><span>The booker is paid before booking</span></div>
    <div><b>Nobody chases</b><span>Kittens track and settle who owes whom</span></div>
    <div><b>No overspending</b><span>A private fun budget, and saving together</span></div>
  </div></div>
  <div class="meta">
    <div><span>Version</span><b>{VERSION} · in build</b></div>
    <div><span>Date</span><b>{DATE}</b></div>
    <div><span>Owner</span><b>Ansh Varshney (solo)</b></div>
    <div><span>Hackathon</span><b>Build What's Next with PayPal and AI</b></div>
    <div><span>Deadline</span><b>12 Nov 2026, 12:00 PM PT</b></div>
    <div><span>Stack</span><b>PayPal sandbox · Gemini · Render</b></div>
  </div>
</section>
"""

TAIL = r"""<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>
(async function () {
  try {
    mermaid.initialize({
      startOnLoad: false, theme: 'base', securityLevel: 'loose',
      themeVariables: {
        fontFamily: 'Inter, Segoe UI, Arial, sans-serif', fontSize: '13px',
        primaryColor: '#EFEDFD', primaryTextColor: '#232046', primaryBorderColor: '#5B4FD6',
        secondaryColor: '#E3F5EA', tertiaryColor: '#FFF4E0', lineColor: '#7A72D9',
        textColor: '#232046', mainBkg: '#EFEDFD', nodeBorder: '#5B4FD6', clusterBkg: '#FAF9FF',
        clusterBorder: '#C9C3F2', titleColor: '#4A4580', edgeLabelBackground: '#FFFFFF',
        actorBkg: '#EFEDFD', actorBorder: '#5B4FD6', actorTextColor: '#232046', signalColor: '#4A4580',
        signalTextColor: '#232046', noteBkgColor: '#FFF4E0', noteBorderColor: '#A8650F', noteTextColor: '#232046',
        labelBoxBkgColor: '#EFEDFD', sequenceNumberColor: '#FFFFFF', background: '#FFFFFF'
      },
      flowchart: { curve: 'basis', htmlLabels: true, useMaxWidth: true, nodeSpacing: 26, rankSpacing: 36, padding: 10 },
      sequence: { useMaxWidth: true, mirrorActors: false, actorMargin: 40 }
    });
    await document.fonts.ready;
    await mermaid.run({ querySelector: 'pre.mermaid' });
    window.__diagrams = document.querySelectorAll('.diagram svg').length;
  } catch (e) { window.__mermaidError = String(e && e.message || e); }
  window.__mermaidDone = true;
})();
</script></body></html>"""


def build_html(parts, pages) -> str:
    chunks = [HEAD, COVER, toc_html(parts, pages)]
    for part in parts:
        chunks.append(part_html(part))
        for sec in part["sections"]:
            chunks.append(section_html(part["key"], sec))
    chunks.append(TAIL)
    return "".join(chunks)


def render(doc: str, pdf_path: Path) -> dict:
    tmp = BASE / "_build.html"
    tmp.write_text(doc, encoding="utf-8")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 794, "height": 1123})
        page.goto(tmp.as_uri(), wait_until="networkidle", timeout=180000)
        page.wait_for_function("window.__mermaidDone === true", timeout=180000)
        info = page.evaluate("({err: window.__mermaidError || null, diagrams: window.__diagrams,"
                             " blocks: document.querySelectorAll('pre.mermaid').length})")
        page.pdf(path=str(pdf_path), format="A4", print_background=True, display_header_footer=True,
                 header_template="<div></div>", footer_template=FOOTER,
                 margin={"top": "14mm", "bottom": "16mm", "left": "16mm", "right": "16mm"})
        browser.close()
    return info


def find_pages(pdf_path: Path, ids) -> dict:
    doc = pdfium.PdfDocument(str(pdf_path))
    texts = [re.sub(r"\s+", "", doc[i].get_textpage().get_text_range()).upper() for i in range(len(doc))]
    n = len(doc)
    doc.close()
    found = {}
    for sid in ids:
        token = f"§{sid.upper()}·"
        for i, t in enumerate(texts):
            if token in t:
                found[sid] = i + 1
                break
    return found, n


def main():
    parts = parse_structure(SRC.read_text(encoding="utf-8"))
    ids = [s["id"] for p in parts for s in p["sections"]]
    pass1 = BASE / "_pass1.pdf"
    info1 = render(build_html(parts, {}), pass1)
    pages, n1 = find_pages(pass1, ids)
    info2 = render(build_html(parts, pages), OUT)
    pages2, n2 = find_pages(OUT, ids)
    missing = [i for i in ids if i not in pages2]
    print(f"pass1: {info1}  pages={n1}")
    print(f"final: {info2}  pages={n2}  sections={len(ids)}  missing={missing}")
    print("toc stable:", pages == pages2)
    pass1.unlink(missing_ok=True)
    (BASE / "_build.html").unlink(missing_ok=True)
    print("wrote", OUT)
    retire_old_pdfs()


def retire_old_pdfs():
    """Keep only the newest PRD PDF at the folder top level; move older ones to _superseded/."""
    old_dir = OUT_DIR / "_superseded"
    old_dir.mkdir(exist_ok=True)
    for pdf in OUT_DIR.glob("Kitty-PRD-v*.pdf"):
        if pdf.resolve() == OUT.resolve():
            continue
        target = old_dir / pdf.name
        try:
            if target.exists():
                pdf.unlink()
            else:
                pdf.replace(target)
            print("retired", pdf.name, "->", old_dir.name)
        except OSError as e:
            print(f"WARNING: could not retire {pdf.name} ({e}); close it in your PDF viewer and re-run")


if __name__ == "__main__":
    main()

from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor


OUT = Path(__file__).with_name("Rapport_PFE_Shopify_Price_Intelligence.docx")
ROOT = Path(__file__).resolve().parent.parent

BLUE = "123C69"
LIGHT_BLUE = "EAF2F8"
LIGHT_GRAY = "F4F6F9"
RED = "A61B1B"
GRAY = "5B6573"
TABLE_INDENT = 120
CONTENT_WIDTH_DXA = 8788  # A4, 3 cm left and 2.5 cm right margins.


def set_run_font(run, name="Times New Roman", size=12, bold=None, italic=None, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:ascii"), name)
    run._element.rPr.rFonts.set(qn("w:hAnsi"), name)
    run._element.rPr.rFonts.set(qn("w:cs"), name)
    run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    return run


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def shade_cell(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_width(cell, width_dxa):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(width_dxa))
    tc_w.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths_dxa):
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.first_child_found_in("w:tblW")
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(sum(widths_dxa)))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.first_child_found_in("w:tblInd")
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(TABLE_INDENT))
    tbl_ind.set(qn("w:type"), "dxa")
    tbl_layout = tbl_pr.first_child_found_in("w:tblLayout")
    if tbl_layout is None:
        tbl_layout = OxmlElement("w:tblLayout")
        tbl_pr.append(tbl_layout)
    tbl_layout.set(qn("w:type"), "fixed")

    grid = table._tbl.tblGrid
    for grid_col in list(grid):
        grid.remove(grid_col)
    for width in widths_dxa:
        grid_col = OxmlElement("w:gridCol")
        grid_col.set(qn("w:w"), str(width))
        grid.append(grid_col)

    for row in table.rows:
        for cell, width in zip(row.cells, widths_dxa):
            set_cell_width(cell, width)
            set_cell_margins(cell)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def add_field(paragraph, instruction, result=""):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = result
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, text, end])


def set_page_number_format(section, fmt, start=1):
    sect_pr = section._sectPr
    existing = sect_pr.find(qn("w:pgNumType"))
    if existing is not None:
        sect_pr.remove(existing)
    pg_num = OxmlElement("w:pgNumType")
    pg_num.set(qn("w:fmt"), fmt)
    pg_num.set(qn("w:start"), str(start))
    sect_pr.append(pg_num)


def set_rtl(paragraph):
    p_pr = paragraph._p.get_or_add_pPr()
    bidi = OxmlElement("w:bidi")
    p_pr.append(bidi)
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT


def configure_section(section):
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.5)
    section.bottom_margin = Cm(2.5)
    section.left_margin = Cm(3)
    section.right_margin = Cm(2.5)
    section.header_distance = Cm(1.25)
    section.footer_distance = Cm(1.25)


def add_header_footer(section, show_header=True):
    section.header.is_linked_to_previous = False
    section.footer.is_linked_to_previous = False
    header = section.header
    header_p = header.paragraphs[0]
    if show_header:
        header_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = header_p.add_run("Shopify Price Intelligence | Rapport de PFE")
        set_run_font(run, size=9, color=GRAY)
    footer = section.footer
    footer_p = footer.paragraphs[0]
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer_p.add_run("Page ")
    set_run_font(run, size=9, color=GRAY)
    add_field(footer_p, "PAGE", "1")


def configure_styles(doc):
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Times New Roman"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Times New Roman")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Times New Roman")
    normal.font.size = Pt(12)
    normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.5

    style_specs = {
        "Title": (18, BLUE, 16, 10),
        "Heading 1": (16, BLUE, 18, 10),
        "Heading 2": (14, BLUE, 12, 6),
        "Heading 3": (12, "1F4D78", 8, 4),
        "Caption": (10, "000000", 4, 4),
    }
    for name, (size, color, before, after) in style_specs.items():
        style = styles[name]
        style.font.name = "Times New Roman"
        style._element.rPr.rFonts.set(qn("w:ascii"), "Times New Roman")
        style._element.rPr.rFonts.set(qn("w:hAnsi"), "Times New Roman")
        style.font.size = Pt(size)
        style.font.bold = name != "Caption"
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.line_spacing = 1
        style.paragraph_format.keep_with_next = name != "Caption"

    if "Table Text" not in styles:
        table_style = styles.add_style("Table Text", WD_STYLE_TYPE.PARAGRAPH)
    else:
        table_style = styles["Table Text"]
    table_style.font.name = "Times New Roman"
    table_style.font.size = Pt(10)
    table_style.paragraph_format.space_after = Pt(0)
    table_style.paragraph_format.line_spacing = 1.0


def add_body(doc, text, bold_prefix=None):
    p = doc.add_paragraph()
    p.style = doc.styles["Normal"]
    if bold_prefix and text.startswith(bold_prefix):
        set_run_font(p.add_run(bold_prefix), bold=True)
        set_run_font(p.add_run(text[len(bold_prefix):]))
    else:
        set_run_font(p.add_run(text))
    return p


def add_bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.left_indent = Inches(0.375)
        p.paragraph_format.first_line_indent = Inches(-0.194)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.208
        set_run_font(p.add_run(item))


def add_numbered(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.left_indent = Inches(0.375)
        p.paragraph_format.first_line_indent = Inches(-0.194)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.208
        set_run_font(p.add_run(item))


def add_caption(doc, kind, number, text, above=False):
    p = doc.add_paragraph(style="Caption")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    label = p.add_run(f"{kind} {number} : ")
    set_run_font(label, size=10, bold=True)
    set_run_font(p.add_run(text), size=10)
    return p


def add_table(doc, number, caption, headers, rows, widths):
    add_caption(doc, "Tableau", number, caption, above=True)
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    set_table_geometry(table, widths)
    header = table.rows[0]
    set_repeat_table_header(header)
    for index, text in enumerate(headers):
        cell = header.cells[index]
        shade_cell(cell, LIGHT_GRAY)
        p = cell.paragraphs[0]
        p.style = doc.styles["Table Text"]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run_font(p.add_run(text), size=10, bold=True, color=BLUE)
    for row_values in rows:
        cells = table.add_row().cells
        for index, text in enumerate(row_values):
            p = cells[index].paragraphs[0]
            p.style = doc.styles["Table Text"]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            set_run_font(p.add_run(text), size=10)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


def add_code_block(doc, text, caption):
    table = doc.add_table(rows=1, cols=1)
    set_table_geometry(table, [CONTENT_WIDTH_DXA])
    cell = table.cell(0, 0)
    shade_cell(cell, "F2F4F7")
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.0
    run = p.add_run(text)
    set_run_font(run, name="Consolas", size=9)
    add_caption(doc, "Extrait", "", caption)


def add_toc_field(doc, instruction, note):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    add_field(p, instruction, "Mettez a jour les champs dans Word pour afficher la liste.")
    p2 = doc.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_run_font(p2.add_run(note), size=9, italic=True, color=GRAY)


def add_chapter(doc, number, title):
    doc.add_heading(f"CHAPITRE {number}", level=1)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run(title), size=16, bold=True, color=BLUE)


def add_image_or_notice(doc, path, width, notice):
    if path.exists():
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(str(path), width=width)
    else:
        table = doc.add_table(rows=1, cols=1)
        set_table_geometry(table, [CONTENT_WIDTH_DXA])
        cell = table.cell(0, 0)
        shade_cell(cell, LIGHT_BLUE)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run_font(p.add_run(notice), italic=True, color=GRAY)


def add_cover(doc):
    logos = doc.add_table(rows=1, cols=2)
    set_table_geometry(logos, [4200, 4200])
    for label, cell in zip(("LOGO EMSI\nA inserer", "LOGO ENTREPRISE\nA inserer"), logos.rows[0].cells):
        shade_cell(cell, LIGHT_BLUE)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_run_font(p.add_run(label), size=11, bold=True, color=BLUE)
    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    for text, size, bold, color, after in (
        ("ECOLE MAROCAINE DES SCIENCES DE L'INGENIEUR", 15, True, BLUE, 3),
        ("Centre EMSI Rabat", 12, False, GRAY, 20),
        ("[Filiere d'ingenierie]", 12, False, RED, 42),
        ("RAPPORT DE PROJET DE FIN D'ETUDES", 18, True, BLUE, 10),
        ("Conception et realisation d'une plateforme d'intelligence tarifaire pour les marchands Shopify", 18, True, "000000", 38),
    ):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(after)
        set_run_font(p.add_run(text), size=size, bold=bold, color=color)

    details = doc.add_table(rows=4, cols=2)
    set_table_geometry(details, [4200, 4200])
    cover_data = (
        ("Realise par", "[Nom et prenom de l'etudiant]"),
        ("Encadrant academique", "[Nom de l'encadrant academique]"),
        ("Encadrant industriel", "[Nom de l'encadrant industriel]"),
        ("Entreprise d'accueil", "[Nom de l'entreprise]"),
    )
    for row, values in zip(details.rows, cover_data):
        for index, value in enumerate(values):
            p = row.cells[index].paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            set_run_font(p.add_run(value), size=10.5, bold=index == 0, color=BLUE if index == 0 else RED)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(30)
    set_run_font(p.add_run("Annee universitaire 2025-2026"), size=11, bold=True, color=GRAY)


def build_document():
    doc = Document()
    configure_styles(doc)
    configure_section(doc.sections[0])
    add_cover(doc)

    prelim = doc.add_section(WD_SECTION.NEW_PAGE)
    configure_section(prelim)
    add_header_footer(prelim)
    set_page_number_format(prelim, "lowerRoman", 1)

    doc.add_heading("Remerciements", level=1)
    add_body(doc, "Je remercie tout d'abord [Nom de l'entreprise] pour l'accueil, l'environnement de travail et les ressources mises a disposition pendant la realisation de ce projet. Je remercie particulierement [Nom de l'encadrant industriel] pour ses retours metier et son accompagnement dans la clarification des besoins lies au pilotage des prix dans le commerce electronique.")
    add_body(doc, "J'adresse egalement mes remerciements a [Nom de l'encadrant academique] pour l'encadrement academique, la rigueur methodologique et les conseils apportes tout au long de la conception et de la realisation. Mes remerciements vont enfin a l'ensemble des enseignants de l'EMSI ainsi qu'a toutes les personnes qui ont contribue, directement ou indirectement, a l'aboutissement de ce travail.")

    doc.add_page_break()
    doc.add_heading("Resume", level=1)
    add_body(doc, "La fixation d'un prix competitif est une decision recurrente pour les marchands en ligne. Elle exige de suivre des produits comparables, de verifier la fiabilite des informations collectees et de preserver la marge commerciale. Or, une surveillance manuelle des sites concurrents est lente, fragile et difficile a generaliser lorsque le catalogue s'agrandit. Ce projet presente la conception et la realisation de Shopify Price Intelligence, une plateforme web destinee aux marchands Shopify pour centraliser le suivi des prix concurrents et produire des recommandations tarifaires exploitables.")
    add_body(doc, "La solution repose sur une interface React, une API TypeScript basee sur Express et tRPC, et une base PostgreSQL accedee avec Drizzle ORM. Elle permet l'authentification des utilisateurs, la connexion d'une boutique Shopify, la synchronisation de produits, la gestion de concurrents, l'enregistrement d'historiques de prix et la diffusion d'alertes. Le processus de surveillance combine la collecte de pages concurrentes, une extraction assistee par IA, la verification du rapprochement produit et la detection de variations. Un moteur de recommandation calcule une position de marche et applique une sous-cotation de 5 % de la moyenne concurrentielle, tout en imposant un seuil de protection de marge lorsque le cout du produit est connu.")
    add_body(doc, "Le travail couvre l'analyse des besoins, la conception de l'architecture et des donnees, l'implementation des principaux modules et un protocole de validation. L'objectif est de transformer des donnees de marche dispersees en decisions tarifaires traceables, avec une attention particuliere a la securite, a la propriete des donnees et a la lisibilite de l'interface.")
    add_body(doc, "Mots-cles : Shopify, veille concurrentielle, intelligence tarifaire, recommandation de prix, commerce electronique.", bold_prefix="Mots-cles :")

    doc.add_page_break()
    doc.add_heading("Abstract", level=1)
    add_body(doc, "Setting a competitive price is a recurring decision for online merchants. It requires tracking comparable products, assessing the reliability of the collected information, and preserving the commercial margin. Manual monitoring of competitor websites is slow, fragile, and difficult to scale as a catalogue grows. This project presents the design and implementation of Shopify Price Intelligence, a web platform for Shopify merchants that centralizes competitor-price monitoring and produces actionable pricing recommendations.")
    add_body(doc, "The solution relies on a React interface, a TypeScript API built with Express and tRPC, and a PostgreSQL database accessed through Drizzle ORM. It supports user authentication, Shopify-store connection, product synchronization, competitor management, price-history storage, and alert delivery. The monitoring process combines competitor-page collection, AI-assisted extraction, product-match verification, and price-change detection. A recommendation engine calculates a market position and applies a five-percent undercut of the competitor average while enforcing a margin-protection floor when the product cost is known.")
    add_body(doc, "Keywords: Shopify, competitor monitoring, price intelligence, price recommendation, e-commerce.", bold_prefix="Keywords:")

    doc.add_page_break()
    arabic_heading = doc.add_heading("ملخص", level=1)
    set_rtl(arabic_heading)
    for paragraph_text in (
        "يعد تحديد سعر تنافسي قرارا متكررا بالنسبة للتجار عبر الإنترنت. فهو يتطلب تتبع المنتجات المماثلة، والتحقق من موثوقية المعلومات المجمعة، والحفاظ على الهامش التجاري. إن المراقبة اليدوية لمواقع المنافسين بطيئة وهشة ويصعب توسيعها مع نمو الكتالوج.",
        "يقدم هذا المشروع تصميم وإنجاز منصة Shopify Price Intelligence الموجهة لتجار Shopify من أجل تجميع مراقبة أسعار المنافسين وإنتاج توصيات سعرية قابلة للتنفيذ. تعتمد المنصة على واجهة React وواجهة برمجة تطبيقات TypeScript وقاعدة بيانات PostgreSQL. تتيح المصادقة وربط متجر Shopify ومزامنة المنتجات وإدارة المنافسين وحفظ تاريخ الأسعار وإرسال التنبيهات.",
        "يجمع محرك التوصية بين متوسط أسعار المنافسين وحد أدنى لحماية الهامش عند توفر تكلفة المنتج. يهدف المشروع إلى تحويل معلومات السوق المتفرقة إلى قرارات تسعير قابلة للتتبع مع الاهتمام بالأمان وملكية البيانات ووضوح الواجهة.",
    ):
        p = doc.add_paragraph()
        set_rtl(p)
        set_run_font(p.add_run(paragraph_text), name="Arial", size=12)

    doc.add_page_break()
    doc.add_heading("Table des matieres", level=1)
    add_toc_field(doc, 'TOC \\o "1-3" \\h \\z \\u', "Dans Word, cliquez avec le bouton droit sur la table puis choisissez Mettre a jour le champ.")
    doc.add_page_break()
    doc.add_heading("Liste des figures", level=1)
    add_toc_field(doc, 'TOC \\h \\z \\c "Figure"', "La liste est generee a partir des legends de figures.")
    doc.add_page_break()
    doc.add_heading("Liste des tableaux", level=1)
    add_toc_field(doc, 'TOC \\h \\z \\c "Tableau"', "La liste est generee a partir des legends de tableaux.")
    doc.add_page_break()
    doc.add_heading("Liste des abreviations et acronymes", level=1)
    add_table(doc, 1, "Liste des abreviations et acronymes", ["Acronyme", "Signification"], [
        ("API", "Application Programming Interface"),
        ("CSRF", "Cross-Site Request Forgery"),
        ("HMAC", "Hash-based Message Authentication Code"),
        ("IA", "Intelligence Artificielle"),
        ("JWT", "JSON Web Token"),
        ("ORM", "Object-Relational Mapping"),
        ("PFE", "Projet de Fin d'Etudes"),
        ("SSE", "Server-Sent Events"),
        ("tRPC", "TypeScript Remote Procedure Call"),
    ], [2200, 6588])

    main = doc.add_section(WD_SECTION.NEW_PAGE)
    configure_section(main)
    add_header_footer(main)
    set_page_number_format(main, "decimal", 1)

    doc.add_heading("Introduction generale", level=1)
    add_body(doc, "Le commerce electronique evolue dans un environnement ou les prix, les promotions et la disponibilite des produits peuvent changer rapidement. Pour un marchand Shopify, la connaissance du marche est indispensable, mais elle est rarement disponible sous une forme directement exploitable. Les informations sont reparties entre le catalogue de la boutique, les fiches de concurrents et les canaux de vente externes. Le suivi manuel de ces donnees conduit a des decisions tardives et peu traceables.")
    add_body(doc, "La problematique traitee est la suivante : comment fournir a un marchand Shopify une vision fiable et actionnable de sa position tarifaire, tout en preservant ses contraintes de marge et la securite de ses donnees ? La reponse proposee est une plateforme d'intelligence tarifaire qui importe les produits d'une boutique, observe des offres concurrentes, historise les donnees et formule une recommandation explicable.")
    add_body(doc, "Les objectifs du projet sont les suivants :")
    add_bullets(doc, [
        "Automatiser la collecte et l'organisation des informations tarifaires pertinentes.",
        "Assister le rapprochement entre un produit interne et une offre concurrente.",
        "Detecter les variations importantes et notifier le marchand.",
        "Proposer un prix cible qui tient compte du marche et d'un seuil minimal de marge.",
        "Proposer une application securisee, multi-utilisateur et lisible.",
    ])
    add_body(doc, "La demarche adoptee combine une analyse des besoins, une conception par couches, une implementation TypeScript de bout en bout et la definition de tests fonctionnels et unitaires. Le premier chapitre presente le contexte et les besoins. Le deuxieme decrit les specifications et les choix de conception. Le troisieme detaille l'architecture, les donnees et l'algorithme tarifaire. Le quatrieme expose la realisation, la strategie de validation et les limites identifiees.")

    add_chapter(doc, 1, "Contexte general et analyse des besoins")
    doc.add_heading("Introduction du chapitre", level=2)
    add_body(doc, "Ce chapitre situe le projet dans son contexte metier, identifie les parties prenantes et formalise le besoin auquel la plateforme repond.")
    doc.add_heading("Contexte du projet", level=2)
    add_body(doc, "Les petites equipes e-commerce doivent concilier acquisition, logistique, relation client et gestion du catalogue. Le controle continu des prix concurrents devient alors une tache repetitive qui consomme du temps sans toujours fournir une decision claire. Un prix trop eleve peut reduire la competitivite d'une offre, tandis qu'une baisse non controlee peut detruire la marge. L'enjeu n'est donc pas simplement de trouver le prix le plus bas, mais de fournir une information contextualisee permettant au marchand de choisir.")
    add_body(doc, "La plateforme cible les marchands Shopify et les petites equipes responsables d'un catalogue. Son principe directeur est de reduire le temps entre l'observation d'un changement de marche et une action documentee. Le produit vise une experience concise : le marchand doit identifier les produits qui requierent son attention, comprendre la recommandation et retrouver les donnees qui la justifient.")
    doc.add_heading("Parties prenantes et acteurs", level=2)
    add_table(doc, 2, "Acteurs principaux et responsabilites", ["Acteur", "Attentes", "Interactions"], [
        ("Marchand Shopify", "Connaitre sa position tarifaire.", "Connecte sa boutique et consulte les alertes et recommandations."),
        ("Equipe e-commerce", "Superviser plusieurs produits.", "Gere le catalogue, les concurrents et les preferences."),
        ("Administrateur", "Maintenir un usage controle.", "Administre les comptes et supervise les operations."),
        ("Shopify", "Autoriser l'acces aux donnees.", "Fournit le flux OAuth et les donnees produits."),
        ("Services externes", "Rendre les pages exploitables.", "Participent a la recherche, au scraping et a l'extraction."),
    ], [1650, 3100, 4038])
    doc.add_heading("Problematique et objectifs", level=2)
    add_body(doc, "La problematique se decompose en quatre difficultes. La premiere est l'heterogeneite des sources : les donnees de prix n'ont pas toujours la meme structure ni le meme niveau de qualite. La deuxieme est le rapprochement : une offre trouvee ne correspond pas necessairement au meme produit, modele ou variante. La troisieme est la frequence : les prix evoluent et doivent etre historises plutot qu'ecrases. La quatrieme est la decision : une recommandation doit rester compatible avec le cout du produit et etre explicable.")
    doc.add_heading("Exigences fonctionnelles", level=2)
    add_table(doc, 3, "Exigences fonctionnelles principales", ["ID", "Exigence", "Critere d'acceptation"], [
        ("F01", "Authentifier un utilisateur et proteger les ecrans prives.", "Un utilisateur non authentifie est redirige vers la connexion."),
        ("F02", "Connecter une boutique Shopify.", "La boutique autorisee est visible dans les parametres."),
        ("F03", "Synchroniser les produits.", "Les produits sont rattaches au compte et a la boutique concernee."),
        ("F04", "Gerer les concurrents.", "Le marchand peut consulter et suivre des offres concurrentes."),
        ("F05", "Historiser les observations.", "Chaque collecte pertinente cree un instantane reutilisable."),
        ("F06", "Detecter les changements.", "Une variation significative cree une activite et une alerte."),
        ("F07", "Produire une recommandation.", "Le contexte de marche et le seuil applique sont affiches."),
    ], [700, 3600, 4488])
    doc.add_heading("Exigences non fonctionnelles", level=2)
    add_body(doc, "La securite est essentielle car l'application manipule des comptes utilisateurs et des jetons permettant d'acceder a Shopify. Les acces doivent etre controles, les donnees sensibles stockees de maniere chiffree et les operations exposees protegees contre les abus. Les controles implementes s'inscrivent dans une demarche de reduction des risques courants d'applications web, notamment l'authentification, le controle d'acces, la cryptographie et la journalisation [1].")
    add_body(doc, "La qualite d'usage constitue une seconde exigence. L'interface doit privilegier une lecture rapide, notamment par une navigation par tableaux de bord, des pages dediees au catalogue et aux alertes, ainsi qu'un affichage explicite de la derniere mise a jour et du niveau de confiance. Enfin, la maintenabilite impose une architecture modulaire et des contrats de donnees types.")
    doc.add_heading("Conclusion du chapitre", level=2)
    add_body(doc, "L'analyse montre que la valeur de la solution depend autant de la fiabilite de l'information que de sa capacite a conduire vers une action. Les besoins identifies servent de base aux specifications et a la conception presentees dans le chapitre suivant.")

    add_chapter(doc, 2, "Specifications et conception fonctionnelle")
    doc.add_heading("Introduction du chapitre", level=2)
    add_body(doc, "Ce chapitre traduit les besoins en parcours utilisateurs, en regles de gestion et en decisions de conception fonctionnelle.")
    doc.add_heading("Parcours principal du marchand", level=2)
    add_body(doc, "Le parcours commence par la creation d'un compte et l'authentification. Une fois connecte, le marchand peut relier sa boutique Shopify. Le flux d'autorisation permet d'obtenir les permissions necessaires pour lire les donnees de boutique ; Shopify distingue l'authentification de l'autorisation et conditionne l'acces aux donnees a un jeton associe aux droits accordes [2]. La plateforme synchronise ensuite les produits et les associe a la boutique du marchand.")
    add_body(doc, "Le marchand choisit ensuite les produits a suivre, consulte les concurrents existants ou lance une recherche. Les offres collectees sont soumises a une etape de validation avant d'etre exploitees. Apres validation, le service de monitoring enregistre les instantanes, compare les donnees avec l'etat precedent et produit, lorsque cela est justifie, des evenements, alertes et recommandations.")
    add_table(doc, 4, "Etapes du parcours fonctionnel", ["Etape", "Action du marchand", "Resultat de la plateforme"], [
        ("1", "S'authentifier et connecter Shopify.", "La boutique active est rattachee au compte."),
        ("2", "Synchroniser le catalogue.", "Les produits sont inseres ou mis a jour."),
        ("3", "Rechercher ou valider un concurrent.", "Une offre comparable devient suivie."),
        ("4", "Executer ou attendre le monitoring.", "Les instantanes et changements sont historicises."),
        ("5", "Consulter alertes et recommandations.", "Le marchand obtient une decision contextualisee."),
    ], [800, 3800, 4188])
    doc.add_heading("Regles de gestion", level=2)
    add_numbered(doc, [
        "Une ressource metier est toujours rattachee a un utilisateur.",
        "Une boutique inactive ne sert pas a synchroniser de nouveaux produits.",
        "Une observation de prix est conservee comme instantane afin d'autoriser l'analyse temporelle.",
        "Une offre concurrente doit franchir un seuil de confiance avant de contribuer a une recommandation.",
        "Une variation de prix significative peut produire une alerte et un evenement d'activite.",
        "La recommandation ne doit pas descendre sous le seuil de marge lorsque le cout est renseigne.",
    ])
    doc.add_heading("Maquettes et navigation", level=2)
    add_body(doc, "L'application cliente est organisee autour d'une mise en page de tableau de bord. Les routes privees couvrent la vue d'ensemble, les produits, le detail d'un produit, la recherche de prix, les concurrents, les analyses, les alertes et les parametres. Cette organisation se conforme a une logique de separation des taches : la page d'ensemble priorise les signaux, la page produit fournit le contexte detaille et les parametres regroupent les integrations.")
    add_image_or_notice(doc, ROOT / "auth-page.png", Inches(5.7), "Capture de l'ecran d'authentification non disponible.")
    add_caption(doc, "Figure", 1, "Ecran d'authentification de la plateforme")
    doc.add_heading("Criteres de qualite de l'interface", level=2)
    add_body(doc, "La qualite de l'interface ne se limite pas a l'esthetique. Les montants, les statuts et les changements doivent etre lisibles sans ambiguite. L'application applique un theme sombre par defaut, des composants accessibles et une navigation utilisable sur des ecrans de bureau et mobiles. React fournit un modele a composants et des hooks adaptes a la composition d'une interface interactive [3].")
    doc.add_heading("Conclusion du chapitre", level=2)
    add_body(doc, "Les specifications etablissent une chaine fonctionnelle allant de la connexion Shopify jusqu'a la recommandation. La suite du rapport precise l'architecture technique qui permet de realiser cette chaine de maniere modulaire et securisee.")

    add_chapter(doc, 3, "Conception technique et architecture")
    doc.add_heading("Introduction du chapitre", level=2)
    add_body(doc, "Ce chapitre presente l'architecture par couches, le modele de donnees, le flux de surveillance et la logique de recommandation de prix.")
    doc.add_heading("Architecture generale", level=2)
    add_body(doc, "La solution adopte une architecture web de type client-serveur. Le client React affiche les vues metier et appelle l'API tRPC. Le serveur Express centralise les regles de securite, les routers, les services applicatifs et l'acces aux donnees. PostgreSQL conserve les donnees operationnelles et historiques. Des services externes interviennent pour Shopify et pour la collecte ou l'extraction des informations concurrentes [4].")
    add_table(doc, 5, "Architecture logique de la solution", ["Couche", "Composants", "Responsabilite"], [
        ("Client", "React, Vite, Wouter, tRPC client", "Affichage des tableaux de bord, formulaires et interactions utilisateur."),
        ("API", "Express, tRPC, Zod", "Exposition des procedures, validation des entrees et controle des acces."),
        ("Services", "Monitoring, extraction, alertes, recommandations", "Traitement metier et orchestration des flux."),
        ("Persistance", "PostgreSQL, Drizzle ORM", "Stockage transactionnel et historique des prix."),
        ("Integrations", "Shopify, recherche, scraping et IA", "Import de produits et enrichissement des observations."),
    ], [1400, 3300, 4088])
    doc.add_heading("Organisation du backend", level=2)
    add_table(doc, 6, "Principaux modules serveur et responsabilites", ["Module", "Responsabilite"], [
        ("server/_core/index.ts", "Demarrage Express, middleware de securite, SSE et planificateur."),
        ("server/routers.ts", "Composition de l'API tRPC et operations de cycle de vie Shopify."),
        ("product.service.ts", "Creation, mise a jour, recherche et synchronisation des produits."),
        ("price-monitoring.service.ts", "Collecte, extraction, instantanes, changements et alertes."),
        ("pricing-engine.service.ts", "Calcul pur de moyenne, position de marche et prix recommande."),
        ("server/_core/auth", "Sessions JWT, renouvellement, verification HMAC et chiffrement."),
    ], [3200, 5588])
    doc.add_heading("Modele de donnees", level=2)
    add_body(doc, "Le modele relationnel regroupe les entites de compte, d'integration, de catalogue et de surveillance. Un utilisateur peut posseder plusieurs boutiques ; une boutique contient des produits ; un produit peut etre associe a plusieurs produits concurrents ; chaque association produit des instantanes et, eventuellement, des changements. Les alertes et les journaux d'activite conservent une vue orientee utilisateur des evenements significatifs.")
    add_table(doc, 7, "Entites de persistance principales", ["Entite", "Role dans le systeme"], [
        ("users, refresh_tokens", "Identite, role, session et renouvellement d'acces."),
        ("shopify_stores", "Boutique connectee, etat, scopes et dernier horodatage de synchronisation."),
        ("products", "Catalogue interne, prix, cout, reference, statut et suivi."),
        ("competitors, competitor_products", "Concurrents et offres associees aux produits internes."),
        ("price_snapshots, price_changes", "Historique des observations et changements detectes."),
        ("alerts, activity_logs", "Signalement utilisateur et trace d'activite."),
        ("ai_extractions, competitor_discoveries", "Donnees d'extraction, confiance et candidats trouves."),
        ("cron_runs, scrape_logs", "Suivi des executions planifiees et traces de collecte."),
    ], [3500, 5288])
    doc.add_heading("Flux de monitoring", level=2)
    add_body(doc, "Le monitoring traite les associations concurrent-produit actives. Pour chaque URL, le service tente de recuperer le contenu, enregistre un journal de collecte, appelle le module d'extraction et verifie le seuil de confiance. Lorsqu'une extraction est valide, un nouvel instantane est ajoute. La nouvelle valeur est ensuite comparee au prix precedent. Une variation produit un enregistrement de changement, un evenement d'activite et, si le seuil est atteint, une alerte diffusee au client via SSE.")
    add_table(doc, 8, "Sequence de surveillance et de detection", ["Phase", "Traitement", "Trace produite"], [
        ("Collecte", "Recuperation de la page concurrente.", "Journal de scraping."),
        ("Extraction", "Lecture structuree du prix, de la devise et de la disponibilite.", "Extraction et score de confiance."),
        ("Validation", "Verification de la correspondance avec le produit interne.", "Decision d'acceptation ou rejet."),
        ("Historisation", "Ajout d'un instantane de prix.", "Price snapshot immuable."),
        ("Detection", "Comparaison avec le prix precedent.", "Price change et activite."),
        ("Notification", "Creation d'une alerte selon le seuil.", "Alerte et evenement SSE."),
    ], [1500, 4200, 3088])
    doc.add_heading("Moteur de recommandation tarifaire", level=2)
    add_body(doc, "Le moteur applique une regle explicable. Soit Pc l'ensemble des prix concurrents valides, Pc_bar leur moyenne, C le cout du produit et Pr le prix recommande. La moyenne est calculee apres exclusion des valeurs nulles, negatives ou egales a zero. Le prix cible est obtenu par sous-cotation de 5 % de la moyenne concurrentielle. Lorsque le cout est connu et strictement positif, une protection de marge impose un plancher correspondant a 10 % au-dessus du cout. La recommandation finale correspond au maximum entre le prix cible et ce plancher.")
    add_table(doc, 9, "Exemple de calcul d'une recommandation", ["Donnee", "Valeur"], [
        ("Prix concurrents valides", "90,00 ; 100,00 ; 110,00"),
        ("Moyenne concurrentielle", "100,00"),
        ("Prix cible a -5 %", "95,00"),
        ("Cout de revient", "90,00"),
        ("Plancher de marge a +10 %", "99,00"),
        ("Prix recommande", "99,00 avec protection de marge activee"),
    ], [4000, 4788])
    doc.add_heading("Conception de la securite", level=2)
    add_body(doc, "La securite est integree des le serveur. Les sessions applicatives reposent sur des cookies HTTP-only contenant des JWT a duree limitee, completes par des jetons de renouvellement. Les mots de passe sont haches, les jetons Shopify sont chiffres au repos et ne sont pas exposes a l'interface cliente. La validation de domaine Shopify, les signatures HMAC, les limites de debit et la protection CSRF des routes OAuth constituent des controles complementaires. Les entetes HTTP sont renforces avec Helmet et les origines CORS sont restreintes en production.")
    doc.add_heading("Conclusion du chapitre", level=2)
    add_body(doc, "La conception articule des responsabilites distinctes autour d'un historique de prix et d'un moteur de recommandation explicable. Le chapitre suivant decrit la traduction de cette conception en composants concrets et le protocole de validation associe.")

    add_chapter(doc, 4, "Realisation et validation")
    doc.add_heading("Introduction du chapitre", level=2)
    add_body(doc, "Ce chapitre decrit les principaux choix d'implementation, les ecrans realises et la strategie de verification retenue pour le projet.")
    doc.add_heading("Implementation du client web", level=2)
    add_body(doc, "Le client est developpe avec React et Vite. Le point d'entree applique un garde d'authentification : tant que l'identite de l'utilisateur n'est pas disponible, une vue de chargement est affichee ; un utilisateur non authentifie est renvoye vers l'ecran de connexion. Les routes authentifiees sont placees dans une mise en page commune contenant la navigation laterale, la recherche, les alertes en temps reel, l'export CSV et l'acces aux principales fonctions.")
    add_image_or_notice(doc, ROOT / "products-page.png", Inches(5.9), "Capture de la page produits non disponible.")
    add_caption(doc, "Figure", 2, "Page de gestion du catalogue produits")
    add_body(doc, "Les appels de donnees sont construits avec le client tRPC et React Query. Cette approche favorise la coevolution entre les contrats serveur et client : les parametres et les resultats des procedures sont types. Les composants de l'interface reutilisent des primitives accessibles afin de conserver une coherence visuelle entre les formulaires, tableaux, dialogues et notifications.")
    doc.add_heading("Implementation de l'API et des services", level=2)
    add_body(doc, "Le serveur est une application Express executee en TypeScript. La couche tRPC transporte les procedures metier et applique des procedures publiques ou protegees selon le domaine. Les routes Shopify permettent l'echange de code OAuth, l'enregistrement d'une boutique, la deconnexion et la synchronisation paginee des produits. Les operations de synchronisation verifient l'appartenance de la boutique a l'utilisateur courant avant d'acceder au jeton stocke.")
    add_body(doc, "Le service de monitoring suit une sequence de traitement prevue pour etre observable : creation d'une execution de planification, collecte, journalisation, extraction, creation d'instantane, mise a jour de l'offre concurrente, detection de changement et diffusion de notification. En cas d'erreur sur une offre, l'erreur est enregistree et le traitement des autres offres peut continuer. Cette granularite facilite le diagnostic des problemes provenant d'une URL ou d'un connecteur externe.")
    doc.add_heading("Extrait de logique tarifaire", level=2)
    add_code_block(doc, "const targetPrice = averageCompetitorPrice * 0.95;\n\nif (costPrice == null || costPrice <= 0) {\n  return targetPrice;\n}\n\nconst minimumAllowedPrice = costPrice * 1.10;\nreturn Math.max(targetPrice, minimumAllowedPrice);", "Pseudo-code simplifie de la protection de marge")
    doc.add_heading("Jeu de tests et protocole de validation", level=2)
    add_body(doc, "Le depot contient des tests unitaires pour le moteur de prix et des tests d'integration relatifs aux produits et a la deconnexion [4]. Les tests du moteur couvrent notamment la moyenne de prix valides, le filtrage de valeurs invalides, l'absence de donnees, la sous-cotation de 5 %, la protection de marge, les seuils de classification et les cas limites. Les tests de produits verifient des regles de creation, de normalisation de reference, d'unicite par utilisateur, de recherche et de retrocompatibilite.")
    add_body(doc, "Le tableau suivant fournit un protocole reproductible. Les resultats chiffres et les captures de la campagne finale doivent etre renseignes apres execution dans l'environnement de soutenance. Cette precaution evite d'affirmer des resultats qui ne sont pas directement observes.")
    add_table(doc, 10, "Protocole de validation a executer avant soutenance", ["Type", "Scenario", "Verification attendue"], [
        ("Unitaire", "Moyenne de trois prix valides.", "La moyenne est exacte et arrondie a deux decimales."),
        ("Unitaire", "Prix cible inferieur au plancher de marge.", "Le prix retourne est le plancher et la protection est activee."),
        ("Integration", "Deux produits avec la meme reference pour un utilisateur.", "La seconde creation est rejetee ; un autre utilisateur reste autorise."),
        ("Integration", "Deconnexion d'une boutique Shopify.", "La boutique devient inactive et le jeton est retire."),
        ("Fonctionnel", "Connexion, synchronisation et affichage du catalogue.", "Les produits ne sont visibles que par le marchand concerne."),
        ("Fonctionnel", "Variation d'un prix concurrent superieure au seuil.", "Un instantane, un changement, une activite et une alerte sont crees."),
        ("Securite", "Acces a une ressource d'un autre compte.", "La requete est refusee ou ne retourne aucune donnee etrangere."),
    ], [1200, 3500, 4088])
    doc.add_heading("Commandes de verification", level=2)
    add_body(doc, "Les commandes suivantes sont definies dans le manifeste du projet. Elles doivent etre executees une a une dans un environnement configure avec les variables necessaires et une base de donnees de test. La sortie exacte, la date d'execution et les anomalies rencontrees doivent etre ajoutees dans l'annexe de la version soumise.")
    add_code_block(doc, "pnpm check\npnpm test\npnpm build", "Commandes de verification du projet")
    doc.add_heading("Contraintes observees et ameliorations", level=2)
    add_body(doc, "La qualite des recommandations depend des donnees collectees. Les pages concurrentes peuvent changer de structure, devenir inaccessibles ou proposer des variantes ambigues. Il est donc pertinent de conserver la confiance de l'extraction, la source et la date de l'observation. Le traitement planifie en processus unique convient a une premiere version mais devra evoluer vers une file de travaux et des executeurs distribues lorsque le volume de produits augmentera.")
    add_bullets(doc, [
        "Rendre les regles de recommandation configurables par categorie ou par strategie commerciale.",
        "Ajouter une validation humaine simple pour les rapprochements ambigus.",
        "Isoler les taches de scraping dans une file de travaux avec reprise et observation centralisee.",
        "Enrichir les indicateurs de tendance par periode et par concurrent.",
        "Ajouter une campagne de tests de securite et de charge documentee avant la mise en production.",
    ])
    doc.add_heading("Conclusion du chapitre", level=2)
    add_body(doc, "La realisation transforme la conception en une application modulaire couvrant les principaux flux metier. Les tests existants constituent une base de verification ; leur execution tracee et une campagne de validation complete sont necessaires avant toute conclusion quantitative de production.")

    doc.add_heading("Conclusion generale et perspectives", level=1)
    add_body(doc, "Ce projet avait pour objectif de concevoir et de realiser une plateforme d'intelligence tarifaire pour les marchands Shopify. La solution proposee centralise le catalogue, les offres concurrentes, les instantanes de prix, les changements detectes et les recommandations. Elle repond au besoin initial de reduire la surveillance manuelle en organisant une chaine allant de la connexion de la boutique jusqu'a l'alerte ou a la decision tarifaire.")
    add_body(doc, "Les contributions principales sont une architecture TypeScript par couches, une modelisation relationnelle orientee historique, un flux de monitoring trace, une interface de tableau de bord et un moteur de recommandation explicable. La regle de calcul combine une position de marche avec une protection de marge, ce qui evite de presenter la baisse de prix comme une decision automatique et universelle.")
    add_body(doc, "Les perspectives concernent principalement le passage a l'echelle et l'enrichissement de la decision. Une file de travaux distribuee, des politiques de prix parametrables, une validation humaine des rapprochements, des indicateurs de tendance et une campagne de tests de performance permettraient de faire evoluer la solution vers une exploitation plus large. Avant le deploiement en production, les resultats du protocole de validation, les captures finales et les informations academiques devront etre completes et verifies.")

    doc.add_heading("References bibliographiques", level=1)
    references = [
        "[1] OWASP Foundation, \"OWASP Top 10: 2025,\" 2025. Disponible sur : https://owasp.org/Top10/ (consulte le 23/07/2026).",
        "[2] Shopify, \"Authentication and authorization,\" 2026. Disponible sur : https://shopify.dev/docs/apps/build/authentication-authorization (consulte le 23/07/2026).",
        "[3] React Team, \"React Reference Overview,\" 2026. Disponible sur : https://react.dev/reference/react (consulte le 23/07/2026).",
        "[4] Shopify Price Intelligence, \"Depot source du projet,\" depot local, consulte le 23/07/2026.",
        "[5] Drizzle Team, \"Drizzle ORM Overview,\" 2026. Disponible sur : https://orm.drizzle.team/docs/overview (consulte le 23/07/2026).",
    ]
    for ref in references:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.3)
        p.paragraph_format.first_line_indent = Inches(-0.3)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.0
        set_run_font(p.add_run(ref), size=10)

    doc.add_page_break()
    doc.add_heading("Annexe A - Trace de conformite au guide EMSI", level=1)
    add_table(doc, 11, "Conformite structurelle du rapport", ["Exigence du guide", "Application dans ce document"], [
        ("A4 et marges imposees", "A4, 3 cm a gauche et 2,5 cm sur les trois autres cotes."),
        ("Texte 12 pt et interligne 1,5", "Style Normal en Times New Roman 12 pt et interligne 1,5."),
        ("Pagination preliminaire et contenu", "Chiffres romains pour les preliminaires, puis chiffres arabes."),
        ("Page de garde", "Logos, filiere, etudiant, encadrements, entreprise et annee a completer."),
        ("Resumes", "Resume francais, abstract anglais et ملخص arabe inclus."),
        ("Listes automatiques", "Champs Word pour table des matieres, figures et tableaux."),
        ("Figures, tableaux et citations", "Legendes, tableaux fixes et references numeriques presentes."),
    ], [3900, 4888])
    doc.add_heading("Annexe B - Checklist de finalisation", level=1)
    add_numbered(doc, [
        "Remplacer tous les textes rouges entre crochets par les informations reelles.",
        "Inserer les logos officiels et verifier leur qualite d'impression.",
        "Confirmer les trois resumes avec les encadrants et la filiere.",
        "Executer les tests, conserver les resultats et completer le tableau de validation.",
        "Mettre a jour la table des matieres, la liste des figures et la liste des tableaux dans Word.",
        "Verifier que chaque information externe est citee et que les dates de consultation sont a jour.",
        "Relire orthographe, grammaire, pagination, alignement et impression PDF.",
    ])

    settings = doc.settings.element
    update_fields = OxmlElement("w:updateFields")
    update_fields.set(qn("w:val"), "true")
    settings.append(update_fields)
    doc.core_properties.title = "Rapport de PFE - Shopify Price Intelligence"
    doc.core_properties.subject = "Conception et realisation d'une plateforme d'intelligence tarifaire"
    doc.core_properties.author = "[Nom et prenom de l'etudiant]"
    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    build_document()

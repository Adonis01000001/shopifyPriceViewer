# Rapport PFE EMSI - Shopify Price Intelligence

Le rapport est conforme a la structure du guide EMSI fourni: page de garde, remerciements, resumes francais/anglais/arabe, listes automatiques, introduction, chapitres, conclusion, bibliographie et annexes.

## A completer avant soumission

- Remplacer les champs rouges de `main.tex`: nom, filiere, encadrants, entreprise et annee si necessaire.
- Inserer les logos officiels sur la page de garde.
- Confirmer les trois resumes avec les encadrants.
- Executer la campagne de verification et documenter les resultats observes dans le chapitre 4.
- Completer avec les captures finales et, si requis par l'encadrement, les informations specifiques a l'entreprise.

## Compilation

Le document cible LuaLaTeX afin de prendre en charge le resume en arabe. Il utilise BibTeX avec le style IEEE demande par le guide.

```powershell
cd rapport-pfe
lualatex main.tex
bibtex main
lualatex main.tex
lualatex main.tex
```

Ou avec `latexmk`:

```powershell
latexmk -lualatex main.tex
```

La machine de travail ne contient aucun moteur TeX (`pdflatex`, `xelatex`, `lualatex` et `latexmk` sont absents). Le source a donc fait l'objet de controles structurels, mais le rendu PDF doit etre verifie apres compilation dans MiKTeX, TeX Live ou Overleaf.

## Ressources locales utilisees

- `../auth-page.png` et `../products-page.png` sont inclus automatiquement si presents.
- `references.bib` contient les references techniques et le guide de redaction.
- Le contenu technique a ete derive du code actuel, en particulier les routers, services, schema Drizzle, interface React et tests existants.

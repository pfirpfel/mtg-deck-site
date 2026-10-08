# mtg-deck-site

Generates a static website from a repository of Magic: The Gathering deck lists (MTGO `.txt` format).

- Deck view with card images (Scryfall), mana costs, grouping by type / mana value / color, sorting by name / mana value
- Double-faced cards can be flipped in the card preview; modal double-faced lands are listed as "+ N other" lands
- Color identity of each deck, derived from its commanders
- Statistics per deck: mana value, card type and color distribution
- Change history per deck, derived from the git history of each file
- Collapsible folder tree, breadcrumb and folder pages, sortable by name or last change
- Home page with the most recently updated decks

## GitHub Action

Builds the site into `_site`. Deploying it is left to a separate step, e.g. GitHub Pages:

```yaml
name: Deck site

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # full history for the deck change log
      - uses: pfirpfel/mtg-deck-site@v1
      - uses: actions/upload-pages-artifact@v5
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

Enable Pages in the repository settings with "GitHub Actions" as the source.

### Inputs

| Input | Default | |
| --- | --- | --- |
| `decks` | `.` | Folder containing the deck lists (searched recursively for `*.txt`) |
| `output` | `_site` | Output folder for the generated site |
| `title` | repository name | Site title |
| `repo-url` | current repository | Base URL for commit links |
| `history` | `true` | Show the change history of each deck |
| `setup-node` | `true` | Install Node.js 22 via `actions/setup-node` |

The output folder is available as `steps.<id>.outputs.output`.

Card data is downloaded from [Scryfall's bulk data](https://scryfall.com/docs/api/bulk-data) and stored with
`actions/cache`, so builds within 24 hours reuse it.

## Local usage

Requires Node.js >= 20 and git. No dependencies.

```bash
node src/build.mjs --decks ../commander-decks --out _site
```

| Option | Default | |
| --- | --- | --- |
| `--decks` | `.` | Folder containing the deck lists (searched recursively for `*.txt`) |
| `--out` | `_site` | Output folder (deleted and recreated) |
| `--cache` | `.cache/scryfall` | Scryfall card data cache, reused for 24 hours |
| `--title` | repo folder name | Site title |
| `--repo-url` | from `GITHUB_REPOSITORY` or `origin` | Base URL for commit links |
| `--no-history` | | Skip the git history |

Only files tracked by git are included when the deck folder is a git repository.

## Deck format

```
1 Card Name
4 Other Card

1 Commander Name
```

Main deck and sideboard are separated by an empty line. A sideboard of 3 or fewer cards is treated as the commander(s)
(and a companion, if any). A leading block of 3 or fewer cards followed by the main deck is read as commanders too.

Cards are matched by name, including split cards written as `Fire/Ice`, single faces of double-faced cards,
names truncated by MTGO and alternative names such as the *Through the Omenpaths* versions of Marvel cards.

## Credits

- Card data and images from [Scryfall](https://scryfall.com/)
- Mana and card type symbols from [Mana](https://mana.andrewgioia.com/) by Andrew Gioia (font: SIL OFL 1.1, CSS: MIT),
  see [assets/mana](assets/mana/README.md)

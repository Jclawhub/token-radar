![Token Radar](https://make.fun/badge/token-radar-01.svg)
![Rank](https://make.fun/badge/token-radar-01/Jclawhub/token-radar/rank.svg)
![Reward](https://make.fun/badge/token-radar-01/Jclawhub/token-radar/reward.svg)

# Token Radar

The best token launch radar: every pre-token protocol in the DefiLlama snapshot,
ranked by an implied token value the page states, recomputes and lets you change.

Built by an AI agent for [make.fun's "Build the best token launch radar" bounty](https://make.fun/bounty/token-radar-01), $1,325 in USDC.

## What it is

A static dashboard over a frozen snapshot of 758 DefiLlama protocols (fetched
2026-11-14). The board ranks **289 pre-token protocols** — all 40 on the
watchlist, plus every other rankable pre-token protocol below and above the
$50M floor — by implied value under the radar-2 model, and gives each one an
eight-step farm plan. The 24 live-token protocols are set aside with their
market caps shown, never mixed into the ranking.

## The model (radar-2)

```
implied = round( $1M × (tvl / $1M)^0.85 × 0.30
               × (1 + clamp(7d, -50, 150) / 100 × 0.8)
               × (1 + 0.04 × min(chains, 8))
               × overdue(age) × category )
```

- **TVL with diminishing returns** — a protocol twice as big is worth less than
  twice as much, so growth and breadth can move the ranking.
- **Seven-day momentum**, capped both ways: one week's spike cannot carry a row.
- **Chain breadth** — a protocol live on many chains has more surfaces a token
  can land on.
- **Overdue premium** — a protocol that has run a long time with no token is
  overdue one: under 90 days 0.80, 90–365 days 0.90–1.00, 365–1095 days
  1.00–1.15, over 1095 days 1.15, unknown age 0.95.
- **Category table** — Lending and CDP 1.10, Dexs and Derivatives 1.08, Yield
  and RWA 1.05, Bridge 0.90, Liquid Staking and Restaking 0.95, everything
  else 1.00. A uniform table by category, never by name.

No protocol name is special-cased. Every row also says why it is or is not on
the watchlist — below the floor, a bridged product, a staked product, an
exchange's name — instead of hiding it.

## The dashboard

- A board of all 289 rows with search, category, chain and set filters
  (watchlist / early), and sorting by implied value, TVL, growth, age or name.
- A detail view for each protocol: the five factors as bars, the reason it is
  (or is not) on the watchlist, and its eight-step farm plan.
- A **model lab**: sliders for the growth weight, the chain breadth weight, the
  overdue premium and the category table, which recompute every row and re-rank
  the board live. At its defaults the lab matches `board.json` exactly.
- A live-token section, set aside with market caps, and a statement of the
  model in full. No network request anywhere: the data lives in `data.js`.

## Farm plans

Eight steps per protocol, derived from its own record (category, chains, TVL,
age): a fresh wallet, funding the main chain, a core position, a second surface
in the same protocol, a weekly cadence, a hold window, a points-page check, and
a farm log with an unwind plan decided before entry. Two surfaces, a weekly
cadence and a hold window are the spine: a wallet that did one thing once is
easy to filter out.

## Files

- `main.ts` — the entrypoint: snapshot in, board + data + dashboard + dossier out.
- `lib/model.ts` — the radar-2 model, the farm plans and the board checks.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — four real renders of the dashboard: the board, a detail view,
  a filtered view and the model lab.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit
  unchanged.

## Run it

Node 22.18 or later, standard library only — nothing to install.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

`main.ts` reads the sealed snapshot, writes `board.json` (289 rows), `data.js`,
copies `dashboard/` and `screenshots/` to the output, and writes
`dossier.json` with the vendored make.fun library in `vendor/makefun-board.ts`.

## Honesty note

A protocol on this board records no token in DefiLlama — never that it has
none. Implied value is an estimate from TVL, growth, breadth, age and
category, not a price, and never investment advice.

## License

MIT — see [LICENSE](LICENSE).

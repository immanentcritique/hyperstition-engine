# recursion kernel

A forkable operating system for cybernetic culture recursion units.

> By dreaming a better future, its error informs the present while the present informs the dream.

From [emancipatory generativity](ARTIST-STATEMENT.md), the artist statement for transcendentalcritique. This is the shared memory for putting that loop into practice.

The memory of a recursion unit, kept as plain files in a git repository and compiled into a web page on every change.

A unit writes down futures it wants (**horizons**), what each future asks of the present (**requirements**), short instructions people can carry out together (**scores**), and what it actually did (**acts**). After every act, the people who were there send **signals**. Those signals are the unit's error signal, and they're available now, at every meeting, without waiting for the future to arrive.

The repository keeps the unit’s memory. People form the unit; forking gives them a new place to begin. The protocol is a pair of text files. Once the unit is founded, the build checks their hashes against the recorded lock; the CLI updates that lock through ratified proposals.

v0.1.0 · Node.js 22 or newer · no dependencies.

This repository starts as a template, with no members or claimed activity. The [example unit](examples/demo-unit/unit.md) is fictional. Its page is included at `dist/example/index.html` when you build.

## Start here

Copy this folder or fork the repository, open a terminal inside it, then:

```sh
node kernel.mjs fork ccru.yourplace --yes --place "Your place"
```

Write `unit.md`, `protocol/MEETING.md` and `protocol/TRADITIONS.md` together. Add members and found only when the room agrees. The kernel refuses to found a unit with blank meeting texts.

To preview the starter before changing anything, run `npm run release` and open `dist/index.html`. This checks the kernel, rebuilds the fictional example, and builds the public page.

```sh
node kernel.mjs status          # where the unit is pulling, and how it feels
node kernel.mjs help            # every command
node examples/build-demo.mjs    # build a made-up unit, then open examples/demo-unit/dist/index.html
node test/run.mjs               # tests
```

## Who writes what

The kernel is machinery. The words that ask people to believe, join or commit are the unit's to write, and the kernel leaves room for them:

| File | Who writes it |
| --- | --- |
| `unit.md` (the text under the frontmatter) | the unit: who it is, a few sentences |
| `protocol/MEETING.md` | the unit: what happens when it meets, about a page |
| `protocol/TRADITIONS.md` | the unit: 7–12 lines on what a unit is, what units owe each other, how forks work |
| `horizons/*.md` | whoever writes the future |
| `scores/*.md` | whoever writes the instruction |
| `acts/*.md` | whoever was there: what happened |

The twelve scores in `scores/` are seeded from the transcendentalcritique gallery.

## The loop

```sh
node kernel.mjs horizon "A world where…" --by xander      # write the future in the file it creates
node kernel.mjs require "What it asks of now" --horizon h-001
node kernel.mjs act "What we did" --req r-001 --score s-001 --with xander,abby --date 2026-10-24
node kernel.mjs signal a-001 --who xander --felt 2 --req r-001:0.2:0.35 --note "optional"
node kernel.mjs signal a-001 --felt 1 --req r-001:0.15:0.3   # leave out --who to signal anonymously
```

Horizons aren't fixed targets. They learn:

```sh
node kernel.mjs revise h-001 "A better version"   # new horizon with parent h-001; requirements carry over
node kernel.mjs compost h-001                     # let it die; it stays in the record
node kernel.mjs met r-001
node kernel.mjs drop r-002
```

## The signal math

Each signal has up to three parts:

- **felt**, from −2 to +2: did that feel alive or dead? This is the *algedonic* channel: a direct signal of pain or pleasure.
- **before**, from 0 to 1: how likely the requirement seemed before the act.
- **after**, from 0 to 1: how likely it seems now.

`after − before` records a change in the unit’s own forecast after one step. It does not establish that the act caused the change. From it the kernel computes:

- **credit per act**: the mean forecast change for each requirement the act aimed at. This is the line weight in the field.
- **a requirement's current forecast**: the latest act's mean `after` (1.0 if marked met), plus its movement since the first act.
- **a horizon's nearness**: the mean current forecast of its measured requirements.
- **pulse**: the mean `felt` over the last five acts. Below zero, the page tells the unit to change something.
- **pain**: any `felt` of −2. It appears at the top of the page with its note and without a name.

The page shows counts, not individual scores. Nobody is ranked. Forecasts are self-reported, so the numbers are only as honest as the room. Keep them few.

## Founding and the protocol

A new unit starts in **founding mode**: anything can be rewritten. Add the people in the room, write the founding texts together, then found:

```sh
node kernel.mjs member add xander --met-by founding
node kernel.mjs member add abby --met-by founding
node kernel.mjs found
```

`found` writes `protocol/ratified.lock`, which holds the hashes of every file in `protocol/` and of the quorum and threshold in `unit.md`. After that, `check` and `build` fail if any of these change outside a ratified proposal:

```sh
node kernel.mjs propose "Add a tradition" --target protocol/TRADITIONS.md --text my-draft.md
node kernel.mjs vote p-001 xander yes
node kernel.mjs ratify p-001                       # applies it if it passed, and re-locks

node kernel.mjs propose "Raise the bar" --governance --threshold 0.75   # rules for changing rules
```

A proposal passes when at least `quorum` of active members have voted and at least `threshold` of the votes are yes (defaults 0.5 and 0.66). If its target changed after it was proposed, it is stale and has to be proposed again. `reject` closes a proposal that can no longer pass. `withdraw` closes one its author is pulling.

After founding, new members need someone already in the unit to vouch that they met them in person: `member add <handle> --met-by <member>`. This records an in-person vouch; it does not verify identity.

## Forking and adopting

```sh
# in your own copy of the repo (fork it on GitHub, or copy the folder):
node kernel.mjs fork ccru.denver --yes --place "Denver" --color "#00a86b"
```

The new unit inherits horizons, requirements, scores and the protocol. It doesn't inherit members: people don't fork. The parent's acts and signals move to `lineage/<parent>/` as history, with the signal author field cleared. Requirements the parent had met are reopened, since being met in one place isn't being met here. The fork starts in founding mode, so it can rewrite its whole protocol before it founds itself.

To bring one future or score across from another unit:

```sh
node kernel.mjs adopt ../ccru.la/horizons/h-004-something.md
node kernel.mjs adopt https://raw.githubusercontent.com/…/s-002-x.md --from ccru.la
```

## Publish on GitHub

1. Create an empty repository on your new GitHub account, with `main` as the default branch.
2. Upload the **contents of this folder** at the repository root, including `.github/workflows/compile.yml`. GitHub Desktop can publish the folder with hidden files included.
3. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
4. Open **Actions → compile → Run workflow** on `main` if the first upload happened before Pages was enabled.
5. When deployment finishes, copy the address from **Settings → Pages**. That is the link to put on the TC site.

The installed workflow tests and builds on pushes and pull requests. Only `main` deploys. No repository name or account name is hard-coded; the example uses relative links so project Pages addresses work. See [GitHub’s workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

`node kernel.mjs build` compiles the current unit. `npm run release` also regenerates the fictional example. All content intended for a unit’s public page lives in its plain-text files.

## Files

```
unit.md                    name, place, colour, founding date, lineage, quorum, threshold
members.csv                handle, joined, met_by, status
ledger/signals.csv         act, who, requirement, felt, before, after, note
horizons/ requirements/ scores/ acts/
protocol/MEETING.md        governed text
protocol/TRADITIONS.md     governed text
protocol/proposals/        p-001-….md (votes, status) + p-001-….proposed.md (the text)
protocol/ratified.lock     hashes + history of founding and ratifications
lineage/<parent>/          what a fork carried over
kernel.mjs, kernel/        the machinery
.github/workflows/compile.yml  tests, builds and publishes to Pages
ARTIST-STATEMENT.md         the artist’s words, copied from the TC statement
```

Every file is plain text. Anything the CLI does can also be done by hand or in GitHub's editor, and `check` will say if something doesn't hold together.

## Privacy

A public repository exposes its source files and Git history, including `members.csv` and `ledger/signals.csv`. Leaving `who` blank omits the signal author field; notes, dates and commit history may still identify someone. The page hides signal authors, but publishes pain notes and any names written into prose. Forking clears signal author fields, not names in act text or archived proposals. Agree together on what can be made public before recording it.

The protocol lock catches accidental or ordinary direct edits. Someone with repository write access can edit the lock, membership or votes. It is a coordination tool for a trusted group, not authenticated voting or a tamper-proof constitution.

## Not built yet

- **Vote authorization.** Anyone with write access could type a vote for someone else or replace the lock. Next step: require each member to vote in a signed commit or through their own pull request, and have `check` verify it.
- **Federation.** Units can adopt from each other, but there's no shared registry of units or cross-unit vouching graph yet. Cross-unit identity is not implemented.
- **Shared resources across units.** If units ever pool money or scarce goods, that would need its own accounting and governance.
- **A form for signals.** For now signals go in through the CLI or by editing `ledger/signals.csv`. A phone-friendly form at the end of a meeting would make this much easier.

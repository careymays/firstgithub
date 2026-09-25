# Squish Island Lore Bible

The Lore Bible is the living source of truth for Squish Island, the cozy adventure game that Kennedy and Carey are designing together. It is a plain static website with no framework, no build step, no backend, and no API keys. All of the content lives in JSON files in `docs/content/`, which are version controlled in this repository, and the site reads those files and displays them. To change what the bible says, you edit the JSON and commit it.

## Viewing the site

**On GitHub Pages.** In the repository on GitHub, open **Settings → Pages**. Under "Build and deployment," choose **Deploy from a branch**, pick the branch that holds this site, and choose the **/docs** folder. After a minute or two, GitHub shows the site's address at the top of that page. Every time you push a change to `docs/content/`, the site updates on its own.

**On your own computer.** The site loads its content with `fetch`, and browsers block that when you open `index.html` directly as a file. Instead, run a tiny local web server from the `docs` folder:

```
cd docs
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

If a content file has a typo, the site still loads everything else and shows a pink box at the top naming the broken file and the problem, so you can fix it and reload.

## The house rules

**Kennedy is the design authority.** Any entry can carry `"kennedysIdea": true`, and the site then shows a "⭐ Kennedy's idea" badge on it everywhere it appears. All of her marked entries are also collected on the **Kennedy's ideas** page. None of the preloaded entries are marked yet, so add the flag to whichever ones came from her.

**Version 1 has no combat.** None of the content files have fields for health, damage, enemies, or anything like them, and the dashboard runs a "cozy check" over every entry. If any text uses combat words such as "fight," "battle," "attack," "enemy," or "defeat," the dashboard lists those entries so you can reword them.

## How the content files work

Each file in `docs/content/` is a JSON object holding one list (and, in a few files, a setting or two). Every entry needs an `id`, which is a short, unique, lowercase name with dashes instead of spaces, such as `"nana-saguaro"`. Other entries use these ids to point at each other: for example, a character's `area` is the `id` of a chapter, and a quest's `giver` is the `id` of a character.

Text fields can be left as an empty string (`""`) until you know what goes there. The site shows a soft "Not written yet" or "not set" in their place. Status fields are best filled with one of the values listed for them below, because those values get their own colors; any other text still shows up, just in gray.

JSON is strict about punctuation. Every entry except the last one in a list needs a comma after its closing `}`, every name and text value goes in straight double quotes, and `true`/`false` go without quotes. If you want a line break inside a text value, write `\n`.

Below is each file with a sample entry. To add something, copy an existing entry in the file, paste it after a comma, and change the values.

### chapters.json: chapters and areas

```json
{
  "chapters": [
    {
      "id": "sunny-dunes",
      "name": "Sunny Dunes",
      "version": "V17",
      "emoji": "🌵",
      "color": "#f2a33a",
      "status": "in development",
      "description": "A warm desert full of sleepy cacti.",
      "kennedysIdea": false
    }
  ]
}
```

The `status` values with colors are `in planning`, `in development`, and `released`. The `emoji` and `color` (a hex color) decorate the area everywhere on the site, including the color of that area's squishes. The order of the list is the order areas appear in.

### characters.json: characters

```json
{
  "characters": [
    {
      "id": "nana-saguaro",
      "name": "Nana Saguaro",
      "title": "Sunny Dunes elder",
      "area": "sunny-dunes",
      "personality": "Warm, slow-talking, loves riddles.",
      "designNotes": "Chosen over the earlier name \"Nana Prickles\" as the safer pick.",
      "voiceLineStatus": "in progress",
      "artStatus": "concept",
      "kennedysIdea": false
    }
  ]
}
```

`area` is a chapter id, and it can be `""` if the character doesn't belong to one area. `voiceLineStatus` uses `not started`, `in progress`, or `done`. `artStatus` uses `concept`, `sprite`, or `in-game`. To put double quotes inside text, write them as `\"`, as in the design notes above.

### squishes.json: squishes

```json
{
  "perArea": 20,
  "squishes": [
    {
      "id": "sd-01",
      "area": "sunny-dunes",
      "slot": 1,
      "name": "Puffle",
      "description": "A round little sand puff.",
      "personality": "Shy at first, then very giggly.",
      "befriendingNotes": "Hum a tune nearby and wait for it to wiggle.",
      "artStatus": "concept",
      "kennedysIdea": true
    }
  ]
}
```

Sunny Dunes (`sd-01` to `sd-20`) and Frosty Peaks (`fp-01` to `fp-20`) each have 20 empty slots ready to fill in. You don't need to add new entries for those squishes; just fill in the blanks on the existing ones. A squish counts as "named" on the dashboard as soon as its `name` is filled in. `slot` sets its number and order within its area, and `artStatus` uses `concept`, `sprite`, or `in-game`. When Treetop Jungle is ready, add 20 more entries with `"area": "treetop-jungle"` and ids like `tj-01`. `perArea` is how many squishes each area is meant to have.

### quests.json: wake quests and island quests

```json
{
  "targets": { "wake": 9, "island": 27 },
  "quests": [
    {
      "id": "wake-01",
      "type": "wake",
      "title": "Wake Nana Saguaro",
      "chapter": "sunny-dunes",
      "giver": "nana-saguaro",
      "objective": "Find the three sun-stones and set them around Nana's pot.",
      "status": "designed",
      "notes": "",
      "kennedysIdea": false
    }
  ]
}
```

`type` is either `wake` or `island`. `targets` is how many of each you plan to have, and it drives the progress bars (9 wake quests and about 27 island quests). `giver` is normally a character id, and the site links to that character; plain text works too. `status` uses `designed`, `coded`, or `tested`.

### voice-lines.json: voice lines

```json
{
  "voiceLines": [
    {
      "id": "nana-hello-01",
      "character": "nana-saguaro",
      "version": "V17",
      "text": "Well hello there, little sprout!",
      "context": "First time you meet her.",
      "notes": "",
      "kennedysIdea": false
    }
  ]
}
```

`character` is a character id, and `version` is the version tag, such as `V17`. The Voice lines page can be searched by text and filtered by character and by version. When you paste in a batch of lines, give each one its own id; numbering them (`nana-hello-01`, `nana-hello-02`) is the easiest way.

### art.json: art pipeline

```json
{
  "assets": [
    {
      "id": "art-nana-saguaro",
      "name": "Nana Saguaro",
      "kind": "character",
      "linkedTo": "nana-saguaro",
      "concept2d": "done",
      "runtime": "in progress",
      "model3d": "not started",
      "notes": ""
    }
  ]
}
```

Each asset has three pipeline columns: `concept2d` is the 2D concept made in ChatGPT, `runtime` is the in-game version built with Claude Code, and `model3d` is the 3D model made in Blender. Each one uses `not started`, `in progress`, or `done`. `kind` is free text, such as character, squish, area, prop, or UI. `linkedTo` is optional and can be the id of a character, squish, or quest. The four characters are listed already with their statuses left blank.

### playtests.json: playtesters and feedback

```json
{
  "testers": [
    { "id": "alexa", "name": "Alexa", "about": "First outside playtester. Kennedy's school friend." }
  ],
  "feedback": [
    {
      "id": "fb-2026-10-01-alexa-1",
      "tester": "alexa",
      "date": "2026-10-01",
      "linkedTo": "nana-saguaro",
      "feedback": "Loved Nana's riddles but got stuck on the second one.",
      "status": "open",
      "kennedysIdea": false
    }
  ]
}
```

`tester` is a tester id. Write `date` as year-month-day so the newest feedback sorts to the top. `linkedTo` is the id of the quest or character the feedback is about, and it can be `""`. `status` is `open` or `addressed`.

### ideas.json: ideas parking lot

```json
{
  "ideas": [
    {
      "id": "grayscale-world",
      "title": "Grayscale world",
      "targetVersion": "",
      "summary": "An uncolored world that colors in as you befriend squishes.",
      "notes": "",
      "kennedysIdea": false
    }
  ]
}
```

These are future ideas that aren't part of the current version. `targetVersion` is free text, like `Version 2`, and it can be left empty for "someday."

### mechanics.json: mechanics notes

```json
{
  "mechanics": [
    {
      "id": "sense-meter",
      "title": "Sense meter",
      "summary": "The on-screen meter for the Sense ability.",
      "rules": [
        "At rest, the meter stays transparent and subtle.",
        "While Sense is in use, the meter is fully visible.",
        "The meter is never hidden or removed."
      ],
      "notes": "",
      "kennedysIdea": false
    }
  ]
}
```

Each mechanic is a short reference page. `rules` is a list of the must-follow rules for that system, one sentence each.

## Search

The search box at the top of every page looks through characters, squishes, quests, voice lines, parked ideas, mechanics, playtest notes, chapters, and art assets at once. Pressing `/` anywhere jumps to it. Clicking a result takes you to that entry and makes it glow for a moment.

## Files

`index.html` is the page shell, `styles.css` holds the look, and `app.js` loads the content and draws every section. `content/` holds the JSON files described above. `.nojekyll` tells GitHub Pages to serve the files exactly as they are.

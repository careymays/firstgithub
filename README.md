# Thumbnail Vault

> This repository also holds the **Squish Island Lore Bible**, a separate static website in the [`docs/`](docs/) folder. See [`docs/README.md`](docs/README.md) for how it works.

Thumbnail Vault is a Chrome extension (Manifest V3) that keeps thumbnail ideas for the Mays Family Travels YouTube channel. It lives in Chrome's side panel, so you can browse YouTube and save inspiration without leaving the page. There is no backend and there are no API keys. Everything is stored locally in `chrome.storage.local` in your own browser profile.

## Installing it (load unpacked)

1. Download this repository to your computer. The simplest way is **Code → Download ZIP** on GitHub, then unzip it. Remember where the folder is, because Chrome loads the extension straight from it.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** with the toggle in the top-right corner.
4. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
5. Thumbnail Vault now appears in your extensions list. Click the puzzle-piece icon in the toolbar and pin it so the orange play icon is always visible.
6. Click the icon to open the vault in the side panel.

Chrome 116 or newer is required. If you edit any files later, go back to `chrome://extensions` and click the reload arrow on the Thumbnail Vault card. Don't delete the folder, because Chrome needs it to keep running the extension.

## Saving a thumbnail

Right-click any image on any web page and choose **Save thumbnail to Vault**. The side panel opens with a save form that shows a preview of the image, a dropdown for picking which of your videos it's for, and a note field for what caught your eye. The dropdown also has an **+ Add new video…** option, so you can create a video on the spot.

On YouTube, you can right-click a video thumbnail, a video link, or an empty area of a watch page. In each case the extension reads the video ID from the URL and saves YouTube's standard thumbnail (`https://i.ytimg.com/vi/{id}/hqdefault.jpg`). That way the saved image is always the clean, full thumbnail and never a cropped or expiring variant. The saved card links back to the page you were on and to the video itself.

The menu item also appears when you right-click ordinary links. Chrome can't show it only for YouTube links without splitting it into a submenu on every YouTube thumbnail. If you choose it on a link that isn't a YouTube video and isn't an image, the panel tells you nothing could be saved.

## Organizing your videos

The main screen lists your videos in lineup order, numbered from 1. Your 17-video backlog is preloaded under the **Backlog** heading. A trip heading appears wherever the trip name changes from one video to the next, so if you rename some videos' trip to "St. Martin" and drag them next to each other, they'll sit together under a St. Martin heading. Each row shows how many ideas (💡) and saved thumbnails (🖼) the video has, and the search box filters by title, trip, or notes.

You can put the lineup in any order you like. Drag a row by its ⋮⋮ handle, or hover over a row and use the ↑ and ↓ buttons. To insert a new video in the middle of the lineup, hover over the row it should follow and click **+**. The main **+ Add video** button also has a Position setting (at the end, at the top, or after any video). Numbers update automatically after every change. Open a video to edit its title, trip name, or notes, or to delete it. Deleting a video also deletes its ideas and saved thumbnails, and the extension asks you to confirm first. Reordering is turned off while a search is active, so clear the search box to drag.

## Inside a video

Each video has two tabs.

**My ideas** holds your own thumbnail concepts. Each idea has a concept description, overlay text (limited to four words, with a live word counter), notes, a status (idea, drafted, designed, or published), and an optional reference image that you upload from your computer. Uploaded images are shrunk to at most 960 pixels on their longest side so the vault stays small.

**Inspiration** is the gallery of thumbnails you've saved with the right-click menu. Each card shows your note, a link to the source page, and a **Watch** link for YouTube videos. You can edit the note, move the card to a different video, or remove it. You can also paste a YouTube URL directly into the box at the top of this tab to add its thumbnail without right-clicking.

## Brainstorming and scoring with Claude

The extension never calls Claude itself. It builds the prompt, and you do the pasting.

Click **✨ Get brainstorm prompt** on a video to copy a tailored prompt to your clipboard. The prompt includes the video title, the trip name, and your video notes, along with the channel rules: thumbnails must read at small sizes, overlay text is big, bold, and short, faces show real emotion, and the thumbnail creates a curiosity gap without clickbait. It also lists your existing ideas so Claude won't repeat them, and your "what caught my eye" notes from the Inspiration tab. Paste the prompt into Claude, copy Claude's whole reply, paste it into the box that appears, and click **Add these ideas**. Each numbered concept with OVERLAY, VISUAL, and WHY lines becomes an idea card marked **AI-generated**. If an AI overlay runs past four words, the card flags it so you can trim it.

On any idea card, **Score via Claude** copies a scoring prompt that asks for a 1–10 rating on curiosity gap, clarity at small size, emotion, and text brevity, plus one concrete improvement. Paste Claude's reply back into the box and click **Save score**. The card then shows each rating, the average, and the suggested improvement. You can rescore an idea at any time after editing it.

If copying to the clipboard ever fails, open **Show prompt** under the paste box and copy the text by hand.

## Backing up

**Export** on the main screen downloads the whole vault as a JSON file, including uploaded reference images. **Import** loads a file like that and replaces the current vault after asking you to confirm. Export regularly, because removing the extension from Chrome also deletes its stored data.

## Files

`manifest.json` declares the extension, its permissions, and the side panel. `background.js` is the service worker that registers the right-click menu, opens the side panel, and passes each capture to it. `sidepanel.html`, `sidepanel.css`, and `sidepanel.js` make up the side panel app. `shared.js` holds pure helper functions used by both sides: YouTube URL parsing, prompt building, and parsing Claude's replies. `icons/` holds the toolbar icons. There is no framework and no build step.

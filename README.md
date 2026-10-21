# Stream Local 🎬

[![Website](https://img.shields.io/website?url=https%3A%2F%2Fstreamlocal.github.io%2F&up_message=Online&up_color=green&down_message=Offline&down_color=red)](https://streamlocal.github.io/)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/streamlocal/streamlocal.github.io)

**[Visit Stream Local Live](https://streamlocal.github.io/)**

Stream Local is a premium, highly customizable web interface for discovering and streaming movies and TV shows. Hosted entirely on GitHub Pages, it acts as a lightweight aggregator that pulls metadata from TMDB and connects to third-party streaming servers—all while actively blocking intrusive popup ads.

## ✨ Features

* **Universal Streaming:** Watch almost any movie or TV show directly from your browser.
* **Built-in Popup Blocker:** Aggressive, multi-layered popup and redirect prevention so you can watch without interruption.
* **Customizable UI:** Choose between Dark, Light, and "Chill" themes, alongside Classic, Glassy, or Redesign layouts.
* **Bring Your Own Sources:** Easily add, manage, and prioritize custom third-party streaming server URLs in the settings.
* **Personalized Watchlist:** Save your favorite shows and movies to your local list.
* **Data Portability:** Export and import your profile (watch history, lists, API keys, and custom sources) as a JSON file.
* **Responsive Design:** Fully optimized for desktop, tablet, and mobile viewing.

## 🚀 Getting Started

Stream Local runs entirely in your browser. No server setup or installation is required! 

1. Go to the [Live Site](https://streamlocal.github.io/).
2. **Configure Streaming Sources (Optional):**
   * The app comes with default 3rd-party providers. You can manage these or add your own custom video server templates in the Settings menu.
3. **Search and Watch:** Use the search bar to find content or browse the trending/popular carousels on the homepage.

## ⚙️ How It Works

This project is a static single-page application (SPA) using plain HTML, CSS, and Vanilla JavaScript. `index.html` contains the interface and styles; `playback.js` contains the managed source catalog, saved-list migrations, and playback monitoring. 

* **Metadata:** Fetched via TMDB API.
* **Video Playback:** Handled by dynamically embedding third-party host URLs into an iframe.
* **Storage:** All watchlists, history, and settings are saved locally to your browser's `localStorage`.

## ⚠️ Disclaimer

**Stream Local does not host, upload, or manage any media files.** This project simply functions as a client-side search engine and UI wrapper that displays content from third-party providers on the web. We have no control over the media put up by third-party sites. All legal issues, DMCA requests, or copyright takedowns should be directed to the respective third-party platforms hosting the files.

## Playback maintenance

CineSrc, MoviesAPI, and VixSrc are first in the source catalog. Existing browser lists, synced profiles, and imported profiles receive catalog updates while retaining custom sources and intentional deletions. Provider availability and video quality vary by title.

To update the catalog, edit `playback.js`, increase its `revision`, assign that revision to genuinely new entries' `added` field, and update the script version in `index.html`. Playback monitoring uses active-frame, origin-checked media events where supported; loading an iframe document alone does not prove that video works. Legacy players without events retain manual source switching. Automatic fallback stops after one pass.

Run the regression checks with `node --test tests/playback.test.cjs`.

# PackDex

PackDex is a fan-made Pokémon card pack opening and collection app built for collectors who want a fun, clean way to open packs, chase rare cards, and track their collection.

PackDex has three connected surfaces:

* **Welcome Website** — the responsive product introduction shown once at `/` and always available at `/welcome`
* **PackDex Desktop** — the existing fully playable desktop app loaded at `/` after the welcome
* **PackDex Mobile** — the primary, most actively updated product at `/mobile-app/`

## Main Website

The main PackDex website introduces the product, then sends collectors into the existing desktop app or the mobile app. The local `packdex_welcome_seen_v1` preference prevents a returning visit to `/` from flashing the welcome again. The desktop app's mobile-feature notice uses the separate `packdex_desktop_mobile_notice_dismissed_v1` preference.

### Features

* Responsive product overview for desktop, tablet, and mobile browsers
* Direct access to both desktop and mobile PackDex
* Product feature, collection, and set highlights
* A permanent `/welcome` route for reopening the product overview
* Canonical privacy, terms, support, social, and attribution links

## PackDex Mobile

PackDex Mobile is the app-style version of PackDex, designed for phones and home-screen use.

### Features

* Mobile-first pack opening experience
* Smooth card reveal animations
* Tap-friendly navigation
* Bottom app navigation for quick access
* Open packs, view collections, and check values on the go
* App-style home screen experience
* PackDex app icon and name when installed
* Mobile collection pages designed for smaller screens
* Clean profile and settings pages
* Sound and appearance settings
* Simple sign-in, sign-up, and guest flow
* Fast access without needing to use the full desktop website

## Collection Tracking

PackDex helps users keep track of what they have pulled and what they still need.

Users can:

* Track owned cards
* View set completion progress
* Browse cards by set
* See collection totals
* Return to previously opened sets
* Build toward completing master sets

## Values

PackDex includes estimated card and collection values so users can better understand the cards they have pulled.

Values are shown for supported cards and sets when pricing data is available.

## Disclaimer

PackDex is a fan-made collector project. It is not affiliated with, endorsed by, or sponsored by Nintendo, Creatures, GAME FREAK, The Pokémon Company, or any official Pokémon TCG partner.

Pokémon names, images, card data, and related trademarks belong to their respective owners.
